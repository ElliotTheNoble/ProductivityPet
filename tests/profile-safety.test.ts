import { T0, fixture, flush, freezeClock, iso, loadApp, unfreezeClock, type App } from './helpers';

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
const REGISTRY = `${P}profiles`;
const BACKUP_PREFIX = `${P}backup:preM2:`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;

beforeEach(() => freezeClock(T0));
afterEach(() => unfreezeClock());

const mixed = () => ({ [FAMILY]: (fixture('family-v1-mixed') as Record<string, unknown>)[FAMILY] });

async function boot(seed?: Record<string, unknown>, children: string[] = []): Promise<App> {
  const app = await loadApp(seed);
  await app.profiles.ensureProfilesReady();
  for (const id of children) expect(await app.profiles.registerChildProfile(id)).toMatchObject({ ok: true });
  return app;
}
async function enter(app: App, id: string) {
  expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
  return app.family.ensureFamilyLoaded();
}
const wallet = (app: App) => app.family.getWalletBalance();
const notifications = () => require('expo-notifications');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Replaces one AsyncStorage method for a test and returns a function that puts the original back.
function patch(app: App, name: 'setItem' | 'getItem', fn: (key: string, value: string, original: any) => Promise<any>) {
  const original = app.AsyncStorage[name];
  app.AsyncStorage[name] = jest.fn(async (key: string, value: string) => fn(key, value, original));
  return () => {
    app.AsyncStorage[name] = original;
  };
}

// ---------------------------------------------------------------------------------------------------------
describe('a failed switch leaves the current profile completely active', () => {
  test('registry write fails: nothing is reset, nothing is cancelled, pending writes are still saved', async () => {
    const app = await boot(mixed(), ['kid1']);
    const before = await app.family.ensureFamilyLoaded();
    await app.alerts.getAlertSettings();
    app.toySession.startToySession('pet-x', 'ball');
    const reset = jest.fn();
    app.profiles.registerProfileStore({ name: 'probe', reset });
    app.family.addToWallet(7); // an unsaved change at the moment of the switch
    const restore = patch(app, 'setItem', async (key, value, original) => {
      if (key === REGISTRY) throw new Error('disk full');
      return original(key, value);
    });
    const generation = app.profiles.getProfileGeneration();
    expect(await app.profiles.switchProfile('kid1')).toEqual({ ok: false, reason: 'storage' });
    restore();

    expect(app.profiles.getActiveProfileId()).toBe('main');
    expect(app.profiles.getProfileGeneration()).toBe(generation);
    expect(reset).not.toHaveBeenCalled(); // no store dropped anything
    expect(app.family.peekFamily()).not.toBeNull(); // the family is still in memory (same session)
    expect(app.family.peekFamily()!.pets).toHaveLength(before.pets.length);
    expect(app.toySession.getToySession('pet-x')).not.toBeNull(); // timers untouched
    expect(notifications().cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(notifications().dismissAllNotificationsAsync).not.toHaveBeenCalled();
    expect(wallet(app)).toBe(647);
    expect((await app.read('petFamily')).wallet.pawTokens).toBe(647); // the pending write was not lost
    expect(JSON.parse((await app.dump()).get(REGISTRY)!).activeProfileId).toBe('main');
    // and a later switch still works
    expect(await app.profiles.switchProfile('kid1')).toMatchObject({ ok: true });
  });

  test('a failed switch never touches the scheduled alert record', async () => {
    const app = await boot({ [`${P}petAlertSchedule`]: ['n1', 'n2'] }, ['kid1']);
    await app.family.ensureFamilyLoaded();
    const restore = patch(app, 'setItem', async (key, value, original) => {
      if (key === REGISTRY) throw new Error('disk full');
      return original(key, value);
    });
    expect(await app.profiles.switchProfile('kid1')).toEqual({ ok: false, reason: 'storage' });
    restore();
    expect((await app.dump()).get(`${P}petAlertSchedule`)).toBe(JSON.stringify(['n1', 'n2']));
    expect(notifications().cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });

  test('work that starts while the registry is being saved finishes in the OLD profile before the swap', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    await flush();
    const restore = patch(app, 'setItem', async (key, value, original) => {
      if (key === REGISTRY) await sleep(80); // a slow registry write: the window the old code left open
      return original(key, value);
    });
    const switching = app.profiles.switchProfile('kid1');
    await sleep(20); // the switch is now inside the registry write
    expect(app.profiles.getActiveProfileId()).toBe('main'); // memory has not changed yet
    const adopting = app.family.adoptNewEgg(); // user taps while the switch is in progress
    expect((await adopting).ok).toBe(true);
    expect(await switching).toMatchObject({ ok: true, changed: true });
    restore();
    // The egg belongs to main; the child has only its own first egg.
    expect(JSON.parse((await app.dump()).get(FAMILY)!).pets).toHaveLength(2);
    expect(await app.family.ensureFamilyLoaded()).toBeTruthy();
    expect(app.family.peekFamily()!.pets).toHaveLength(1);
    await enter(app, 'main');
    expect(app.family.peekFamily()!.pets).toHaveLength(2);
  });

  test('a save that fails while the registry is being written cancels the switch and puts the old id back', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    await flush();
    const reset = jest.fn();
    app.profiles.registerProfileStore({ name: 'probe', reset });
    let changed = false;
    const restore = patch(app, 'setItem', async (key, value, original) => {
      if (key === REGISTRY) {
        if (!changed) app.family.addToWallet(5); // a change made during the switch (once)...
        changed = true;
        return original(key, value);
      }
      if (key === FAMILY) throw new Error('disk full'); // ...whose save fails
      return original(key, value);
    });
    const result = await app.profiles.switchProfile('kid1');
    restore();
    expect(result).toMatchObject({ ok: false, reason: 'unsaved-changes' });
    expect(app.profiles.getActiveProfileId()).toBe('main');
    expect(reset).not.toHaveBeenCalled();
    expect(JSON.parse((await app.dump()).get(REGISTRY)!).activeProfileId).toBe('main'); // the old id is back
    expect(wallet(app)).toBe(5); // still held in memory, not discarded
    expect(notifications().cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });

  test('a store that fails to reset: the switch is undone, nothing is cancelled, data reloads correctly', async () => {
    const app = await boot(mixed(), ['kid1']);
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(3);
    let broken = true;
    app.profiles.registerProfileStore({
      name: 'broken',
      reset: () => {
        if (broken) throw new Error('cannot reset');
      },
    });
    expect(await app.profiles.switchProfile('kid1')).toEqual({ ok: false, reason: 'storage' });
    expect(app.profiles.getActiveProfileId()).toBe('main');
    expect(JSON.parse((await app.dump()).get(REGISTRY)!).activeProfileId).toBe('main');
    expect(notifications().cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect((await app.family.ensureFamilyLoaded()).wallet.pawTokens).toBe(643); // saved before the attempt, reloaded
    broken = false;
    expect(await app.profiles.switchProfile('kid1')).toMatchObject({ ok: true });
  });

  test('interrupted right after the registry write (app killed): the next start opens the new profile with all data intact and separate', async () => {
    const app = await boot(mixed(), ['kid1']);
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(11);
    let snapshot: Map<string, string> | null = null;
    const restore = patch(app, 'setItem', async (key, value, original) => {
      const result = await original(key, value);
      if (key === REGISTRY && value.includes('"activeProfileId":"kid1"')) snapshot = await app.dump(); // "killed" here
      return result;
    });
    await app.profiles.switchProfile('kid1');
    restore();
    expect(snapshot).not.toBeNull();
    const restarted = await loadApp(undefined, snapshot!);
    await restarted.profiles.ensureProfilesReady();
    expect(restarted.profiles.getActiveProfileId()).toBe('kid1');
    expect((await restarted.family.ensureFamilyLoaded()).wallet.pawTokens).toBe(0); // the child's own fresh record
    expect(restarted.family.peekFamily()!.pets).toHaveLength(1);
    await enter(restarted, 'main');
    expect(wallet(restarted)).toBe(651); // main's pending change had been saved before the registry was touched
  });

  test('a switch that cannot settle in time changes nothing (including the registry)', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    app.profiles.trackOperation(new Promise(() => {}));
    expect(await app.profiles.switchProfile('kid1', { timeoutMs: 50 })).toEqual({ ok: false, reason: 'timeout' });
    expect(JSON.parse((await app.dump()).get(REGISTRY)!).activeProfileId).toBe('main');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('notification privacy', () => {
  test('after a real switch everything scheduled or shown is cancelled/cleared, exactly once', async () => {
    const app = await boot(undefined, ['kid1']);
    await app.family.ensureFamilyLoaded();
    await enter(app, 'kid1');
    await flush();
    expect(notifications().cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(notifications().dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  test('reminders scheduled in an earlier session are cancelled even though this session never loaded the tasks', async () => {
    const task = { id: 't1', text: 'Call the dentist', category: 'Personal', important: false, kind: 'event', date: '2026-03-12', completed: false, scheduledNotificationId: 'old-notification' };
    const app = await boot({ [`${P}tasks`]: [task] }, ['kid1']);
    await app.family.ensureFamilyLoaded(); // tasks are NOT loaded
    await enter(app, 'kid1');
    await flush();
    expect(notifications().cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  test('a notification failure (not available here) cannot block or undo a switch', async () => {
    const app = await boot(undefined, ['kid1']);
    const n = notifications();
    n.cancelAllScheduledNotificationsAsync.mockRejectedValueOnce(new Error('unsupported'));
    n.dismissAllNotificationsAsync.mockRejectedValueOnce(new Error('unsupported'));
    await app.family.ensureFamilyLoaded();
    expect(await app.profiles.switchProfile('kid1')).toMatchObject({ ok: true });
    await flush();
    expect(app.profiles.getActiveProfileId()).toBe('kid1');
  });

  test('alerts scheduled while a child is active mention only that child’s pets', async () => {
    const mainFamily = JSON.parse(JSON.stringify(mixed()[FAMILY]));
    const kidFamily = JSON.parse(JSON.stringify(mixed()[FAMILY]));
    for (const p of kidFamily.pets) p.name = p.name ? `${p.name}-KID` : p.name;
    const app = await boot({ [FAMILY]: mainFamily, [scoped('kid1', 'petFamily')]: kidFamily, [scoped('kid1', 'petAlertSettings')]: { notifications: true, vibration: true, flash: false } }, ['kid1']);
    await enter(app, 'kid1');
    notifications().scheduleNotificationAsync.mockClear();
    await app.alerts.syncPetAlerts();
    const texts = notifications().scheduleNotificationAsync.mock.calls.map((c: any[]) => `${c[0].content.title} ${c[0].content.body}`).join(' | ');
    expect(texts).toContain('-KID');
    expect(texts).not.toMatch(/(Biscuit|Mochi|Luna)(?!-KID)/); // every pet name that appears is the child's own
  });
});

// ---------------------------------------------------------------------------------------------------------
// A tiny model of a full disk: writes that would take the total size over the limit fail like the browser's
// QuotaExceededError (a replaced value only counts its growth).
function limitStorage(app: App, usedNow: number, extra: number) {
  const sizes = new Map<string, number>();
  let total = 0;
  const limit = usedNow + extra;
  const original = app.AsyncStorage.setItem;
  const note = (key: string, value: string) => {
    total += key.length + value.length - (sizes.get(key) ?? 0);
    sizes.set(key, key.length + value.length);
  };
  app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
    const growth = key.length + value.length - (sizes.get(key) ?? 0);
    if (total + growth > limit) {
      const error = new Error('QuotaExceededError: The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }
    await original(key, value);
    note(key, value);
  });
  return {
    seed(dump: Map<string, string>) {
      for (const [k, v] of dump) note(k, v);
    },
    restore() {
      app.AsyncStorage.setItem = original;
    },
    used: () => total,
  };
}

const sizeOf = (dump: Map<string, string>) => [...dump].reduce((sum, [k, v]) => sum + k.length + v.length, 0);

describe('full or nearly full storage', () => {
  const noDeletes = (app: App) => {
    const spies = { removeItem: jest.fn(), multiRemove: jest.fn(), clear: jest.fn(), mergeItem: jest.fn() };
    Object.assign(app.AsyncStorage, spies);
    return spies;
  };
  const expectNoDeletes = (spies: Record<string, jest.Mock>) => {
    for (const [name, spy] of Object.entries(spies)) expect([name, spy.mock.calls.length]).toEqual([name, 0]);
  };

  test('no room for the backup: safe mode, originals untouched, nothing deleted, Main still works', async () => {
    const app = await loadApp(mixed());
    const before = await app.dump();
    const spies = noDeletes(app);
    const disk = limitStorage(app, sizeOf(before), 60); // room for a few bytes only
    disk.seed(before);
    await app.profiles.ensureProfilesReady();
    expect(app.profiles.getProfilesStatus()).toMatchObject({ state: 'safe-mode', issue: 'backup-failed', backup: null });
    const after = await app.dump();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort()); // no backup, no registry, nothing else appeared
    for (const [k, v] of before) expect(after.get(k)).toBe(v);
    expect(await app.profiles.registerChildProfile('kid1')).toEqual({ ok: false, reason: 'unavailable' });
    // Main keeps working in the space it already has (a same-size change fits).
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(10); // 640 -> 650, same length
    await flush();
    expect((await app.read('petFamily')).wallet.pawTokens).toBe(650);
    expectNoDeletes(spies);
  });

  test('room for the backup but not for the registry: kept, reused later (no second copy), nothing deleted', async () => {
    const app = await loadApp(mixed());
    const before = await app.dump();
    const spies = noDeletes(app);
    const backupSize = JSON.stringify({ version: 1, createdAt: iso(T0), keyCount: before.size, entries: Object.fromEntries(before) }).length + 40;
    const disk = limitStorage(app, sizeOf(before), backupSize + 5); // the registry will not fit
    disk.seed(before);
    await app.profiles.ensureProfilesReady();
    expect(app.profiles.getProfilesStatus()).toMatchObject({ state: 'safe-mode', issue: 'registry-write-failed' });
    const backups = [...(await app.dump()).keys()].filter((k) => k.startsWith(BACKUP_PREFIX));
    expect(backups).toHaveLength(1);
    expect((await app.dump()).has(REGISTRY)).toBe(false);
    disk.restore();
    // "Space was freed": the next start reuses the same backup.
    const restarted = await loadApp(undefined, await app.dump());
    await restarted.profiles.ensureProfilesReady();
    expect(restarted.profiles.getProfilesStatus().state).toBe('ready');
    expect([...(await restarted.dump()).keys()].filter((k) => k.startsWith(BACKUP_PREFIX))).toEqual(backups);
    expectNoDeletes(spies);
  });

  test('the backup cannot be read back (the read throws): safe mode, originals untouched', async () => {
    const app = await loadApp(mixed());
    const before = await app.dump();
    patch(app, 'getItem', async (key, _v, original) => {
      if (key.startsWith(BACKUP_PREFIX)) throw new Error('row too big');
      return original(key);
    });
    await app.profiles.ensureProfilesReady();
    expect(app.profiles.getProfilesStatus()).toMatchObject({ state: 'safe-mode', issue: 'backup-failed' });
    const after = await app.dump().catch(() => before);
    for (const [k, v] of before) expect(after.get(k)).toBe(v);
    expect((await app.dump().catch(() => new Map<string, string>())).has(REGISTRY)).toBe(false);
  });

  test('a backup that cannot be verified is kept (never overwritten or deleted); repeated failures stop adding copies', async () => {
    const broken = (n: number) => ({ [`${BACKUP_PREFIX}${String(n).padStart(15, '0')}`]: '{ truncated' });
    const one = await loadApp({ ...mixed(), ...broken(1) });
    const spies = noDeletes(one);
    await one.profiles.ensureProfilesReady();
    expect(one.profiles.getProfilesStatus().state).toBe('ready'); // one bad copy: a new, verified one is made
    const keys = [...(await one.dump()).keys()].filter((k) => k.startsWith(BACKUP_PREFIX));
    expect(keys).toHaveLength(2);
    expect((await one.dump()).get(`${BACKUP_PREFIX}${String(1).padStart(15, '0')}`)).toBe('{ truncated');

    const three = await loadApp({ ...mixed(), ...broken(1), ...broken(2), ...broken(3) });
    await three.profiles.ensureProfilesReady();
    expect(three.profiles.getProfilesStatus()).toMatchObject({ state: 'safe-mode', issue: 'backup-failed' });
    expect([...(await three.dump()).keys()].filter((k) => k.startsWith(BACKUP_PREFIX))).toHaveLength(3); // no fourth
    expect((await three.dump()).has(REGISTRY)).toBe(false);
    expectNoDeletes(spies);
  });

  test('nothing is ever deleted: initialization, a successful switch, a failed switch and registering a child', async () => {
    const app = await loadApp(mixed());
    const spies = noDeletes(app);
    await app.profiles.ensureProfilesReady();
    await app.profiles.registerChildProfile('kid1');
    await app.family.ensureFamilyLoaded();
    await app.profiles.switchProfile('kid1');
    await app.profiles.switchProfile('main');
    const restore = patch(app, 'setItem', async (key, value, original) => {
      if (key === REGISTRY) throw new Error('full');
      return original(key, value);
    });
    await app.profiles.switchProfile('kid1');
    restore();
    await flush();
    expectNoDeletes(spies);
  });
});
