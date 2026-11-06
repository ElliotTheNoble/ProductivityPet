import { DAY, HOUR, T0, fixture, flush, freezeClock, iso, loadApp, pet, unfreezeClock, type App } from './helpers';

// Family profile picker, Stage 1: the data layer behind it (releasing a profile, tracked household saves, reconciliation with
// the profile registry, read-only care summaries). No screen exists yet; these tests are about what can never be lost or mixed up.

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
const HOUSEHOLD = `${P}household`;
const BACKUP_PREFIX = `${P}backup:preM2:`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.clearAllMocks();
});

const notifications = () => require('expo-notifications');
const H = () => require('@/utils/household') as typeof import('@/utils/household');
const FP = () => require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');
const mixed = () => ({ [FAMILY]: (fixture('family-v1-mixed') as Record<string, unknown>)[FAMILY] });

type Options = { seed?: Record<string, unknown>; familyMode?: boolean; unlocked?: boolean | 'locked'; storage?: Map<string, string> };

// Boots the app. With `familyMode` the development-only flag is on (as in `EXPO_PUBLIC_FAMILY_MODE=1 expo start`); `unlocked`
// registers a stand-in PIN checker and opens (true) or leaves locked ('locked') the parent area; nothing = no PIN at all.
async function boot(options: Options = {}): Promise<App> {
  if (options.familyMode) process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  else delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  const app = await loadApp(options.seed, options.storage);
  await app.profiles.ensureProfilesReady();
  if (options.unlocked !== undefined) {
    app.gate.registerPinVerifier({ isConfigured: async () => true, verify: async () => true });
    if (options.unlocked === true) app.gate.openParentSession();
  }
  return app;
}
const bootFamily = (extra: Options = {}) => boot({ familyMode: true, unlocked: true, ...extra });

// Replaces one AsyncStorage method and returns the function that puts the original back.
function patch(app: App, name: 'setItem' | 'getItem', fn: (key: string, value: string, original: any) => Promise<any>) {
  const original = app.AsyncStorage[name];
  app.AsyncStorage[name] = jest.fn(async (key: string, value: string) => fn(key, value, original));
  return () => {
    app.AsyncStorage[name] = original;
  };
}
const failFor = (match: (key: string) => boolean) => async (key: string, value: string, original: any) => {
  if (match(key)) throw new Error('storage failed');
  return original(key, value);
};

const stored = async (app: App, key: string) => (await app.dump()).get(key);
const registryOf = async (app: App) => JSON.parse((await stored(app, REGISTRY))!);
const household = async (app: App) => JSON.parse((await stored(app, HOUSEHOLD))!);

function householdJson(children: object[], extra: object = {}) {
  return JSON.stringify({ version: 1, parent: null, children, selectedChildId: null, ...extra });
}
const child = (id: string, nickname = id, extra: object = {}) => ({
  id,
  nickname,
  createdAt: iso(T0),
  settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' },
  tasks: [],
  ...extra,
});

// ---------------------------------------------------------------------------------------------------------
describe('releasing the active profile (back to the picker)', () => {
  async function inKid() {
    const app = await boot();
    await app.profiles.registerChildProfile('kid1');
    await app.profiles.registerChildProfile('kid2');
    await app.profiles.switchProfile('kid1');
    await app.family.ensureFamilyLoaded();
    return app;
  }

  test('a pending write finishes in the profile it belongs to, then no profile is active and nothing is held in memory', async () => {
    const app = await inKid();
    app.family.addToWallet(5); // not saved yet
    const registryBefore = await stored(app, REGISTRY);
    expect(await app.profiles.releaseActiveProfile()).toEqual({ ok: true, changed: true });
    expect((JSON.parse((await stored(app, scoped('kid1', 'petFamily')))!) as { wallet: { pawTokens: number } }).wallet.pawTokens).toBe(5);
    expect(app.profiles.isProfileReleased()).toBe(true);
    expect(app.profiles.getProfilesStatus().released).toBe(true);
    expect(app.family.peekFamily()).toBeNull();
    expect(app.profiles.getActiveProfileId()).toBe('kid1'); // only the last-used pointer
    expect(await stored(app, REGISTRY)).toBe(registryBefore); // nothing was written to the registry
  });

  test('listeners are told, the parent area locks, and the phone notifications of the profile being left are cancelled once', async () => {
    const app = await inKid();
    app.gate.registerPinVerifier({ isConfigured: async () => true, verify: async () => true });
    app.gate.startParentGateAutoLock(); // the app shell does this once at start
    await app.gate.unlockParentArea('123456');
    expect((await app.gate.getParentAccess()).state).toBe('unlocked');
    const seen: string[] = [];
    app.profiles.subscribeToActiveProfile((id) => seen.push(id));
    const generation = app.profiles.getProfileGeneration();
    notifications().cancelAllScheduledNotificationsAsync.mockClear();
    notifications().dismissAllNotificationsAsync.mockClear();
    await app.profiles.releaseActiveProfile();
    await flush();
    expect(seen).toEqual(['kid1']);
    expect(app.profiles.getProfileGeneration()).toBe(generation + 1);
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    expect(notifications().cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(notifications().dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  test('releasing again changes nothing', async () => {
    const app = await inKid();
    await app.profiles.releaseActiveProfile();
    const generation = app.profiles.getProfileGeneration();
    notifications().cancelAllScheduledNotificationsAsync.mockClear();
    expect(await app.profiles.releaseActiveProfile()).toEqual({ ok: true, changed: false });
    expect(app.profiles.getProfileGeneration()).toBe(generation);
    expect(notifications().cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });

  test('while released no store can load or save anything, and nothing is written', async () => {
    const app = await inKid();
    await app.profiles.releaseActiveProfile();
    const before = await app.dump();
    expect(() => app.profiles.scopedKey('petFamily')).toThrow('profile-released');
    await expect(app.family.ensureFamilyLoaded()).rejects.toThrow('profile-released');
    expect(app.profiles.isActiveProfileLegacy()).toBe(false);
    expect(await app.dump()).toEqual(before);
    expect(app.family.peekFamily()).toBeNull();
  });

  test('choosing the last-used profile afterwards works, with its data intact; another profile shows only its own', async () => {
    const app = await inKid();
    app.family.addToWallet(40);
    await app.profiles.releaseActiveProfile();
    expect(await app.profiles.switchProfile('kid2')).toEqual({ ok: true, changed: true });
    expect(app.profiles.isProfileReleased()).toBe(false);
    expect(app.profiles.getActiveProfileId()).toBe('kid2');
    await app.family.ensureFamilyLoaded();
    expect(app.family.getWalletBalance()).toBe(0);
    await app.profiles.releaseActiveProfile();
    expect(await app.profiles.switchProfile('kid2')).toEqual({ ok: true, changed: true }); // the same one that was last used
    await app.profiles.releaseActiveProfile();
    expect(await app.profiles.switchProfile('kid1')).toEqual({ ok: true, changed: true });
    await app.family.ensureFamilyLoaded();
    expect(app.family.getWalletBalance()).toBe(40);
  });

  test('an unsaved change blocks the release: nothing is reset, nothing is dropped, and it works once saving works again', async () => {
    const app = await inKid();
    const restore = patch(app, 'setItem', failFor((k) => k === scoped('kid1', 'petFamily')));
    app.family.addToWallet(3);
    notifications().cancelAllScheduledNotificationsAsync.mockClear();
    const result = await app.profiles.releaseActiveProfile();
    expect(result).toMatchObject({ ok: false, reason: 'unsaved-changes' });
    expect(app.profiles.isProfileReleased()).toBe(false);
    expect(app.family.peekFamily()).not.toBeNull();
    expect(app.family.getWalletBalance()).toBe(3);
    expect(notifications().cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    restore();
    expect(await app.profiles.releaseActiveProfile()).toEqual({ ok: true, changed: true });
    expect((JSON.parse((await stored(app, scoped('kid1', 'petFamily')))!) as { wallet: { pawTokens: number } }).wallet.pawTokens).toBe(3);
  });

  test('a save that cannot finish in time cancels the release and changes nothing', async () => {
    const app = await inKid();
    const never = new Promise<void>(() => {});
    const restore = patch(app, 'setItem', async (key, value, original) => (key === scoped('kid1', 'petFamily') ? never : original(key, value)));
    app.family.addToWallet(1);
    expect(await app.profiles.releaseActiveProfile({ timeoutMs: 40 })).toEqual({ ok: false, reason: 'timeout' });
    expect(app.profiles.isProfileReleased()).toBe(false);
    expect(app.family.peekFamily()).not.toBeNull();
    restore();
  });

  test('a store that cannot reset undoes the release: the profile stays active, nothing is cancelled', async () => {
    const app = await inKid();
    app.profiles.registerProfileStore({
      name: 'broken',
      reset: () => {
        throw new Error('cannot reset');
      },
    });
    notifications().cancelAllScheduledNotificationsAsync.mockClear();
    expect(await app.profiles.releaseActiveProfile()).toEqual({ ok: false, reason: 'storage' });
    expect(app.profiles.isProfileReleased()).toBe(false);
    expect(app.profiles.getActiveProfileId()).toBe('kid1');
    expect(notifications().cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(app.profiles.scopedKey('petFamily')).toBe(scoped('kid1', 'petFamily')); // keys work again
  });

  test('in safe mode (storage too full for the backup) there is nothing to release', async () => {
    const app = await loadApp(mixed());
    patch(app, 'setItem', failFor((k) => k.startsWith(BACKUP_PREFIX)));
    await app.profiles.ensureProfilesReady();
    expect(app.profiles.getProfilesStatus().state).toBe('safe-mode');
    expect(await app.profiles.releaseActiveProfile()).toEqual({ ok: false, reason: 'unavailable' });
    expect(app.profiles.isProfileReleased()).toBe(false);
  });

  test('cold start: reading the registry, the household, reconciling and listing children loads no profile data at all', async () => {
    const first = await bootFamily({ seed: mixed() });
    const made = await H().addChild('Mia');
    expect(made.ok).toBe(true);
    await first.profiles.switchProfile((made as { id: string }).id);
    await first.family.ensureFamilyLoaded();
    first.family.addToWallet(9);
    await first.profiles.releaseActiveProfile();
    const disk = await first.dump();
    expect(JSON.parse(disk.get(REGISTRY)!).activeProfileId).toBe((made as { id: string }).id); // the last-used pointer survives

    const second = await bootFamily({ storage: disk });
    const reads: string[] = [];
    const original = second.AsyncStorage.getItem;
    second.AsyncStorage.getItem = jest.fn(async (key: string) => {
      reads.push(key);
      return original(key);
    });
    await FP().reconcileFamilyProfiles();
    expect((await FP().getSelectableChildren()).map((c) => c.nickname)).toEqual(['Mia']);
    for (const key of reads) {
      expect([REGISTRY, HOUSEHOLD, ...[...disk.keys()].filter((k) => k.startsWith(BACKUP_PREFIX))]).toContain(key);
    }
    expect(second.family.peekFamily()).toBeNull();
    second.AsyncStorage.getItem = original;
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the profile registry in two tabs', () => {
  async function otherTabAdds(app: App, id: string) {
    const reg = await registryOf(app);
    reg.profiles.push({ id, kind: 'child', storage: 'scoped', createdAt: iso(T0) });
    reg.revision = (reg.revision ?? 0) + 1;
    await app.AsyncStorage.setItem(REGISTRY, JSON.stringify(reg));
  }

  test('registering a profile adopts a newer registry and adds only its own record (the other tab\'s profile is kept)', async () => {
    const app = await boot();
    await app.profiles.registerChildProfile('kid1');
    await otherTabAdds(app, 'from-other-tab');
    expect(await app.profiles.registerChildProfile('mine')).toEqual({ ok: true, created: true });
    const reg = await registryOf(app);
    expect(reg.profiles.map((p: { id: string }) => p.id)).toEqual(['main', 'kid1', 'from-other-tab', 'mine']);
    expect(reg.revision).toBeGreaterThan(1);
  });

  test('a switch to a profile another tab just added works (the newer registry is adopted once)', async () => {
    const app = await boot();
    await otherTabAdds(app, 'kid9');
    expect(await app.profiles.switchProfile('kid9')).toEqual({ ok: true, changed: true });
    expect(app.profiles.getActiveProfileId()).toBe('kid9');
    expect((await registryOf(app)).activeProfileId).toBe('kid9');
  });

  test('a registry that cannot be understood is never written over', async () => {
    const app = await boot();
    await app.AsyncStorage.setItem(REGISTRY, '{"junk":true}');
    expect(await app.profiles.registerChildProfile('kid1')).toEqual({ ok: false, reason: 'conflict' });
    expect(await stored(app, REGISTRY)).toBe('{"junk":true}');
    expect(await app.profiles.switchProfile('main')).toEqual({ ok: true, changed: false });
  });

  test('registering a profile that already exists writes nothing (a repeated or interrupted creation never makes a second one)', async () => {
    const app = await boot();
    await app.profiles.registerChildProfile('kid1');
    const before = await stored(app, REGISTRY);
    const spy = jest.spyOn(app.AsyncStorage, 'setItem');
    spy.mockClear();
    expect(await app.profiles.registerChildProfile('kid1')).toEqual({ ok: true, created: false });
    expect(spy).not.toHaveBeenCalled();
    expect(await stored(app, REGISTRY)).toBe(before);
  });

  test('each save increases the revision, and a registry written before revisions existed keeps working', async () => {
    const app = await boot();
    const reg = await registryOf(app);
    expect(reg.revision ?? 0).toBe(0);
    await app.profiles.registerChildProfile('kid1');
    expect((await registryOf(app)).revision).toBe(1);
    await app.profiles.switchProfile('kid1');
    expect((await registryOf(app)).revision).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('household saves', () => {
  test('family mode off: adding a child works as before, saves a revision, and creates no storage profile', async () => {
    const app = await boot();
    const registryBefore = await stored(app, REGISTRY);
    const result = await H().addChild('Mia');
    expect(result).toMatchObject({ ok: true });
    const saved = await household(app);
    expect(saved.children).toHaveLength(1);
    expect(saved.revision).toBe(1);
    expect(await stored(app, REGISTRY)).toBe(registryBefore);
  });

  test('family mode on, no Parent PIN yet: a child cannot be added, and nothing is saved or registered', async () => {
    const app = await boot({ familyMode: true });
    const registryBefore = await stored(app, REGISTRY);
    expect(await H().addChild('Mia')).toEqual({ ok: false, reason: 'pin-required' });
    expect(await stored(app, HOUSEHOLD)).toBeUndefined();
    expect(await stored(app, REGISTRY)).toBe(registryBefore);
  });

  test('family mode on, parent area locked: child management is refused', async () => {
    const app = await boot({ familyMode: true, unlocked: 'locked' });
    expect(await H().addChild('Mia')).toEqual({ ok: false, reason: 'locked' });
    expect(await H().renameChild('x', 'Y')).toEqual({ ok: false, reason: 'locked' });
    expect(await H().setChildArchived('x', true)).toEqual({ ok: false, reason: 'locked' });
    expect(await stored(app, HOUSEHOLD)).toBeUndefined();
  });

  test('family mode on and unlocked: the child gets a storage profile with the SAME id, and is selectable', async () => {
    const app = await bootFamily();
    const result = await H().addChild('  Mia ');
    expect(result.ok).toBe(true);
    const id = (result as { id: string }).id;
    expect(/^[A-Za-z0-9_-]{1,64}$/.test(id)).toBe(true);
    expect((await registryOf(app)).profiles).toContainEqual(expect.objectContaining({ id, kind: 'child', storage: 'scoped' }));
    expect((await household(app)).children[0]).toMatchObject({ id, nickname: 'Mia' });
    expect((await FP().getSelectableChildren()).map((c) => c.id)).toEqual([id]);
    // no child data exists yet: the starter egg appears only when the child is first opened
    expect([...(await app.dump()).keys()].filter((k) => k.startsWith(`${P}p:`))).toEqual([]);
  });

  test('a failed save is reported, changes nothing in memory or on disk, and a later retry cannot bring it back', async () => {
    const app = await bootFamily();
    const id = ((await H().addChild('Mia')) as { id: string }).id;
    const before = await stored(app, HOUSEHOLD);
    const restore = patch(app, 'setItem', failFor((k) => k === HOUSEHOLD));
    expect(await H().renameChild(id, 'Zoe')).toEqual({ ok: false, reason: 'storage' });
    expect(H().peekHousehold()!.children[0].nickname).toBe('Mia');
    restore();
    expect(await stored(app, HOUSEHOLD)).toBe(before);
    // leaving a profile retries failed writes: the household must not be one of them
    await app.profiles.switchProfile(id);
    await app.profiles.releaseActiveProfile();
    expect(await stored(app, HOUSEHOLD)).toBe(before);
    expect(await H().renameChild(id, 'Zoe')).toMatchObject({ ok: true });
    expect((await household(app)).children[0].nickname).toBe('Zoe');
  });

  test('a household that cannot be read is never written over; once it can be read, the change is made on top of what is stored', async () => {
    const seed = { [HOUSEHOLD]: householdJson([child('kid1', 'Mia')]) };
    const app = await boot({ seed });
    let failing = true;
    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (failing && key === HOUSEHOLD) throw new Error('read failed');
      return original(key);
    });
    const spy = jest.spyOn(app.AsyncStorage, 'setItem');
    spy.mockClear();
    expect(await H().saveParentProfile('Dad', 'Smith')).toEqual({ ok: false, reason: 'storage' });
    expect(H().getHouseholdIntegrity().loadFailed).toBe(true);
    expect(spy.mock.calls.some((c) => c[0] === HOUSEHOLD)).toBe(false);
    failing = false;
    expect(await H().saveParentProfile('Dad', 'Smith')).toMatchObject({ ok: true });
    const saved = await household(app);
    expect(saved.children.map((c: { id: string }) => c.id)).toEqual(['kid1']); // what was stored is still there
    expect(saved.parent).toEqual({ displayName: 'Dad', familyName: 'Smith' });
    app.AsyncStorage.getItem = original;
  });

  test('a newer household saved by another tab is adopted, and the change is applied on top of it (nothing of the other tab is lost)', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: householdJson([child('kid1', 'Mia')]) } });
    await H().ensureHouseholdLoaded();
    const other = JSON.parse((await stored(app, HOUSEHOLD))!);
    other.children.push(child('kid2', 'Leo'));
    other.revision = 5;
    await app.AsyncStorage.setItem(HOUSEHOLD, JSON.stringify(other));
    expect(await H().renameChild('kid1', 'Mimi')).toMatchObject({ ok: true });
    const saved = await household(app);
    expect(saved.children.map((c: { id: string; nickname: string }) => `${c.id}:${c.nickname}`)).toEqual(['kid1:Mimi', 'kid2:Leo']);
    expect(saved.revision).toBe(6);
  });

  test('if the household keeps changing under it, the change is refused as a conflict and nothing is written', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: householdJson([child('kid1', 'Mia')]) } });
    await H().ensureHouseholdLoaded();
    const original = app.AsyncStorage.getItem;
    let revision = 10;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key !== HOUSEHOLD) return original(key);
      revision += 1;
      return householdJson([child('kid1', 'Mia')], { revision });
    });
    const spy = jest.spyOn(app.AsyncStorage, 'setItem');
    spy.mockClear();
    expect(await H().renameChild('kid1', 'Mimi')).toEqual({ ok: false, reason: 'conflict' });
    expect(spy.mock.calls.some((c) => c[0] === HOUSEHOLD)).toBe(false);
    app.AsyncStorage.getItem = original;
  });

  test('a write that another tab races (what is read back is not what was written) is a conflict, not a success; memory follows the disk', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: householdJson([child('kid1', 'Mia')]) } });
    await H().ensureHouseholdLoaded();
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      // the other tab's save lands right after ours
      await original(key, key === HOUSEHOLD ? householdJson([child('kid1', 'Other')], { revision: JSON.parse(value).revision }) : value);
    });
    expect(await H().renameChild('kid1', 'Mimi')).toEqual({ ok: false, reason: 'conflict' });
    expect(H().peekHousehold()!.children[0].nickname).toBe('Other');
    expect((await household(app)).children[0].nickname).toBe('Other');
    app.AsyncStorage.setItem = original;
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('child creation interrupted, orphans, duplicates and unreadable records', () => {
  test('the household save fails after the profile was registered: an invisible empty profile is left, and nothing duplicates on retry', async () => {
    const app = await bootFamily();
    const restore = patch(app, 'setItem', failFor((k) => k === HOUSEHOLD));
    expect(await H().addChild('Mia')).toEqual({ ok: false, reason: 'storage' });
    restore();
    const reg = await registryOf(app);
    const orphan = reg.profiles.find((p: { kind: string }) => p.kind === 'child').id;
    expect(await stored(app, HOUSEHOLD)).toBeUndefined();
    expect(await FP().getSelectableChildren()).toEqual([]); // never selectable without a household record
    const registryBytes = await stored(app, REGISTRY);

    const report = await FP().reconcileFamilyProfiles();
    expect(report).toMatchObject({ status: 'ok', orphanProfiles: [orphan], registered: [] });
    expect(await stored(app, REGISTRY)).toBe(registryBytes); // reported, not deleted, not changed

    const retry = (await H().addChild('Mia')) as { id: string };
    expect(retry.id).not.toBe(orphan); // a new id: no child can ever appear twice
    expect((await FP().getSelectableChildren()).map((c) => c.id)).toEqual([retry.id]);
    expect((await household(app)).children).toHaveLength(1);
    expect((await FP().reconcileFamilyProfiles()).orphanProfiles).toEqual([orphan]);
  });

  test('three failed attempts in a row leave three invisible empty profiles, never a selectable duplicate; one success makes exactly one child', async () => {
    const app = await bootFamily();
    const restore = patch(app, 'setItem', failFor((k) => k === HOUSEHOLD));
    for (let i = 0; i < 3; i += 1) expect(await H().addChild('Mia')).toEqual({ ok: false, reason: 'storage' });
    restore();
    expect(await FP().getSelectableChildren()).toEqual([]);
    const orphans = (await registryOf(app)).profiles.filter((p: { kind: string }) => p.kind === 'child').map((p: { id: string }) => p.id);
    expect(new Set(orphans).size).toBe(3);
    expect([...(await app.dump()).keys()].filter((k) => k.startsWith(`${P}p:`))).toEqual([]); // no data was ever created for them
    expect(await stored(app, HOUSEHOLD)).toBeUndefined();

    const made = (await H().addChild('Mia')) as { id: string };
    expect(orphans).not.toContain(made.id);
    expect((await FP().getSelectableChildren()).map((c) => c.id)).toEqual([made.id]);
    expect((await household(app)).children).toHaveLength(1);
    const report = await FP().reconcileFamilyProfiles();
    expect([...report.orphanProfiles].sort()).toEqual([...orphans].sort()); // all three still reported, none deleted or merged
    expect((await registryOf(app)).profiles.filter((p: { kind: string }) => p.kind === 'child')).toHaveLength(4);
  });

  test('the app is closed between the two steps: after a restart the orphan is reported and nothing is deleted', async () => {
    const first = await bootFamily();
    const restore = patch(first, 'setItem', failFor((k) => k === HOUSEHOLD));
    await H().addChild('Mia');
    restore();
    const disk = await first.dump();

    const second = await bootFamily({ storage: disk });
    const report = await FP().reconcileFamilyProfiles();
    expect(report.orphanProfiles).toHaveLength(1);
    expect(report.registered).toEqual([]);
    const after = await second.dump();
    for (const [key, value] of disk) expect(after.get(key)).toBe(value); // every key still there, byte for byte
    expect(await FP().getSelectableChildren()).toEqual([]);
  });

  test('household children created before profiles existed are registered once; running it again changes nothing', async () => {
    const seed = { [HOUSEHOLD]: householdJson([child('kid-a', 'Mia'), child('kid-b', 'Leo')]) };
    const app = await bootFamily({ seed });
    const first = await FP().reconcileFamilyProfiles();
    expect(first).toMatchObject({ status: 'ok', registered: ['kid-a', 'kid-b'], orphanProfiles: [] });
    const after = await stored(app, REGISTRY);
    const spy = jest.spyOn(app.AsyncStorage, 'setItem');
    spy.mockClear();
    const second = await FP().reconcileFamilyProfiles();
    expect(second).toMatchObject({ registered: [], alreadyLinked: ['kid-a', 'kid-b'] });
    expect(spy).not.toHaveBeenCalled();
    expect(await stored(app, REGISTRY)).toBe(after);
    expect((await FP().getSelectableChildren()).map((c) => c.id)).toEqual(['kid-a', 'kid-b']);
  });

  test('ids that cannot be profile ids, and ids shared by two records, are reported and left exactly as they are', async () => {
    const text = householdJson([child('ok1', 'A'), child('bad id!', 'B'), child('dup', 'C1'), child('dup', 'C2')]);
    const app = await bootFamily({ seed: { [HOUSEHOLD]: text } });
    const report = await FP().reconcileFamilyProfiles();
    expect(report).toMatchObject({ status: 'ok', registered: ['ok1'], invalidIds: ['bad id!'], duplicateChildIds: ['dup'] });
    expect(await stored(app, HOUSEHOLD)).toBe(text); // not rewritten, not merged
    expect((await registryOf(app)).profiles.map((p: { id: string }) => p.id)).toEqual(['main', 'ok1']);
    expect((await FP().getSelectableChildren()).map((c) => c.id)).toEqual(['ok1']);
  });

  test('two records with the same id make the household read-only, and the stored text is never changed', async () => {
    const text = householdJson([child('dup', 'C1'), child('dup', 'C2')]);
    const app = await bootFamily({ seed: { [HOUSEHOLD]: text } });
    expect(await H().renameChild('dup', 'X')).toEqual({ ok: false, reason: 'blocked' });
    expect(await H().addChild('New')).toEqual({ ok: false, reason: 'blocked' });
    expect(await H().saveParentProfile('A', 'B')).toEqual({ ok: false, reason: 'blocked' });
    expect(H().getHouseholdIntegrity().duplicateChildIds).toEqual(['dup']);
    expect(await stored(app, HOUSEHOLD)).toBe(text);
  });

  test('a household that cannot be read: reconciliation changes nothing', async () => {
    const app = await bootFamily({ seed: { [HOUSEHOLD]: householdJson([child('kid1')]) } });
    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === HOUSEHOLD) throw new Error('read failed');
      return original(key);
    });
    const registryBefore = await original(REGISTRY);
    expect(await FP().reconcileFamilyProfiles()).toMatchObject({ status: 'unreadable', registered: [], orphanProfiles: [] });
    expect(await original(REGISTRY)).toBe(registryBefore);
    app.AsyncStorage.getItem = original;
  });

  test('in safe mode reconciliation reports "unavailable" and changes nothing', async () => {
    const app = await loadApp({ ...mixed(), [HOUSEHOLD]: householdJson([child('kid1')]) });
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    patch(app, 'setItem', failFor((k) => k.startsWith(BACKUP_PREFIX)));
    await app.profiles.ensureProfilesReady();
    expect(await FP().reconcileFamilyProfiles()).toMatchObject({ status: 'unavailable', registered: [] });
    expect(await FP().getSelectableChildren()).toEqual([]);
  });

  test('entries that cannot be understood are copied aside, whole, before the first change; the change is refused if the copy cannot be made', async () => {
    const broken = JSON.stringify({
      version: 1,
      parent: null,
      selectedChildId: null,
      children: [child('kid1', 'Mia', { tasks: [{ id: 't1', text: 'ok', status: 'assigned' }, { id: 't2' }] }), { id: 'kid2' }, 'junk'],
    });
    const app = await boot({ seed: { [HOUSEHOLD]: broken } });
    await H().ensureHouseholdLoaded();
    expect(H().getHouseholdIntegrity().unreadableEntries).toBe(3);
    const restore = patch(app, 'setItem', failFor((k) => k.startsWith(`${HOUSEHOLD}.corrupt-`)));
    expect(await H().updateChildSettings('kid1', { canCreateTasks: true })).toEqual({ ok: false, reason: 'storage' });
    expect(await stored(app, HOUSEHOLD)).toBe(broken); // untouched
    restore();
    expect(await H().updateChildSettings('kid1', { canCreateTasks: true })).toMatchObject({ ok: true });
    const copies = [...(await app.dump())].filter(([k]) => k.startsWith(`${HOUSEHOLD}.corrupt-`));
    expect(copies).toHaveLength(1);
    expect(copies[0][1]).toBe(broken);
    expect(H().getHouseholdIntegrity().unreadableEntries).toBe(0);
  });

  test('household text that is not JSON is copied aside before it is replaced', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: 'not json at all' } });
    expect(await H().saveParentProfile('Dad', '')).toMatchObject({ ok: true });
    const copies = [...(await app.dump())].filter(([k]) => k.startsWith(`${HOUSEHOLD}.corrupt-`));
    expect(copies.map(([, v]) => v)).toEqual(['not json at all']);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('archiving metadata (no screen yet)', () => {
  test('archiving hides the child from the picker and deletes nothing; restoring brings the child back', async () => {
    const app = await bootFamily();
    const a = ((await H().addChild('Mia')) as { id: string }).id;
    const b = ((await H().addChild('Leo')) as { id: string }).id;
    await app.AsyncStorage.setItem(scoped(a, 'petFamily'), '{"keep":"me"}'); // stands for the child's saved data
    const keysBefore = [...(await app.dump()).keys()].filter((k) => k.startsWith(`${P}p:`));

    expect(await H().setChildArchived(a, true)).toMatchObject({ ok: true });
    expect((await FP().getSelectableChildren()).map((c) => c.id)).toEqual([b]);
    expect((await household(app)).children.find((c: { id: string }) => c.id === a).archivedAt).toEqual(expect.any(String));
    expect([...(await app.dump()).keys()].filter((k) => k.startsWith(`${P}p:`))).toEqual(keysBefore);
    expect(await stored(app, scoped(a, 'petFamily'))).toBe('{"keep":"me"}');
    expect((await registryOf(app)).profiles.map((p: { id: string }) => p.id)).toContain(a); // the profile itself stays

    expect(await H().setChildArchived(a, false)).toMatchObject({ ok: true });
    expect((await FP().getSelectableChildren()).map((c) => c.id)).toEqual([a, b]);
    expect((await household(app)).children.find((c: { id: string }) => c.id === a).archivedAt).toBeUndefined();
  });

  test('archiving the selected child moves the selection to an active child; archiving twice writes nothing; unknown ids are refused', async () => {
    const app = await bootFamily();
    const a = ((await H().addChild('Mia')) as { id: string }).id;
    const b = ((await H().addChild('Leo')) as { id: string }).id;
    expect(H().peekHousehold()!.selectedChildId).toBe(b);
    await H().setChildArchived(b, true);
    expect(H().peekHousehold()!.selectedChildId).toBe(a);
    const before = await stored(app, HOUSEHOLD);
    expect(await H().setChildArchived(b, true)).toMatchObject({ ok: true });
    expect(await stored(app, HOUSEHOLD)).toBe(before);
    expect(await H().setChildArchived('nobody', true)).toEqual({ ok: false, reason: 'not-found' });
  });

  test('a child with no registry profile (or an archived one) is not selectable; archiving never touches another child', async () => {
    const seed = { [HOUSEHOLD]: householdJson([child('kid-a', 'A'), child('kid-b', 'B', { archivedAt: iso(T0) }), child('kid-c', 'C')]) };
    const app = await bootFamily({ seed });
    await app.profiles.registerChildProfile('kid-a');
    await app.profiles.registerChildProfile('kid-b');
    expect((await FP().getSelectableChildren()).map((c) => c.id)).toEqual(['kid-a']); // kid-c has no profile, kid-b is archived
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('read-only care summaries', () => {
  const family = (pets: object[]) => ({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens: 0 } });
  const sickPet = (id: string, sinceHoursAgo: number, extra: object = {}) =>
    pet({
      id,
      p: { hunger: 0, lastUpdatedAt: iso(T0 - HOUR) },
      lifecycle: { state: 'sick', sickSince: iso(T0 - sinceHoursAgo * HOUR), exhausted: false, lastEvaluatedAt: iso(T0 - HOUR) },
      ...extra,
    });

  async function withKid(record: unknown) {
    const app = await boot();
    await app.profiles.registerChildProfile('kid1');
    if (record !== undefined) {
      await app.AsyncStorage.setItem(scoped('kid1', 'petFamily'), typeof record === 'string' ? record : JSON.stringify(record));
    }
    return app;
  }

  test('a profile that has not saved anything yet is "not-started"; an unknown profile or damaged record is "unreadable"', async () => {
    const app = await withKid(undefined);
    expect(await FP().peekProfileCare('kid1')).toEqual({ status: 'not-started' });
    expect(await FP().peekProfileCare('nobody')).toEqual({ status: 'unreadable' });
    await app.AsyncStorage.setItem(scoped('kid1', 'petFamily'), '{not json');
    expect(await FP().peekProfileCare('kid1')).toEqual({ status: 'unreadable' });
    await app.AsyncStorage.setItem(scoped('kid1', 'petFamily'), '{"pets":[]}');
    expect(await FP().peekProfileCare('kid1')).toEqual({ status: 'unreadable' });
    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === scoped('kid1', 'petFamily')) throw new Error('read failed');
      return original(key);
    });
    expect(await FP().peekProfileCare('kid1')).toEqual({ status: 'unreadable' });
    app.AsyncStorage.getItem = original;
  });

  test('healthy, sick, critical and deceased pets are told apart, with the right counts and the worst state', async () => {
    await withKid(family([pet({ id: 'a' })]));
    expect(await FP().peekProfileCare('kid1')).toMatchObject({ status: 'ok', living: 1, healthy: 1, worst: 'healthy', needsAttention: false });

    const sick = await withKid(family([pet({ id: 'a' }), sickPet('b', 2)]));
    expect(await FP().peekProfileCare('kid1')).toMatchObject({ living: 2, healthy: 1, sick: 1, critical: 0, worst: 'sick', needsAttention: true });

    await sick.AsyncStorage.setItem(scoped('kid1', 'petFamily'), JSON.stringify(family([pet({ id: 'a' }), sickPet('b', 30)])));
    expect(await FP().peekProfileCare('kid1')).toMatchObject({ living: 2, sick: 0, critical: 1, worst: 'critical', needsAttention: true });

    await sick.AsyncStorage.setItem(scoped('kid1', 'petFamily'), JSON.stringify(family([pet({ id: 'a' }), sickPet('b', 100)])));
    expect(await FP().peekProfileCare('kid1')).toMatchObject({ living: 1, healthy: 1, critical: 0, deceased: 1, worst: 'deceased', needsAttention: true });

    await sick.AsyncStorage.setItem(scoped('kid1', 'petFamily'), JSON.stringify(family([sickPet('b', 100)])));
    expect(await FP().peekProfileCare('kid1')).toMatchObject({ living: 0, deceased: 1, worst: 'deceased' });
  });

  test('critical outranks sick, and a pet already marked deceased in the record counts as deceased', async () => {
    await withKid(
      family([
        sickPet('s', 2),
        sickPet('c', 30),
        pet({ id: 'd', lifecycle: { state: 'deceased', diedAt: iso(T0 - DAY), exhausted: false, lastEvaluatedAt: iso(T0 - DAY) } }),
      ])
    );
    expect(await FP().peekProfileCare('kid1')).toMatchObject({ sick: 1, critical: 1, deceased: 1, worst: 'critical' });
  });

  test('a pet in Pet Pawadise is frozen: it is never counted as sick or at home', async () => {
    await withKid(family([pet({ id: 'a' }), sickPet('b', 30, { retired: { since: iso(T0 - DAY) } })]));
    expect(await FP().peekProfileCare('kid1')).toMatchObject({ living: 1, healthy: 1, critical: 0, worst: 'healthy', needsAttention: false });
  });

  test('time that passed while nobody looked counts: a record saved as healthy is reported from what the clock says now', async () => {
    const old = pet({
      id: 'a',
      p: { hunger: 0, lastUpdatedAt: iso(T0 - 40 * HOUR) },
      lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: iso(T0 - 40 * HOUR) },
    });
    await withKid(family([old]));
    const summary = await FP().peekProfileCare('kid1');
    expect(summary).toMatchObject({ status: 'ok', needsAttention: true });
    expect(['sick', 'critical', 'deceased']).toContain((summary as { worst: string }).worst);
  });

  test('it only reads: nothing is written, nothing is loaded into the stores, the saved record stays byte for byte, no alert is scheduled', async () => {
    const record = JSON.stringify(family([pet({ id: 'a' }), sickPet('b', 30)]));
    const app = await withKid(record);
    const before = await app.dump();
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    const multiSet = jest.spyOn(app.AsyncStorage, 'multiSet');
    setItem.mockClear();
    multiSet.mockClear();
    const reads: string[] = [];
    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      reads.push(key);
      return original(key);
    });
    await FP().peekProfileCare('kid1');
    await FP().peekProfileCare('kid1');
    expect(setItem).not.toHaveBeenCalled();
    expect(multiSet).not.toHaveBeenCalled();
    expect(reads.filter((k) => k !== REGISTRY)).toEqual([scoped('kid1', 'petFamily'), scoped('kid1', 'petFamily')]);
    expect(await app.dump()).toEqual(before);
    expect(app.family.peekFamily()).toBeNull(); // the store never saw it
    expect(app.profiles.getActiveProfileId()).toBe('main');
    expect(notifications().scheduleNotificationAsync).not.toHaveBeenCalled();
    app.AsyncStorage.getItem = original;
  });

  test('it works while no profile is active (at the picker) and for the main profile\'s own (original) record', async () => {
    const app = await boot({ seed: mixed() });
    await app.profiles.registerChildProfile('kid1');
    await app.AsyncStorage.setItem(scoped('kid1', 'petFamily'), JSON.stringify(family([sickPet('b', 2)])));
    await app.profiles.switchProfile('kid1');
    await app.family.ensureFamilyLoaded();
    await app.profiles.releaseActiveProfile();
    expect(await FP().peekProfileCare('kid1')).toMatchObject({ status: 'ok', sick: 1 });
    expect(await FP().peekProfileCare('main')).toMatchObject({ status: 'ok' });
    expect(app.family.peekFamily()).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the main profile and the children never mix', () => {
  test('creating, opening, releasing, archiving and restoring children leaves every original Main key byte for byte as it was', async () => {
    const app = await bootFamily({ seed: { ...mixed(), [`${P}tasks`]: [{ id: 'main-task', text: 'm' }], [`${P}tokenEarnings`]: { total: 7 } } });
    const mainKeys = async () =>
      [...(await app.dump())].filter(([k]) => !k.startsWith(`${P}p:`) && k !== REGISTRY && k !== HOUSEHOLD && !k.startsWith(BACKUP_PREFIX)).sort(([a], [b]) => a.localeCompare(b));
    const before = await mainKeys();
    expect(before.length).toBeGreaterThan(0);

    const a = ((await H().addChild('Mia')) as { id: string }).id;
    const b = ((await H().addChild('Leo')) as { id: string }).id;
    await FP().reconcileFamilyProfiles();
    await app.profiles.switchProfile(a);
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(25);
    await app.profiles.releaseActiveProfile();
    await app.profiles.switchProfile(b);
    await app.family.ensureFamilyLoaded();
    await app.profiles.releaseActiveProfile();
    await H().setChildArchived(a, true);
    await H().setChildArchived(a, false);
    await FP().peekProfileCare('main');
    await FP().peekProfileCare(a);

    const after = await mainKeys();
    // The one thing that may change is the Main profile's alert-schedule bookkeeping when its profile is left: the phone
    // notifications are cancelled, so that record is emptied (existing profile-switch behavior, see FEATURE-086).
    const strip = (rows: [string, string][]) => rows.filter(([k]) => k !== `${P}petAlertSchedule`);
    expect(strip(after)).toEqual(strip(before));
    const schedule = after.find(([k]) => k === `${P}petAlertSchedule`);
    if (schedule) expect(schedule[1]).toBe('[]');
  });

  test('two children created through the household keep completely separate saved data, through release and re-entry', async () => {
    const app = await bootFamily();
    const a = ((await H().addChild('Mia')) as { id: string }).id;
    const b = ((await H().addChild('Leo')) as { id: string }).id;
    await app.profiles.switchProfile(a);
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(10);
    expect((await app.family.adoptNewEgg()).ok).toBe(true);
    await app.profiles.releaseActiveProfile();
    await app.profiles.switchProfile(b);
    const leo = await app.family.ensureFamilyLoaded();
    expect(leo.pets).toHaveLength(1); // the starter egg, nothing else
    expect(app.family.getWalletBalance()).toBe(0);
    app.family.addToWallet(3);
    await app.profiles.releaseActiveProfile();

    const keys = [...(await app.dump()).keys()].filter((k) => k.startsWith(`${P}p:`));
    expect(keys.every((k) => k.startsWith(`${P}p:${a}:`) || k.startsWith(`${P}p:${b}:`))).toBe(true);
    expect(JSON.parse((await stored(app, scoped(a, 'petFamily')))!).pets).toHaveLength(2);
    expect(JSON.parse((await stored(app, scoped(b, 'petFamily')))!).wallet.pawTokens).toBe(3);
    expect(JSON.parse((await stored(app, scoped(a, 'petFamily')))!).wallet.pawTokens).toBe(10);
  });
});
