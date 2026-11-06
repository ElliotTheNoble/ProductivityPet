import { HOUR, T0, TEST_PIN, configurePin, freezeClock, iso, loadApp, pet, resetSecure, setClock, unfreezeClock, type App } from './helpers';

// Stage 3.2 to 3.5, the data side: add, rename, archive and restore a child, the "storage may be full" hint, and the read-only family
// health report. Real PIN module, real parent gate, real household and profile registry over an in-memory storage.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
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
const HOUSEHOLD = `${P}household`;
const REGISTRY = `${P}profiles`;
const BACKUP = `${P}backup:preM2:`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const child = (id: string, nickname = id, extra: object = {}) => ({
  id,
  nickname,
  createdAt: iso(T0),
  settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' },
  tasks: [],
  ...extra,
});
const household = (children: object[]) => JSON.stringify({ version: 1, parent: null, children, selectedChildId: null });
const family = (pets: object[]) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens: 42 } });
const sick = (id: string, hoursAgo: number) =>
  pet({ id, p: { hunger: 0, lastUpdatedAt: iso(T0 - HOUR) }, lifecycle: { state: 'sick', sickSince: iso(T0 - hoursAgo * HOUR), exhausted: false, lastEvaluatedAt: iso(T0 - HOUR) } });

const M = () => require('@/utils/family-management') as typeof import('@/utils/family-management');
const H = () => require('@/utils/household') as typeof import('@/utils/household');
const FP = () => require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');

type Options = { family?: boolean; seed?: Record<string, string>; unlocked?: boolean; noPin?: boolean };
async function boot(options: Options = {}): Promise<App> {
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  resetSecure();
  const app = await loadApp(options.seed);
  await app.profiles.ensureProfilesReady();
  if (options.family !== false && !options.noPin) {
    await configurePin(app, { unlocked: options.unlocked !== false });
    await FP().reconcileFamilyProfiles(); // every household child gets its profile record, as at app start
  }
  M().resetCreationFailures();
  return app;
}
const stored = async (app: App, key: string) => app.AsyncStorage.getItem(key);
const keysOf = async (app: App, id: string) => {
  const all = await app.dump();
  return [...all].filter(([k]) => k.startsWith(`${P}p:${id}:`)).sort(([a], [b]) => a.localeCompare(b));
};
const mainKeys = async (app: App) =>
  [...(await app.dump())].filter(([k]) => !k.startsWith(`${P}p:`) && k !== REGISTRY && k !== HOUSEHOLD && !k.startsWith(BACKUP) && !k.includes('parentAuth')).sort(([a], [b]) => a.localeCompare(b));
const failFor = (app: App, match: (key: string) => boolean) => {
  const original = app.AsyncStorage.setItem;
  app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
    if (match(key)) throw new Error('storage failed');
    return original(key, value);
  });
  return () => {
    app.AsyncStorage.setItem = original;
  };
};

const kidSeed = () => ({
  [HOUSEHOLD]: household([child('kid-a', 'Mia', { tasks: [{ id: 't1', text: 'x', createdBy: 'parent', status: 'assigned', createdAt: iso(T0) }] }), child('kid-b', 'Leo')]),
  [scoped('kid-a', 'petFamily')]: family([pet({ id: 'a1' })]),
  [scoped('kid-a', 'ownedShopItems')]: JSON.stringify(['hat-1']),
  [scoped('kid-b', 'petFamily')]: family([sick('b1', 2)]),
  [`${P}petFamily`]: family([pet({ id: 'main-pet' })]),
  [`${P}tasks`]: JSON.stringify([{ id: 'main-task', text: 'm' }]),
});

// ---------------------------------------------------------------------------------------------------------
describe('adding a child', () => {
  test('a saved child has a permanent id that is also its profile id, and nothing else is touched', async () => {
    const app = await boot({ seed: kidSeed() });
    const main = await mainKeys(app);
    const result = await M().createChild('  Zoe  ');
    expect(result).toMatchObject({ ok: true });
    const id = (result as { id: string }).id;
    expect(JSON.parse((await stored(app, HOUSEHOLD))!).children.map((c: { id: string; nickname: string }) => [c.id, c.nickname])).toContainEqual([id, 'Zoe']);
    expect(JSON.parse((await stored(app, REGISTRY))!).profiles.map((p: { id: string }) => p.id)).toContain(id);
    expect(await mainKeys(app)).toEqual(main);
    expect(await keysOf(app, id)).toEqual([]); // a new child has no saved data yet; the starter egg appears when they first play
  });

  test('an empty nickname is refused without touching anything', async () => {
    const app = await boot({ seed: kidSeed() });
    const before = await stored(app, HOUSEHOLD);
    expect(await M().createChild('   ')).toEqual({ ok: false, reason: 'invalid' });
    expect(await stored(app, HOUSEHOLD)).toBe(before);
  });

  test('one storage failure says it could not be saved; only the SECOND in a row mentions that storage may be full', async () => {
    const app = await boot({ seed: kidSeed() });
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    expect(await M().createChild('Zoe')).toEqual({ ok: false, reason: 'storage', storageMayBeFull: false });
    expect(await M().createChild('Zoe')).toEqual({ ok: false, reason: 'storage', storageMayBeFull: true });
    expect(await M().createChild('Zoe')).toEqual({ ok: false, reason: 'storage', storageMayBeFull: true });
    restore();
    expect(await M().createChild('Zoe')).toMatchObject({ ok: true }); // a success starts the count again
    const again = failFor(app, (k) => k === HOUSEHOLD);
    expect(await M().createChild('Kai')).toEqual({ ok: false, reason: 'storage', storageMayBeFull: false });
    again();
  });

  test('a failure for any other reason (or a different failure in between) never gets the "full" hint and breaks the run', async () => {
    const app = await boot({ seed: kidSeed() });
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    expect(await M().createChild('Zoe')).toMatchObject({ storageMayBeFull: false });
    app.gate.lockParentArea(); // a different failure in between: the session ended
    expect(await M().createChild('Zoe')).toEqual({ ok: false, reason: 'locked' });
    await app.gate.unlockParentArea(TEST_PIN);
    expect(await M().createChild('Zoe')).toEqual({ ok: false, reason: 'storage', storageMayBeFull: false }); // counting again from one
    restore();
  });

  test('failed attempts leave only invisible empty profiles: no child appears, nothing is deleted, nothing is merged', async () => {
    const app = await boot({ seed: kidSeed() });
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    for (let i = 0; i < 3; i += 1) await M().createChild('Zoe');
    restore();
    expect(JSON.parse((await stored(app, HOUSEHOLD))!).children).toHaveLength(2);
    const health = await M().inspectFamilyHealth();
    expect(health.orphansEmpty).toHaveLength(3);
    expect(health.orphansWithData).toEqual([]);
    expect((await FP().getSelectableChildren()).map((c) => c.id).sort()).toEqual(['kid-a', 'kid-b']);
  });

  test('an unavailable family (safe mode) is reported as unavailable, never as "storage may be full"', async () => {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    resetSecure();
    const app = await loadApp({});
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key.startsWith(BACKUP)) throw new Error('disk full');
      return original(key, value);
    });
    await app.profiles.ensureProfilesReady();
    await configurePin(app, { unlocked: true });
    expect(app.profiles.getProfilesStatus().state).toBe('safe-mode');
    expect(await M().createChild('Zoe')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await M().createChild('Zoe')).toEqual({ ok: false, reason: 'unavailable' });
    app.AsyncStorage.setItem = original;
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('a newly added child, when first opened', () => {
  test('is one selectable profile with one starter egg and two empty pet slots, and adding does not duplicate it', async () => {
    const app = await boot({ seed: kidSeed() });
    const id = ((await M().createChild('Zoe')) as { id: string }).id;
    expect((await FP().getSelectableChildren()).filter((c) => c.id === id)).toHaveLength(1);
    expect(JSON.parse((await stored(app, HOUSEHOLD))!).children.filter((c: { id: string }) => c.id === id)).toHaveLength(1);
    expect(JSON.parse((await stored(app, REGISTRY))!).profiles.filter((p: { id: string }) => p.id === id)).toHaveLength(1);

    await app.profiles.switchProfile(id);
    const state = await app.family.ensureFamilyLoaded();
    expect(state.pets).toHaveLength(1); // the starter egg, nothing else
    expect(state.pets[0].profile.hatchedAt).toBeFalsy();
    expect(state.pets[0].growthUnits).toBe(0);
    const { MAX_LIVING_PETS } = require('@/utils/pet-family-config') as typeof import('@/utils/pet-family-config');
    expect(MAX_LIVING_PETS - app.family.getLivingPets(state).length).toBe(2); // two empty slots
    await app.profiles.releaseActiveProfile();
  });
});

describe('renaming a child', () => {
  test('only the nickname changes: the permanent id and every saved record of the child stay byte for byte', async () => {
    const app = await boot({ seed: kidSeed() });
    const before = await keysOf(app, 'kid-a');
    const main = await mainKeys(app);
    expect(await M().renameChildSafe('kid-a', '  Mimi  ')).toEqual({ ok: true });
    const saved = JSON.parse((await stored(app, HOUSEHOLD))!).children.find((c: { id: string }) => c.id === 'kid-a');
    expect(saved).toMatchObject({ id: 'kid-a', nickname: 'Mimi' });
    expect(saved.tasks).toHaveLength(1);
    expect(await keysOf(app, 'kid-a')).toEqual(before);
    expect(await mainKeys(app)).toEqual(main);
  });

  test('a failed save changes nothing (memory and disk) and says storage', async () => {
    const app = await boot({ seed: kidSeed() });
    const before = await stored(app, HOUSEHOLD);
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    expect(await M().renameChildSafe('kid-a', 'Mimi')).toEqual({ ok: false, reason: 'storage' });
    restore();
    expect(H().peekHousehold()!.children.find((c) => c.id === 'kid-a')!.nickname).toBe('Mia');
    expect(await stored(app, HOUSEHOLD)).toBe(before);
  });

  test('another tab changed the list first: the newer list is adopted, nothing overwritten, then it is a conflict only if it keeps changing', async () => {
    const app = await boot({ seed: kidSeed() });
    await H().ensureHouseholdLoaded();
    const other = JSON.parse((await stored(app, HOUSEHOLD))!);
    other.children.push(child('kid-c', 'Newcomer'));
    other.revision = 9;
    await app.AsyncStorage.setItem(HOUSEHOLD, JSON.stringify(other));
    expect(await M().renameChildSafe('kid-a', 'Mimi')).toEqual({ ok: true });
    expect(JSON.parse((await stored(app, HOUSEHOLD))!).children.map((c: { id: string }) => c.id)).toEqual(['kid-a', 'kid-b', 'kid-c']);
  });

  test('an unknown child is "not found"', async () => {
    await boot({ seed: kidSeed() });
    expect(await M().renameChildSafe('nobody', 'X')).toEqual({ ok: false, reason: 'not-found' });
  });

  test('two children may share a nickname: only a friendly warning is offered, and the rename is allowed', async () => {
    const app = await boot({ seed: kidSeed() });
    const h = H().peekHousehold() ?? (await H().ensureHouseholdLoaded());
    expect(M().findSameNickname(h, '  leo ')?.id).toBe('kid-b'); // case and spaces are ignored
    expect(M().findSameNickname(h, 'Leo', 'kid-b')).toBeNull(); // not against itself
    expect(M().findSameNickname(h, '   ')).toBeNull();
    expect(await M().renameChildSafe('kid-a', 'Leo')).toEqual({ ok: true });
    const saved = JSON.parse((await stored(app, HOUSEHOLD))!).children;
    expect(saved.map((c: { id: string; nickname: string }) => [c.id, c.nickname])).toEqual([['kid-a', 'Leo'], ['kid-b', 'Leo']]);
  });

  test('an archived child counts for the duplicate warning too', async () => {
    await boot({ seed: kidSeed() });
    await M().archiveChild('kid-b');
    const h = H().peekHousehold()!;
    expect(M().findSameNickname(h, 'Leo')?.id).toBe('kid-b');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('archiving and restoring', () => {
  test('archiving hides the child from the picker and deletes nothing: every saved record is byte for byte as it was', async () => {
    const app = await boot({ seed: kidSeed() });
    const before = await keysOf(app, 'kid-a');
    const main = await mainKeys(app);
    expect(await M().archiveChild('kid-a')).toEqual({ ok: true });
    expect(JSON.parse((await stored(app, HOUSEHOLD))!).children.find((c: { id: string }) => c.id === 'kid-a').archivedAt).toEqual(expect.any(String));
    expect((await FP().getSelectableChildren()).map((c) => c.id)).toEqual(['kid-b']); // gone from the picker
    expect((await FP().peekProfileCare('kid-a')).status).toBe('ok'); // the saved pets are still there and still read
    expect(await keysOf(app, 'kid-a')).toEqual(before);
    expect(await mainKeys(app)).toEqual(main);
    expect(JSON.parse((await stored(app, REGISTRY))!).profiles.map((p: { id: string }) => p.id)).toContain('kid-a');
  });

  test('restoring brings the same child back with the same id and every record unchanged', async () => {
    const app = await boot({ seed: kidSeed() });
    const before = await keysOf(app, 'kid-a');
    await M().archiveChild('kid-a');
    expect(await M().restoreChild('kid-a')).toEqual({ ok: true });
    const restored = JSON.parse((await stored(app, HOUSEHOLD))!).children.find((c: { id: string }) => c.id === 'kid-a');
    expect(restored.id).toBe('kid-a');
    expect(restored.nickname).toBe('Mia');
    expect(restored.tasks).toHaveLength(1);
    expect(restored.archivedAt).toBeUndefined();
    expect((await FP().getSelectableChildren()).map((c) => c.id).sort()).toEqual(['kid-a', 'kid-b']);
    expect(await keysOf(app, 'kid-a')).toEqual(before);
  });

  test('a child cannot be archived while their profile is the one in use; any other child can', async () => {
    const app = await boot({ seed: kidSeed() });
    expect(await app.profiles.switchProfile('kid-a')).toMatchObject({ ok: true });
    const before = await stored(app, HOUSEHOLD);
    expect(await M().archiveChild('kid-a')).toEqual({ ok: false, reason: 'active-profile' });
    expect(await stored(app, HOUSEHOLD)).toBe(before);
    await app.gate.unlockParentArea(TEST_PIN); // a profile change locks the parent area
    expect(await M().archiveChild('kid-b')).toEqual({ ok: true });
    await app.profiles.releaseActiveProfile(); // at the picker nobody is in a profile
    await app.gate.unlockParentArea(TEST_PIN);
    expect(await M().archiveChild('kid-a')).toEqual({ ok: true });
  });

  test('archiving the selected child moves the selection to an active one, and nothing else changes', async () => {
    await boot({ seed: kidSeed() });
    await H().selectChild('kid-a');
    expect(H().peekHousehold()!.selectedChildId).toBe('kid-a');
    await M().archiveChild('kid-a');
    expect(H().peekHousehold()!.selectedChildId).toBe('kid-b');
  });

  test('a failed archive or restore changes nothing', async () => {
    const app = await boot({ seed: kidSeed() });
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    const before = await stored(app, HOUSEHOLD);
    expect(await M().archiveChild('kid-a')).toEqual({ ok: false, reason: 'storage' });
    expect(await stored(app, HOUSEHOLD)).toBe(before);
    restore();
    await M().archiveChild('kid-a');
    const archivedBytes = await stored(app, HOUSEHOLD);
    const restore2 = failFor(app, (k) => k === HOUSEHOLD);
    expect(await M().restoreChild('kid-a')).toEqual({ ok: false, reason: 'storage' });
    restore2();
    expect(await stored(app, HOUSEHOLD)).toBe(archivedBytes); // still archived, nothing lost
  });

  test('restoring makes sure the profile record exists first, and if that fails the child stays archived', async () => {
    const seed = { [HOUSEHOLD]: household([child('kid-a', 'Mia', { archivedAt: iso(T0) })]) }; // no saved data, so no profile record exists yet
    const app = await boot({ seed, noPin: true });
    await configurePin(app, { unlocked: true }); // a household with children needs the setup claim; the helper grants it
    const registryBefore = await stored(app, REGISTRY);
    const restore = failFor(app, (k) => k === REGISTRY);
    expect(await M().restoreChild('kid-a')).toEqual({ ok: false, reason: 'storage' });
    restore();
    expect(await stored(app, REGISTRY)).toBe(registryBefore);
    expect(JSON.parse((await stored(app, HOUSEHOLD))!).children[0].archivedAt).toBeDefined();
    expect(await M().restoreChild('kid-a')).toEqual({ ok: true });
    expect(JSON.parse((await stored(app, REGISTRY))!).profiles.map((p: { id: string }) => p.id)).toContain('kid-a');
  });

  test('archive summary: the pets status right now, read-only', async () => {
    const app = await boot({ seed: kidSeed() });
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    setItem.mockClear();
    expect(await M().getArchiveSummary('kid-b')).toMatchObject({ status: 'ok', worst: 'sick' });
    expect(await M().getArchiveSummary('kid-a')).toMatchObject({ status: 'ok', worst: 'healthy' });
    expect(setItem).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('every management action rechecks the verified parent session before it saves', () => {
  const run: [string, () => Promise<unknown>][] = [
    ['createChild', () => M().createChild('Zoe')],
    ['renameChildSafe', () => M().renameChildSafe('kid-a', 'Mimi')],
    ['archiveChild', () => M().archiveChild('kid-a')],
    ['restoreChild', () => M().restoreChild('kid-a')],
  ];

  test.each(run)('%s: a locked session is refused, and nothing is written (not even a profile record)', async (_name, action) => {
    const app = await boot({ seed: { ...kidSeed(), [HOUSEHOLD]: household([child('kid-a', 'Mia', { archivedAt: iso(T0) }), child('kid-b')]) } });
    app.gate.lockParentArea();
    const before = new Map(await app.dump());
    expect(await action()).toEqual({ ok: false, reason: 'locked' });
    expect(new Map(await app.dump())).toEqual(before);
  });

  test.each(run)('%s: an expired session is refused', async (_name, action) => {
    const app = await boot({ seed: kidSeed() });
    setClock(T0 + 6 * 60 * 1000);
    const before = new Map(await app.dump());
    expect(await action()).toEqual({ ok: false, reason: 'locked' });
    expect(new Map(await app.dump())).toEqual(before);
  });

  test.each(run)('%s: a session revoked while it runs is refused at the last look', async (name, action) => {
    // restoring needs an archived child; every other action works on an active one
    const archived = name === 'restoreChild';
    const app = await boot({ seed: { ...kidSeed(), [HOUSEHOLD]: household([child('kid-a', 'Mia', { archivedAt: archived ? iso(T0) : undefined }), child('kid-b')]) } });
    await H().ensureHouseholdLoaded();
    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      const value = await original(key);
      if (key === HOUSEHOLD) app.gate.lockParentArea();
      return value;
    });
    const result = (await action()) as { ok: boolean; reason?: string };
    app.AsyncStorage.getItem = original;
    expect(result).toMatchObject({ ok: false, reason: 'locked' });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('duplicate child ids keep the family read-only', () => {
  test('every action is "blocked", the stored text is never changed, and the report says why', async () => {
    const text = household([child('dup', 'One'), child('dup', 'Two'), child('kid-b', 'Leo')]);
    const app = await boot({ seed: { [HOUSEHOLD]: text }, noPin: true });
    await configurePin(app, { unlocked: true });
    expect(await M().createChild('New')).toEqual({ ok: false, reason: 'blocked' });
    expect(await M().renameChildSafe('kid-b', 'X')).toEqual({ ok: false, reason: 'blocked' });
    expect(await M().archiveChild('kid-b')).toEqual({ ok: false, reason: 'blocked' });
    expect(await M().restoreChild('kid-b')).toEqual({ ok: false, reason: 'blocked' });
    expect(await stored(app, HOUSEHOLD)).toBe(text);
    expect((await M().inspectFamilyHealth()).duplicateChildIds).toEqual(['dup']);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the family health report is read-only and shows only what needs a look', () => {
  test('a healthy family reports nothing', async () => {
    await boot({ seed: { [HOUSEHOLD]: household([child('kid-a', 'Mia')]), [scoped('kid-a', 'petFamily')]: family([pet({ id: 'a1' })]) } });
    const health = await M().inspectFamilyHealth();
    expect(M().healthHasWarnings(health)).toBe(false);
  });

  test('children whose pets need care are listed, archived ones marked, and an unreadable record is said to be unreadable', async () => {
    const app = await boot({
      seed: {
        [HOUSEHOLD]: household([child('kid-a', 'Mia'), child('kid-b', 'Leo', { archivedAt: iso(T0) }), child('kid-c', 'Kai')]),
        [scoped('kid-a', 'petFamily')]: family([pet({ id: 'a1', p: { hunger: 20 } })]),
        [scoped('kid-b', 'petFamily')]: family([sick('b1', 30)]),
        [scoped('kid-c', 'petFamily')]: '{broken',
      },
    });
    const health = await M().inspectFamilyHealth();
    expect(health.needsCare.map((n) => [n.nickname, n.archived, n.summary.worst])).toEqual([
      ['Mia', false, 'needs-care'],
      ['Leo', true, 'critical'],
    ]);
    expect(health.unreadablePets).toEqual([{ id: 'kid-c', nickname: 'Kai', archived: false }]);
    expect(await stored(app, scoped('kid-c', 'petFamily'))).toBe('{broken'); // not touched
  });

  test('orphan profiles are reported as empty or holding data, and are never deleted or changed', async () => {
    const app = await boot({ seed: kidSeed() });
    await app.profiles.registerChildProfile('ghost-empty');
    await app.profiles.registerChildProfile('ghost-data');
    await app.AsyncStorage.setItem(scoped('ghost-data', 'petFamily'), family([pet({ id: 'g1' })]));
    await app.AsyncStorage.setItem(scoped('ghost-data', 'ownedShopItems'), '[]');
    const before = new Map(await app.dump());
    const health = await M().inspectFamilyHealth();
    expect(health.orphansEmpty).toEqual(['ghost-empty']);
    expect(health.orphansWithData).toEqual([{ id: 'ghost-data', keys: 2 }]);
    expect(new Map(await app.dump())).toEqual(before); // nothing written, deleted or merged
    const again = await FP().reconcileFamilyProfiles();
    expect([...again.orphanProfiles].sort()).toEqual(['ghost-data', 'ghost-empty']);
    expect(new Map(await app.dump())).toEqual(before);
  });

  test('children without a profile record, ids that cannot be profile ids, unreadable entries and an unreadable list are all reported', async () => {
    const app = await boot({ seed: kidSeed() });
    await app.AsyncStorage.setItem(HOUSEHOLD, JSON.stringify({ ...JSON.parse((await stored(app, HOUSEHOLD))!), children: [child('kid-a', 'Mia'), child('bad id!', 'Ghost'), child('kid-new', 'New'), { id: 'x' }] }));
    await H().reloadHousehold();
    const health = await M().inspectFamilyHealth();
    expect(health.invalidIds).toEqual(['bad id!']);
    expect(health.unlinkedChildren).toEqual(['kid-new']);
    expect(health.unreadableEntries).toBe(1);

    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === HOUSEHOLD) throw new Error('read failed');
      return original(key);
    });
    expect(await H().reloadHousehold()).toBe(false);
    app.AsyncStorage.getItem = original;
  });

  test('safe mode (storage cannot hold the backup) is reported, and nothing else is guessed', async () => {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    resetSecure();
    const app = await loadApp({ [HOUSEHOLD]: household([child('kid-a')]) });
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key.startsWith(BACKUP)) throw new Error('disk full');
      return original(key, value);
    });
    await app.profiles.ensureProfilesReady();
    const health = await M().inspectFamilyHealth();
    expect(health.storagePaused).toBe(true);
    expect(health.orphansEmpty).toEqual([]);
    app.AsyncStorage.setItem = original;
  });

  test('every report starts clean: a finding that was fixed is gone at the next look (no findings are kept between looks)', async () => {
    const app = await boot({ seed: kidSeed() });
    await app.profiles.registerChildProfile('ghost-empty');
    const first = await M().inspectFamilyHealth();
    expect(first.needsCare.map((n) => n.id)).toEqual(['kid-b']);
    expect(first.orphansEmpty).toEqual(['ghost-empty']);
    await app.AsyncStorage.setItem(scoped('kid-b', 'petFamily'), family([pet({ id: 'b1' })])); // Leo's pet was looked after
    const second = await M().inspectFamilyHealth();
    expect(second.needsCare).toEqual([]);
    expect(second.orphansEmpty).toEqual(['ghost-empty']); // still there, still not deleted
    expect(second.needsCare).not.toBe(first.needsCare); // a new list each time
    expect(M().EMPTY_HEALTH.needsCare).toEqual([]);
    expect(Object.isFrozen(M().EMPTY_HEALTH)).toBe(true);
  });

  test('it only reads: no write at all', async () => {
    const app = await boot({ seed: kidSeed() });
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    const multiSet = jest.spyOn(app.AsyncStorage, 'multiSet');
    setItem.mockClear();
    multiSet.mockClear();
    await M().inspectFamilyHealth();
    expect(setItem).not.toHaveBeenCalled();
    expect(multiSet).not.toHaveBeenCalled();
  });

  test('with family mode off nothing is reported', async () => {
    await boot({ family: false, seed: kidSeed() });
    expect(await M().inspectFamilyHealth()).toEqual(M().EMPTY_HEALTH);
    expect(M().healthHasWarnings(await M().inspectFamilyHealth())).toBe(false);
  });
});

describe('family mode off: the original management still works, with the same safeguards for saving', () => {
  test('add, rename and archive work as before (no parent session is needed, nothing PIN-related is loaded)', async () => {
    const app = await boot({ family: false, seed: kidSeed() });
    expect(await M().createChild('Zoe')).toMatchObject({ ok: true });
    expect(await M().renameChildSafe('kid-a', 'Mimi')).toEqual({ ok: true });
    expect(await stored(app, REGISTRY)).toBeDefined();
    const ids = JSON.parse((await stored(app, REGISTRY))!).profiles.map((p: { id: string }) => p.id);
    expect(ids).not.toContain((await H().ensureHouseholdLoaded()).children.find((c) => c.nickname === 'Zoe')!.id); // no profile is made without family mode
  });
});
