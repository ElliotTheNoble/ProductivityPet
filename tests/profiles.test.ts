import type { Task } from '@/utils/tasks';
import { DAY, T0, UNITS, fixture, flush, freezeClock, iso, loadApp, setClock, unfreezeClock, type App } from './helpers';

// Phone notifications are not available in tests; only the calls are recorded.
jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'scheduled-id'),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
}));

const P = '@ProductivityPet:';
const FAMILY = `${P}petFamily`;
const AWARDED = `${P}awardedTaskTokens`;
const REGISTRY = `${P}profiles`;
const BACKUP_PREFIX = `${P}backup:preM2:`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const BISCUIT = 'pet-1700000000000';
const LUNA = 'pet-1700000000002';
const SHADOW = 'pet-1700000000003';

beforeEach(() => freezeClock(T0));
afterEach(() => unfreezeClock());

function task(id: string, over: Partial<Task> = {}): Task {
  return { id, text: id, category: 'Home' as Task['category'], important: false, kind: 'task', date: '2026-03-10', completed: false, ...over };
}

const backupKeys = async (app: App) => [...(await app.dump()).keys()].filter((k) => k.startsWith(BACKUP_PREFIX));
const mixed = () => ({ [FAMILY]: (fixture('family-v1-mixed') as Record<string, unknown>)[FAMILY] });

// Boots the app on `seed`, registers children and waits until the profile layer is ready.
async function boot(seed?: Record<string, unknown>, children: string[] = []): Promise<App> {
  const app = await loadApp(seed);
  await app.profiles.ensureProfilesReady();
  for (const id of children) expect(await app.profiles.registerChildProfile(id)).toMatchObject({ ok: true });
  return app;
}

// Switches and makes sure the new profile's family is loaded (the screens do this when they mount).
async function enter(app: App, id: string) {
  expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
  return app.family.ensureFamilyLoaded();
}

const wallet = (app: App) => app.family.getWalletBalance();
const living = (app: App) => app.family.getLivingPets(app.family.peekFamily()!);

// ---------------------------------------------------------------------------------------------------------
describe('keys', () => {
  test('main keeps the original keys; children are namespaced; unknown ids never fall back to main', async () => {
    const app = await boot(undefined, ['kid1']);
    const { scopedKeyFor, scopedKey } = app.profiles;
    expect(scopedKeyFor('main', 'tasks')).toBe(`${P}tasks`);
    expect(scopedKeyFor('kid1', 'tasks')).toBe(`${P}p:kid1:tasks`);
    expect(scopedKeyFor('never-registered', 'tasks')).toBe(`${P}p:never-registered:tasks`);
    expect(scopedKey('memorialSeen')).toBe(`${P}memorialSeen`);
    await enter(app, 'kid1');
    expect(scopedKey('memorialSeen')).toBe(`${P}p:kid1:memorialSeen`);
    expect(scopedKey('mood')).toBe(`${P}p:kid1:mood`);
  });

  test('child ids are validated', async () => {
    const app = await boot();
    for (const bad of ['', 'main', 'a:b', '../x', 'has space', 'x'.repeat(65)]) {
      expect(await app.profiles.registerChildProfile(bad)).toEqual({ ok: false, reason: 'invalid-id' });
    }
    expect(await app.profiles.registerChildProfile('kid_1-A')).toEqual({ ok: true, created: true });
    expect(await app.profiles.registerChildProfile('kid_1-A')).toEqual({ ok: true, created: false });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('backup and initialization', () => {
  test('a fresh install gets a registry with the main profile and an (empty) verified backup', async () => {
    const app = await boot();
    const status = app.profiles.getProfilesStatus();
    expect(status.state).toBe('ready');
    expect(status.activeProfileId).toBe('main');
    expect(status.profiles).toEqual([expect.objectContaining({ id: 'main', kind: 'main', storage: 'legacy' })]);
    expect(status.backup).toMatchObject({ keyCount: 0 });
    expect(await backupKeys(app)).toEqual([status.backup!.key]);
  });

  test('an existing save is backed up completely and the original keys are not touched', async () => {
    const seed = { ...fixture('legacy-single-pet'), ...mixed() };
    const app = await loadApp(seed);
    const before = await app.dump();
    await app.profiles.ensureProfilesReady();
    const after = await app.dump();
    for (const [key, value] of before) expect(after.get(key)).toBe(value); // every original key is byte-identical
    const status = app.profiles.getProfilesStatus();
    const backup = JSON.parse(after.get(status.backup!.key)!);
    expect(backup.keyCount).toBe(before.size);
    expect(Object.keys(backup.entries).sort()).toEqual([...before.keys()].sort());
    for (const [key, value] of before) expect(backup.entries[key]).toBe(value);
  });

  test('startup is idempotent: a second start creates no second backup and keeps the registry', async () => {
    const first = await boot(fixture('legacy-single-pet'), ['kid1']);
    const saved = await first.dump();
    const second = await loadApp(undefined, saved);
    await second.profiles.ensureProfilesReady();
    expect(await backupKeys(second)).toEqual(await backupKeys(first));
    expect((await second.dump()).get(REGISTRY)).toBe(saved.get(REGISTRY));
    expect(second.profiles.getProfilesStatus().profiles.map((p) => p.id)).toEqual(['main', 'kid1']);
  });

  test('the backup never changes while the main profile is used normally', async () => {
    const app = await boot(mixed());
    const key = app.profiles.getProfilesStatus().backup!.key;
    const original = (await app.dump()).get(key);
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(25);
    await app.taskStorage.getCachedTasks();
    app.taskStorage.persistCachedTasks([task('a', { completed: true })]);
    await flush();
    expect((await app.dump()).get(key)).toBe(original);
    expect(await backupKeys(app)).toEqual([key]);
    const backed = JSON.parse(original!);
    expect(JSON.parse(backed.entries[FAMILY]).wallet.pawTokens).toBe(640); // the pre-M2 value, not the current one
  });

  test('if the backup cannot be written, profile storage stays off (safe mode) and the app works as before', async () => {
    const app = await loadApp(mixed());
    const realSet = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key.startsWith(BACKUP_PREFIX)) throw new Error('disk full');
      return realSet(key, value);
    });
    await app.profiles.ensureProfilesReady();
    const status = app.profiles.getProfilesStatus();
    expect(status).toMatchObject({ state: 'safe-mode', issue: 'backup-failed', activeProfileId: 'main', backup: null });
    expect((await app.dump()).has(REGISTRY)).toBe(false);
    expect(await app.profiles.registerChildProfile('kid1')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await app.profiles.switchProfile('kid1')).toEqual({ ok: false, reason: 'unknown-profile' });
    // The main profile still reads and saves its original keys.
    const family = await app.family.ensureFamilyLoaded();
    expect(family.wallet.pawTokens).toBe(640);
    app.family.addToWallet(10);
    await flush();
    expect((await app.read('petFamily')).wallet.pawTokens).toBe(650);
  });

  test('a backup that cannot be verified (read back differently) is not trusted', async () => {
    const app = await loadApp(mixed());
    const realGet = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      const v = await realGet(key);
      return key.startsWith(BACKUP_PREFIX) && v ? v.slice(0, -2) : v;
    });
    await app.profiles.ensureProfilesReady();
    expect(app.profiles.getProfilesStatus()).toMatchObject({ state: 'safe-mode', issue: 'backup-failed' });
    expect((await app.dump()).has(REGISTRY)).toBe(false);
  });

  test('interrupted after the backup but before the registry: next start reuses that backup (no duplicate)', async () => {
    const app = await loadApp(mixed());
    const realSet = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === REGISTRY) throw new Error('app killed');
      return realSet(key, value);
    });
    await app.profiles.ensureProfilesReady();
    expect(app.profiles.getProfilesStatus()).toMatchObject({ state: 'safe-mode', issue: 'registry-write-failed' });
    expect((await app.dump()).has(REGISTRY)).toBe(false);
    const interrupted = await backupKeys(app);
    expect(interrupted).toHaveLength(1);

    const restarted = await loadApp(undefined, await app.dump());
    await restarted.profiles.ensureProfilesReady();
    expect(restarted.profiles.getProfilesStatus().state).toBe('ready');
    expect(await backupKeys(restarted)).toEqual(interrupted);
    expect(restarted.profiles.getProfilesStatus().backup!.key).toBe(interrupted[0]);
  });

  test('the registry is only written after the backup is complete (never points at a missing backup)', async () => {
    const app = await boot(mixed());
    const registry = JSON.parse((await app.dump()).get(REGISTRY)!);
    expect((await app.dump()).has(registry.backup.key)).toBe(true);
    const order: string[] = [];
    const again = await loadApp(mixed());
    const realSet = again.AsyncStorage.setItem;
    again.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === REGISTRY || key.startsWith(BACKUP_PREFIX)) order.push(key === REGISTRY ? 'registry' : 'backup');
      return realSet(key, value);
    });
    await again.profiles.ensureProfilesReady();
    expect(order).toEqual(['backup', 'registry']);
  });

  test('a damaged registry is kept, then rebuilt; children whose data exists are found again', async () => {
    const seed = { [REGISTRY]: '{ not json', [scoped('kidA', 'tasks')]: [task('x')], ...mixed() };
    const app = await loadApp(seed);
    await app.profiles.ensureProfilesReady();
    const dump = await app.dump();
    const copies = [...dump.keys()].filter((k) => k.startsWith(`${REGISTRY}.corrupt-`));
    expect(copies).toHaveLength(1);
    expect(dump.get(copies[0])).toBe('{ not json');
    const status = app.profiles.getProfilesStatus();
    expect(status.state).toBe('ready');
    expect(status.profiles.map((p) => p.id)).toEqual(['main', 'kidA']);
    expect(status.activeProfileId).toBe('main');
    // The orphaned child's data was not touched, and the backup excludes it (it is not a pre-M2 key).
    expect(dump.get(scoped('kidA', 'tasks'))).toBe(JSON.stringify([task('x')]));
  });

  test('a damaged registry that cannot be preserved is left alone (safe mode)', async () => {
    const app = await loadApp({ [REGISTRY]: '{ not json' });
    const realSet = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key.startsWith(`${REGISTRY}.corrupt-`)) throw new Error('disk full');
      return realSet(key, value);
    });
    await app.profiles.ensureProfilesReady();
    expect(app.profiles.getProfilesStatus()).toMatchObject({ state: 'safe-mode', issue: 'registry-damaged-not-preserved' });
    expect((await app.dump()).get(REGISTRY)).toBe('{ not json');
  });

  test('an unreadable registry means safe mode; retrying later recovers', async () => {
    const app = await loadApp(mixed());
    const realGet = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === REGISTRY) throw new Error('read error');
      return realGet(key);
    });
    await app.profiles.ensureProfilesReady();
    expect(app.profiles.getProfilesStatus()).toMatchObject({ state: 'safe-mode', issue: 'registry-unreadable' });
    app.AsyncStorage.getItem = realGet;
    expect((await app.profiles.retryProfileInitialization()).state).toBe('ready');
  });

  test('a valid-looking but inconsistent registry is treated as damaged', async () => {
    const bad = JSON.stringify({ version: 1, activeProfileId: 'ghost', profiles: [{ id: 'main', kind: 'main', storage: 'legacy', createdAt: 'x' }], backup: null });
    const app = await loadApp({ [REGISTRY]: bad });
    await app.profiles.ensureProfilesReady();
    expect(app.profiles.getProfilesStatus().state).toBe('ready');
    expect([...(await app.dump()).keys()].some((k) => k.startsWith(`${REGISTRY}.corrupt-`))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('main profile behaves exactly as before', () => {
  test('the existing family loads from the original key, writes to it, and no scoped keys appear', async () => {
    const app = await boot(mixed());
    const s = await app.family.ensureFamilyLoaded();
    expect(s.pets).toHaveLength(5);
    expect(s.wallet.pawTokens).toBe(640);
    app.family.addToWallet(5);
    await flush();
    const keys = [...(await app.dump()).keys()];
    expect(keys.filter((k) => k.startsWith(`${P}p:`))).toEqual([]);
    expect((await app.read('petFamily')).wallet.pawTokens).toBe(645);
  });

  test('the original single-pet save still migrates into the main profile only', async () => {
    const app = await boot(fixture('legacy-single-pet'));
    const s = await app.family.ensureFamilyLoaded();
    expect(s.pets[0].id).toBe(`pet-${Date.parse('2026-01-05T12:00:00.000Z')}`);
    expect(s.wallet.pawTokens).toBe(275);
    expect(s.pets[0].growthUnits).toBe(15 * UNITS);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('children start empty and never inherit the main profile', () => {
  test('no pets, wallet, tasks, inventory, history or settings from the legacy save', async () => {
    const legacy = { ...fixture('legacy-single-pet'), '@ProductivityPet:mood': 'Happy', [`${P}moodLog`]: [{ id: 'm', mood: 'Happy', at: iso(T0), dateISO: '2026-03-10' }] };
    const app = await boot(legacy, ['kid1']);
    const mainFamily = await app.family.ensureFamilyLoaded();
    const mainPetId = mainFamily.pets[0].id;
    await app.taskStorage.getCachedTasks(); // main has tasks loaded in memory when the switch happens
    await enter(app, 'kid1');

    const s = app.family.peekFamily()!;
    expect(s.pets).toHaveLength(1);
    expect(s.pets[0].id).not.toBe(mainPetId);
    expect(s.pets[0]).toMatchObject({ growthUnits: 0, tasksCounted: 0, name: null, equipped: { hat: null, bow: null } });
    expect(s.pets[0].events.map((e) => e.type)).toEqual(['adopted']);
    expect(s.wallet.pawTokens).toBe(0);
    expect(app.family.getCareSupplies(s)).toEqual({ washcloth: 0, medicine: 0 });
    expect(app.family.getToyCounts(s)).toEqual({});
    expect(app.family.getLivingPets(s)).toHaveLength(1);
    expect(app.family.canAdoptMore(s)).toBe(true);

    expect(await app.taskStorage.getCachedTasks()).toEqual([]);
    expect([...(await app.shop.getOwnedShopItemIds())]).toEqual([]);
    expect((await app.history.getTokenHistory()).events).toEqual([]);
    expect(await app.moodLog.getMoodLog()).toEqual([]);
    expect(await app.journal.getReflections()).toEqual([]);
    expect(await app.postcards.ensurePostcardsLoaded()).toEqual([]);
    expect((await app.mail.ensureMailLoaded()).pending).toEqual([]);
    expect(await app.kitty.getKittyCatchHighScore()).toBe(0);
    expect(await app.memory.getMemoryMatchBestMoves()).toEqual({});
    expect(await app.alerts.getAlertSettings()).toEqual(app.alerts.DEFAULT_ALERT_SETTINGS);
  });

  test('a new child never writes to any original key', async () => {
    const app = await boot(fixture('legacy-single-pet'), ['kid1']);
    await app.family.ensureFamilyLoaded();
    await flush();
    const before = await app.dump();
    await enter(app, 'kid1');
    app.family.addToWallet(50);
    await app.taskStorage.getCachedTasks();
    app.taskStorage.persistCachedTasks([task('kid-task', { completed: true })]);
    await app.moodLog.recordMoodEntry('Calm');
    await app.journal.saveReflection('2026-03-10', 'kid only');
    await flush();
    const after = await app.dump();
    // Every key the main profile had is byte-identical; only the device-level registry (the active profile) moved.
    for (const [key, value] of before) if (key !== REGISTRY) expect(after.get(key)).toBe(value);
    expect(JSON.parse(after.get(REGISTRY)!).activeProfileId).toBe('kid1');
    const added = [...after.keys()].filter((k) => !before.has(k));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((k) => k.startsWith(`${P}p:kid1:`))).toBe(true);
  });

  test('after the child, main still has exactly its own pets and tokens', async () => {
    const app = await boot(mixed(), ['kid1']);
    const before = JSON.stringify(await app.family.ensureFamilyLoaded());
    await enter(app, 'kid1');
    app.family.addToWallet(999);
    await enter(app, 'main');
    expect(JSON.stringify(app.family.peekFamily())).toBe(before);
    expect(wallet(app)).toBe(640);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('isolation across profiles and stores', () => {
  const spec: Record<string, { extraEggs: number; tokens: number }> = {
    main: { extraEggs: 0, tokens: 100 },
    kid1: { extraEggs: 2, tokens: 200 },
    kid2: { extraEggs: 1, tokens: 300 },
  };

  async function fill(app: App, id: string) {
    const { extraEggs, tokens } = spec[id];
    await app.family.ensureFamilyLoaded();
    for (let i = 0; i < extraEggs; i += 1) expect((await app.family.adoptNewEgg()).ok).toBe(true);
    app.family.addToWallet(tokens);
    await app.taskStorage.getCachedTasks();
    app.taskStorage.persistCachedTasks([task(`task-${id}`)]);
    expect((await app.shop.purchaseShopItem(`item-${id}`, 10)).success).toBe(true);
    await app.moodLog.recordMoodEntry(id === 'main' ? 'Happy' : id === 'kid1' ? 'Calm' : 'Tired');
    await app.journal.saveReflection('2026-03-10', `journal ${id}`);
    expect(
      (await app.postcards.addPostcard({ id: `pc-${id}`, petId: 'x', image: null, title: 'T', message: 'm', receivedAt: iso(T0) })).ok
    ).toBe(true);
    await app.alerts.saveAlertSettings({ vibration: id !== 'kid1' });
  }

  async function view(app: App) {
    await app.family.ensureFamilyLoaded();
    return {
      pets: app.family.peekFamily()!.pets.length,
      wallet: wallet(app),
      tasks: (await app.taskStorage.getCachedTasks()).map((t) => t.id),
      owned: [...(await app.shop.getOwnedShopItemIds())],
      moods: (await app.moodLog.getMoodLog()).map((m) => m.mood),
      journal: (await app.journal.getReflections()).map((r) => r.text),
      postcards: (await app.postcards.ensurePostcardsLoaded()).map((p) => p.id),
      vibration: (await app.alerts.getAlertSettings()).vibration,
    };
  }

  const expected = (id: string) => ({
    pets: 1 + spec[id].extraEggs,
    wallet: spec[id].tokens - 10,
    tasks: [`task-${id}`],
    owned: [`item-${id}`],
    moods: [id === 'main' ? 'Happy' : id === 'kid1' ? 'Calm' : 'Tired'],
    journal: [`journal ${id}`],
    postcards: [`pc-${id}`],
    vibration: id !== 'kid1',
  });

  test('three profiles keep separate data in every store, through repeated switching and a restart', async () => {
    const app = await boot(undefined, ['kid1', 'kid2']);
    await fill(app, 'main');
    await enter(app, 'kid1');
    await fill(app, 'kid1');
    await enter(app, 'kid2');
    await fill(app, 'kid2');

    for (const id of ['main', 'kid2', 'kid1', 'main', 'kid1', 'kid2', 'kid2', 'main']) {
      await enter(app, id);
      expect(await view(app)).toEqual(expected(id));
    }

    // Restart: same storage, new process. The last active profile (main) comes back, then each profile again.
    await flush();
    const reopened = await loadApp(undefined, await app.dump());
    await reopened.profiles.ensureProfilesReady();
    expect(reopened.profiles.getActiveProfileId()).toBe('main');
    for (const id of ['main', 'kid1', 'kid2']) {
      await enter(reopened, id);
      expect(await view(reopened)).toEqual(expected(id));
    }
  });

  test('the active profile survives a restart', async () => {
    const app = await boot(undefined, ['kid1']);
    await enter(app, 'kid1');
    app.family.addToWallet(7);
    await flush();
    const reopened = await loadApp(undefined, await app.dump());
    await reopened.profiles.ensureProfilesReady();
    expect(reopened.profiles.getActiveProfileId()).toBe('kid1');
    expect((await reopened.family.ensureFamilyLoaded()).wallet.pawTokens).toBe(7);
  });

  test('the mailbox and the mini-game progress are separate too', async () => {
    const mailMain = { version: 1, schedule: {}, pending: [{ id: 'mail-main', petId: 'p', designKey: 'd', title: 'Greetings from Pawadise!', message: '', arrivedAt: iso(T0) }] };
    const mailKid = { version: 1, schedule: {}, pending: [{ id: 'mail-kid1', petId: 'p', designKey: 'd', title: 'Greetings from Pawadise!', message: '', arrivedAt: iso(T0) }] };
    const app = await boot(
      {
        [`${P}pawadiseMail`]: mailMain,
        [scoped('kid1', 'pawadiseMail')]: mailKid,
        [`${P}kittyCatchHighScore`]: '40',
        [scoped('kid1', 'kittyCatchHighScore')]: '90',
        [`${P}memoryMatchBestMoves`]: { easy: 12 },
        [scoped('kid1', 'memoryMatchBestMoves')]: { easy: 8 },
      },
      ['kid1']
    );
    await app.family.ensureFamilyLoaded();
    expect((await app.mail.ensureMailLoaded()).pending.map((m) => m.id)).toEqual(['mail-main']);
    expect(await app.kitty.getKittyCatchHighScore()).toBe(40);
    expect(await app.memory.getMemoryMatchBestMoves()).toEqual({ easy: 12 });
    await enter(app, 'kid1');
    expect((await app.mail.ensureMailLoaded()).pending.map((m) => m.id)).toEqual(['mail-kid1']);
    expect(app.mail.getPendingMail().map((m) => m.id)).toEqual(['mail-kid1']);
    expect(await app.kitty.getKittyCatchHighScore()).toBe(90);
    expect(await app.memory.getMemoryMatchBestMoves()).toEqual({ easy: 8 });
  });

  test('mini-game daily reward limits are per profile (a round in one profile does not use another one’s limit)', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    const limit = app.kitty.KITTY_CATCH_DAILY_PLAY_REWARD_LIMIT;
    let paidMain = 0;
    for (let i = 0; i < limit + 2; i += 1) paidMain += (await app.kitty.completeKittyCatchRound(1)).playReward.awarded ? 1 : 0;
    expect(paidMain).toBe(limit);
    await enter(app, 'kid1');
    let paidKid = 0;
    for (let i = 0; i < limit + 2; i += 1) paidKid += (await app.kitty.completeKittyCatchRound(1)).playReward.awarded ? 1 : 0;
    expect(paidKid).toBe(limit); // a full, independent allowance
    expect(wallet(app)).toBe(limit * app.kitty.KITTY_CATCH_PLAY_REWARD);
    await enter(app, 'main');
    expect((await app.kitty.completeKittyCatchRound(1)).playReward.awarded).toBe(false); // main's allowance is still used up
  });

  test('toy sessions and per-profile timers do not carry over', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    expect(app.toySession.startToySession('pet-x', 'ball')).toBe(true);
    expect(app.toySession.getToySession('pet-x')).not.toBeNull();
    await enter(app, 'kid1');
    expect(app.toySession.getToySession('pet-x')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('three active pets per profile, independently', () => {
  test('each child can have three; the fourth is refused; other profiles are not affected', async () => {
    const app = await boot(mixed(), ['kid1', 'kid2']); // main already has 3 living pets
    await app.family.ensureFamilyLoaded();
    expect(await app.family.adoptNewEgg()).toEqual({ ok: false, reason: 'limit' });

    await enter(app, 'kid1');
    expect(living(app)).toHaveLength(1);
    expect((await app.family.adoptNewEgg()).ok).toBe(true);
    expect((await app.family.adoptNewEgg()).ok).toBe(true);
    expect(living(app)).toHaveLength(3);
    expect(await app.family.adoptNewEgg()).toEqual({ ok: false, reason: 'limit' });

    await enter(app, 'kid2');
    expect(living(app)).toHaveLength(1);
    expect((await app.family.adoptNewEgg()).ok).toBe(true);
    expect((await app.family.adoptNewEgg()).ok).toBe(true);
    expect(living(app)).toHaveLength(3);

    await enter(app, 'kid1');
    expect(living(app)).toHaveLength(3);
    await enter(app, 'main');
    expect(living(app).map((p) => p.id)).toEqual([BISCUIT, 'pet-1700000000001', LUNA]);
  });

  test('a free slot in one profile does not let another profile resurrect or adopt', async () => {
    const seed = { ...mixed(), [scoped('kid1', 'petFamily')]: (mixed()[FAMILY] as any) };
    const app = await boot(seed, ['kid1']);
    await app.family.ensureFamilyLoaded();
    expect(await app.family.resurrectPet(SHADOW)).toEqual({ ok: false, reason: 'no-slot' }); // main: 3 living
    await enter(app, 'kid1');
    // kid1 has an identical copy of the family (3 living). Retire one there only.
    expect(await app.family.retirePet(BISCUIT)).toEqual({ ok: true });
    expect(app.family.canAdoptMore(app.family.peekFamily()!)).toBe(true);
    expect(await app.family.resurrectPet(SHADOW)).toEqual({ ok: true });
    expect(wallet(app)).toBe(140);
    await enter(app, 'main');
    expect(app.family.canAdoptMore(app.family.peekFamily()!)).toBe(false);
    expect(wallet(app)).toBe(640); // main was never charged
    expect((app.family.peekFamily()!.pets.find((p) => p.id === SHADOW)!).lifecycle.state).toBe('deceased');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('rewards are never duplicated or shared between profiles', () => {
  test('the same task id completed in two profiles pays each profile once', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    await app.tokens.reconcilePawTokenEarnings([]); // new player: nothing completed yet
    await app.tokens.reconcilePawTokenEarnings([task('same', { completed: true })]);
    expect(wallet(app)).toBe(10);

    await enter(app, 'kid1');
    await app.tokens.reconcilePawTokenEarnings([]);
    await app.tokens.reconcilePawTokenEarnings([task('same', { completed: true })]);
    expect(wallet(app)).toBe(10);

    for (const id of ['main', 'kid1', 'main', 'kid1']) {
      await enter(app, id);
      await app.tokens.reconcilePawTokenEarnings([task('same', { completed: true })]);
      expect(wallet(app)).toBe(10); // switching back and forth never pays again
    }
    expect(JSON.parse((await app.dump()).get(AWARDED)!)).toEqual(['same']);
    expect(JSON.parse((await app.dump()).get(scoped('kid1', 'awardedTaskTokens'))!)).toEqual(['same']);
  });

  test('a reward in flight during a switch is paid to the profile it was earned in', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    await app.tokens.reconcilePawTokenEarnings([]);
    const pending = app.tokens.reconcilePawTokenEarnings([task('a', { completed: true }), task('b', { completed: true, important: true })]);
    const switched = app.profiles.switchProfile('kid1'); // started while the reward is still being calculated
    await pending;
    expect(await switched).toMatchObject({ ok: true });
    await app.family.ensureFamilyLoaded();
    expect(wallet(app)).toBe(0); // kid1 got nothing
    await enter(app, 'main');
    expect(wallet(app)).toBe(25);
  });

  test('a damaged paid-record in one profile is repaired there without touching others', async () => {
    const app = await boot({ [AWARDED]: ['m1'] , [scoped('kid1', 'awardedTaskTokens')]: '{ corrupt' }, ['kid1']);
    await enter(app, 'kid1');
    await app.tokens.reconcilePawTokenEarnings([task('k1', { completed: true })]);
    expect(wallet(app)).toBe(0);
    expect(app.tokens.getRewardHistoryStatus()?.state).toBe('recovered-corrupt');
    const keys = [...(await app.dump()).keys()];
    expect(keys.some((k) => k.startsWith(`${scoped('kid1', 'awardedTaskTokens')}.corrupt-`))).toBe(true);
    await enter(app, 'main');
    await app.tokens.reconcilePawTokenEarnings([task('m1', { completed: true }), task('m2', { completed: true })]);
    expect(app.tokens.getRewardHistoryStatus()?.state).toBe('ok');
    expect(wallet(app)).toBe(10); // only m2 is new
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('lifecycle rules are unchanged inside a child profile', () => {
  test('the same pets age, get sick and die on exactly the same timeline as in the main profile', async () => {
    const family = (mixed()[FAMILY] as any);
    const app = await boot({ ...mixed(), [scoped('kid1', 'petFamily')]: family }, ['kid1']);
    setClock(T0 + 80 * 3_600_000);
    const mainState = JSON.parse(JSON.stringify(await app.family.ensureFamilyLoaded()));
    await enter(app, 'kid1');
    const kidState = JSON.parse(JSON.stringify(app.family.peekFamily()));
    expect(kidState).toEqual(mainState);
    expect(kidState.pets.find((p: any) => p.id === LUNA).lifecycle.diedAt).toBe(iso(T0 + 66 * 3_600_000));
    expect(kidState.pets.find((p: any) => p.id === 'pet-1700000000001').lifecycle.state).toBe('critical');
  });

  test('an inactive profile keeps aging by the clock (documented limitation) and catches up when opened', async () => {
    const family = (mixed()[FAMILY] as any);
    const app = await boot({ [scoped('kid1', 'petFamily')]: family }, ['kid1']);
    await app.family.ensureFamilyLoaded(); // main: a fresh egg
    setClock(T0 + 10 * DAY);
    await enter(app, 'kid1'); // opened 10 days later
    const s = app.family.peekFamily()!;
    expect(s.pets.find((p) => p.id === LUNA)!.lifecycle.state).toBe('deceased');
    expect(s.pets.find((p) => p.id === LUNA)!.lifecycle.diedAt).toBe(iso(T0 + 66 * 3_600_000)); // at its deadline, not at opening
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('switching safely', () => {
  test('switching to the active profile does nothing; an unknown profile is refused', async () => {
    const app = await boot(undefined, ['kid1']);
    expect(await app.profiles.switchProfile('main')).toEqual({ ok: true, changed: false });
    expect(await app.profiles.switchProfile('nobody')).toEqual({ ok: false, reason: 'unknown-profile' });
    expect(app.profiles.getActiveProfileId()).toBe('main');
  });

  test('listeners are told, and the generation changes', async () => {
    const app = await boot(undefined, ['kid1']);
    const seen: string[] = [];
    app.profiles.subscribeToActiveProfile((id) => seen.push(id));
    const g = app.profiles.getProfileGeneration();
    await app.profiles.switchProfile('kid1');
    await app.profiles.switchProfile('main');
    expect(seen).toEqual(['kid1', 'main']);
    expect(app.profiles.getProfileGeneration()).toBe(g + 2);
  });

  test('rapid, overlapping switches are applied in order and nothing is mixed up', async () => {
    const app = await boot(undefined, ['kid1', 'kid2']);
    await app.family.ensureFamilyLoaded();
    const counts: Record<string, number> = { main: 0, kid1: 0, kid2: 0 };
    const order = ['kid1', 'kid2', 'main', 'kid2', 'kid1', 'main', 'main', 'kid1', 'kid2', 'kid1', 'main'];
    const results = order.map((id) => app.profiles.switchProfile(id)); // all fired at once
    expect((await Promise.all(results)).every((r) => r.ok)).toBe(true);
    expect(app.profiles.getActiveProfileId()).toBe('main');
    // Now alternate with writes between switches and no waiting for saves.
    for (let i = 0; i < 30; i += 1) {
      const id = ['main', 'kid1', 'kid2'][i % 3];
      await enter(app, id);
      app.family.addToWallet(1);
      counts[id] += 1;
    }
    for (const id of ['main', 'kid1', 'kid2']) {
      await enter(app, id);
      expect(wallet(app)).toBe(counts[id]);
    }
    await flush();
    expect((await app.read('petFamily')).wallet.pawTokens).toBe(counts.main);
    expect(JSON.parse((await app.dump()).get(scoped('kid2', 'petFamily'))!).wallet.pawTokens).toBe(counts.kid2);
  });

  test('a slow pending save finishes in the profile it belongs to before the switch happens', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    await flush();
    const realSet = app.AsyncStorage.setItem;
    const log: string[] = [];
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      await new Promise((r) => setTimeout(r, 60));
      log.push(key);
      return realSet(key, value);
    });
    app.family.addToWallet(33);
    const result = await app.profiles.switchProfile('kid1');
    app.AsyncStorage.setItem = realSet;
    expect(result).toMatchObject({ ok: true });
    expect(log).toContain(FAMILY); // main's save landed first
    expect((await app.read('petFamily')).wallet.pawTokens).toBe(33);
    await app.family.ensureFamilyLoaded();
    expect(wallet(app)).toBe(0);
    expect(log.filter((k) => k === scoped('kid1', 'petFamily')).length).toBeLessThanOrEqual(1); // only the new child's own first record
  });

  test('an unsaved change blocks the switch (nothing is dropped); once saving works again the switch succeeds', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    await flush();
    const realSet = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string) => {
      if (key === FAMILY) throw new Error('disk full');
      return undefined;
    });
    app.family.addToWallet(50);
    const blocked = await app.profiles.switchProfile('kid1');
    expect(blocked).toEqual({ ok: false, reason: 'unsaved-changes', keys: [FAMILY] });
    expect(app.profiles.getActiveProfileId()).toBe('main');
    expect(wallet(app)).toBe(50); // still held in memory, not discarded
    app.AsyncStorage.setItem = realSet;
    expect(await app.profiles.switchProfile('kid1')).toMatchObject({ ok: true });
    expect((await app.read('petFamily')).wallet.pawTokens).toBe(50); // the held change was saved on the retry
  });

  test('an operation still running when the switch is requested finishes first, in its own profile', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    await enter(app, 'kid1');
    await flush();
    const realSet = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      await new Promise((r) => setTimeout(r, 40));
      return realSet(key, value);
    });
    const adopting = app.family.adoptNewEgg(); // slow save in kid1
    const switching = app.profiles.switchProfile('main');
    expect((await adopting).ok).toBe(true);
    expect(await switching).toMatchObject({ ok: true });
    app.AsyncStorage.setItem = realSet;
    await app.family.ensureFamilyLoaded();
    expect(living(app)).toHaveLength(1); // main did not get kid1's new egg
    await enter(app, 'kid1');
    expect(living(app)).toHaveLength(2);
  });

  test('a read that started in one profile cannot fill another profile’s cache', async () => {
    const app = await boot({ [`${P}tasks`]: [task('main-task')], [scoped('kid1', 'tasks')]: [task('kid-task')] }, ['kid1']);
    await app.family.ensureFamilyLoaded();
    const realGet = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === `${P}tasks`) await new Promise((r) => setTimeout(r, 60));
      return realGet(key);
    });
    const slowRead = app.taskStorage.getCachedTasks(); // main's tasks, slow
    const switched = app.profiles.switchProfile('kid1');
    expect((await slowRead).map((t) => t.id)).toEqual(['main-task']);
    expect(await switched).toMatchObject({ ok: true });
    app.AsyncStorage.getItem = realGet;
    expect((await app.taskStorage.getCachedTasks()).map((t) => t.id)).toEqual(['kid-task']);
    await enter(app, 'main');
    expect((await app.taskStorage.getCachedTasks()).map((t) => t.id)).toEqual(['main-task']);
  });

  test('if the registry cannot be saved the switch is undone and the app keeps working in the old profile', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(12);
    const realSet = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === REGISTRY) throw new Error('disk full');
      return realSet(key, value);
    });
    expect(await app.profiles.switchProfile('kid1')).toEqual({ ok: false, reason: 'storage' });
    app.AsyncStorage.setItem = realSet;
    expect(app.profiles.getActiveProfileId()).toBe('main');
    await app.family.ensureFamilyLoaded();
    expect(wallet(app)).toBe(12); // reloaded from the saved record
  });

  test('a switch that cannot settle in time is cancelled and nothing changes', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    app.profiles.trackOperation(new Promise(() => {})); // never finishes
    expect(await app.profiles.switchProfile('kid1', { timeoutMs: 50 })).toEqual({ ok: false, reason: 'timeout' });
    expect(app.profiles.getActiveProfileId()).toBe('main');
  });

  test('everything scheduled or shown for the profile being left is cancelled and cleared; its schedule record is emptied', async () => {
    const app = await boot({ [`${P}petAlertSchedule`]: ['n1', 'n2'] }, ['kid1']);
    const Notifications = require('expo-notifications');
    await app.family.ensureFamilyLoaded();
    await app.alerts.getAlertSettings();
    await enter(app, 'kid1');
    await flush();
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
    expect((await app.dump()).get(`${P}petAlertSchedule`)).toBe('[]');
  });
});
