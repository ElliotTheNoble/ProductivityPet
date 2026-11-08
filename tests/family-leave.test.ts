import { HOUR, T0, configurePin, freezeClock, iso, loadApp, pet, resetSecure, unfreezeClock, type App } from './helpers';

// Stage 4.1: leaving a profile for the family picker (leaveProfile), over the real profile layer, parent gate and PIN module, with an
// in-memory storage. Covers the order of the steps (parent area locked first), what is kept when it works and when it does not, the
// route reset, delayed callbacks, and the family-mode-off behavior. Nothing here draws a screen; the cover is tested with the gate.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  dismissNotificationAsync: jest.fn(async () => undefined),
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
const REGISTRY = `${P}profiles`;
const HOUSEHOLD = `${P}household`;
const BACKUP = `${P}backup:preM2:`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const child = (id: string, nickname = id) => ({
  id,
  nickname,
  createdAt: iso(T0),
  settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' },
  tasks: [],
});
const household = (children: object[]) => JSON.stringify({ version: 1, parent: null, children, selectedChildId: null });
const family = (pets: object[], tokens = 42) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens: tokens } });

const S = () => require('@/utils/family-session') as typeof import('@/utils/family-session');
const FP = () => require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');

const seed = () => ({
  [HOUSEHOLD]: household([child('kid-a', 'Mia'), child('kid-b', 'Leo')]),
  [scoped('kid-a', 'petFamily')]: family([pet({ id: 'a1' })]),
  [scoped('kid-a', 'ownedShopItems')]: JSON.stringify(['hat-1']),
  [scoped('kid-b', 'petFamily')]: family([pet({ id: 'b1' })], 7),
  [scoped('kid-b', 'ownedShopItems')]: JSON.stringify(['bow-2']),
  [`${P}petFamily`]: family([pet({ id: 'main-pet' })], 100),
  [`${P}tasks`]: JSON.stringify([{ id: 'main-task', text: 'm' }]),
});

type Options = { family?: boolean; unlocked?: boolean };
async function boot(options: Options = {}): Promise<App> {
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  resetSecure();
  const app = await loadApp(seed());
  await app.profiles.ensureProfilesReady();
  if (options.family !== false) {
    await configurePin(app, { unlocked: options.unlocked !== false });
    await FP().reconcileFamilyProfiles();
  }
  return app;
}

// Opens `id` the way the picker does: switch, mark chosen, load the pets.
async function open(app: App, id: string) {
  expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
  S().markProfileChosen();
  S().consumePendingRoute();
  return app.family.ensureFamilyLoaded();
}

// Everything on disk except what the profile layer and the PIN legitimately change around a switch.
const snapshot = async (app: App) =>
  [...(await app.dump())]
    .filter(([k]) => k !== REGISTRY && !k.startsWith(BACKUP) && !k.includes('parentAuth') && !k.includes('parentGate') && !k.endsWith('petAlertSchedule'))
    .sort(([a], [b]) => a.localeCompare(b));
const without = (rows: [string, string][], prefix: string) => rows.filter(([k]) => !k.startsWith(prefix));
const walletOf = async (app: App, id: string) => JSON.parse((await app.AsyncStorage.getItem(scoped(id, 'petFamily')))!).wallet.pawTokens;

// A storage whose writes to matching keys wait until `release()` is called (or throw, for `fail`).
function holdWrites(app: App, match: (key: string) => boolean) {
  const original = app.AsyncStorage.setItem;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
    if (match(key)) await gate;
    return original(key, value);
  });
  return {
    release: () => {
      open();
      app.AsyncStorage.setItem = original;
    },
  };
}
function failWrites(app: App, match: (key: string) => boolean) {
  const original = app.AsyncStorage.setItem;
  app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
    if (match(key)) throw new Error('storage failed');
    return original(key, value);
  });
  return () => {
    app.AsyncStorage.setItem = original;
  };
}
// Family mode checks the clean-up by listing what the phone has scheduled (before and after cancelling the private ones): one clean-up is two lists.
const lists = () => require('expo-notifications').getAllScheduledNotificationsAsync as jest.Mock;

// ---------------------------------------------------------------------------------------------------------
describe('leaving a profile that can be saved', () => {
  test('returns ok, shows the picker (nobody chosen), lets every store go, clears the phone notifications once and saves what was done', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    app.family.addToWallet(7);
    const epoch = app.profiles.getNotificationEpoch();
    const calls = lists().mock.calls.length;

    expect(await S().leaveProfile()).toMatchObject({ ok: true, changed: true });

    expect(S().hasChosenProfile()).toBe(false);
    expect(S().isLeavingProfile()).toBe(false);
    expect(app.profiles.isProfileReleased()).toBe(true);
    expect(app.family.peekFamily()).toBeNull();
    expect(app.profiles.getNotificationEpoch()).toBe(epoch + 1); // the clean-up of the notification epoch ran exactly once
    expect(lists().mock.calls.length).toBe(calls + 2); // one checked clean-up
    expect(await walletOf(app, 'kid-a')).toBe(49); // the work done just before leaving was saved
  });

  test('the parent area is locked BEFORE the release starts, not only after it', async () => {
    const app = await boot({ unlocked: true });
    await open(app, 'kid-a');
    expect((await app.gate.getParentAccess()).state).toBe('unlocked');
    const original = app.profiles.releaseActiveProfile;
    let seen = 'never ran';
    jest.spyOn(app.profiles, 'releaseActiveProfile').mockImplementation(async (...args) => {
      seen = (await app.gate.getParentAccess()).state;
      return original(...args);
    });
    expect(await S().leaveProfile()).toMatchObject({ ok: true });
    expect(seen).toBe('locked');
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });

  test('"leaving" is raised for the whole time (so the screen is covered) and lowered when it is over', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const seen: boolean[] = [];
    const off = S().subscribeToFamilySession(() => seen.push(S().isLeavingProfile()));
    let duringRelease: boolean | null = null;
    const original = app.profiles.releaseActiveProfile;
    jest.spyOn(app.profiles, 'releaseActiveProfile').mockImplementation(async (...args) => {
      duringRelease = S().isLeavingProfile();
      return original(...args);
    });
    await S().leaveProfile();
    off();
    expect(duringRelease).toBe(true);
    expect(seen[0]).toBe(true);
    expect(seen[seen.length - 1]).toBe(false);
  });

  test('Main and every child keep their data byte for byte', async () => {
    const app = await boot();
    for (const id of ['kid-a', 'kid-b', 'main']) {
      await open(app, id);
      const before = await snapshot(app);
      expect(await S().leaveProfile()).toMatchObject({ ok: true, changed: true });
      const after = await snapshot(app);
      // pets of the profile just left may have been caught up to the clock and saved; nothing else may change
      const prefix = id === 'main' ? null : scoped(id, '');
      const keep = (rows: [string, string][]) => (prefix ? without(rows, prefix) : rows.filter(([k]) => k.startsWith(`${P}p:`) || k === HOUSEHOLD));
      expect(keep(after)).toEqual(keep(before));
      expect(after.map(([k]) => k)).toEqual(expect.arrayContaining(before.map(([k]) => k)));
    }
    expect(JSON.parse((await app.AsyncStorage.getItem(`${P}petFamily`))!).wallet.pawTokens).toBe(100);
    expect(await walletOf(app, 'kid-a')).toBe(42);
    expect(await walletOf(app, 'kid-b')).toBe(7);
  });

  test('a second request while one is running gets the same answer, and the release runs once', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const spy = jest.spyOn(app.profiles, 'releaseActiveProfile');
    const first = S().leaveProfile();
    const second = S().leaveProfile();
    expect(second).toBe(first);
    expect(await first).toMatchObject({ ok: true, changed: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('asking again once the picker is showing changes nothing and is not an error', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    await S().leaveProfile();
    const calls = lists().mock.calls.length;
    expect(await S().leaveProfile()).toMatchObject({ ok: true, changed: false });
    expect(lists().mock.calls.length).toBe(calls); // no second clean-up
    expect(S().hasChosenProfile()).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('where the next profile starts', () => {
  test('after leaving, the next profile chosen starts on the home screen, once', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    await S().leaveProfile();
    S().markProfileChosen();
    expect(S().consumePendingRoute()).toBe('/');
    expect(S().consumePendingRoute()).toBeNull();
    S().markProfileChosen();
    expect(S().consumePendingRoute()).toBeNull(); // only the first choice after a leave is reset
  });

  test('the parent-only "Add a child" entry still wins, and still uses up the reset', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    await S().leaveProfile();
    S().markProfileChosen({ then: '/parent' });
    expect(S().consumePendingRoute()).toBe('/parent');
    S().markProfileChosen();
    expect(S().consumePendingRoute()).toBeNull();
  });

  test('a cold start (nobody was ever left) is not redirected: a deep link to another screen is kept', async () => {
    await boot();
    S().markProfileChosen();
    expect(S().consumePendingRoute()).toBeNull();
  });

  test('a leave that failed does not reset the route (the person stays where they are)', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    app.family.addToWallet(1);
    const restore = failWrites(app, (k) => k === scoped('kid-a', 'petFamily'));
    expect(await S().leaveProfile({ timeoutMs: 200 })).toMatchObject({ ok: false });
    restore();
    S().markProfileChosen();
    expect(S().consumePendingRoute()).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('leaving that cannot be finished', () => {
  test('a write that cannot be saved cancels the leave: the profile stays open with everything in place, and nothing is reported as done', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    app.family.addToWallet(7);
    const restore = failWrites(app, (k) => k === scoped('kid-a', 'petFamily'));
    const epoch = app.profiles.getNotificationEpoch();
    const calls = lists().mock.calls.length;

    const result = await S().leaveProfile({ timeoutMs: 200 });

    expect(result).toMatchObject({ ok: false, reason: 'unsaved-changes' });
    expect(result.ok === false && result.keys).toContain(scoped('kid-a', 'petFamily'));
    expect(S().hasChosenProfile()).toBe(true);
    expect(S().isLeavingProfile()).toBe(false);
    expect(app.profiles.isProfileReleased()).toBe(false);
    expect(app.profiles.getActiveProfileId()).toBe('kid-a');
    expect(app.family.peekFamily()?.wallet.pawTokens).toBe(49); // still in memory, nothing lost
    expect(app.profiles.getNotificationEpoch()).toBe(epoch); // no clean-up ran
    expect(lists().mock.calls.length).toBe(calls);

    // the failed value is not dropped: once storage works, leaving again saves it
    restore();
    expect(await S().leaveProfile()).toMatchObject({ ok: true, changed: true });
    expect(await walletOf(app, 'kid-a')).toBe(49);
  });

  test('a save that takes too long ends in a timeout, nothing is lost, and leaving works once the save has finished', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    app.family.addToWallet(3);
    const hold = holdWrites(app, (k) => k === scoped('kid-a', 'petFamily'));

    expect(await S().leaveProfile({ timeoutMs: 60 })).toMatchObject({ ok: false, reason: 'timeout' });
    expect(app.profiles.isProfileReleased()).toBe(false);
    expect(S().hasChosenProfile()).toBe(true);
    expect(app.family.peekFamily()?.wallet.pawTokens).toBe(45);

    hold.release();
    expect(await S().leaveProfile()).toMatchObject({ ok: true, changed: true });
    expect(await walletOf(app, 'kid-a')).toBe(45);
  });

  test('the parent area is already locked when a leave fails (a failed or slow release never leaves a parent session open)', async () => {
    const app = await boot({ unlocked: true });
    await open(app, 'main');
    app.family.addToWallet(1);
    const restore = failWrites(app, (k) => k === `${P}petFamily`);
    expect(await S().leaveProfile({ timeoutMs: 200 })).toMatchObject({ ok: false });
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    expect(app.profiles.getActiveProfileId()).toBe('main');
    restore();
  });

  test('a store that fails while letting go leaves the person in their profile', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const stores = app.profiles.registeredProfileStoreNames();
    expect(stores.length).toBeGreaterThan(0);
    jest.spyOn(app.profiles, 'releaseActiveProfile').mockResolvedValueOnce({ ok: false, reason: 'storage' });
    expect(await S().leaveProfile()).toEqual({ ok: false, reason: 'storage' });
    expect(S().hasChosenProfile()).toBe(true);
    expect(S().isLeavingProfile()).toBe(false);
  });

  test('a release that throws is reported as a storage failure, never as a success, and never leaves the cover up', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    jest.spyOn(app.profiles, 'releaseActiveProfile').mockRejectedValueOnce(new Error('boom'));
    expect(await S().leaveProfile()).toEqual({ ok: false, reason: 'storage' });
    expect(S().hasChosenProfile()).toBe(true);
    expect(S().isLeavingProfile()).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('delayed callbacks around a leave', () => {
  test('a save that is still running when someone leaves is finished first, and lands in the profile that was left (never in the next one)', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const beforeB = (await snapshot(app)).filter(([k]) => k.startsWith(scoped('kid-b', '')));
    app.family.addToWallet(5);
    const hold = holdWrites(app, (k) => k === scoped('kid-a', 'petFamily'));
    app.family.addToWallet(6); // a second change while the first save is held back

    const leaving = S().leaveProfile({ timeoutMs: 5000 });
    let finished = false;
    void leaving.then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(finished).toBe(false); // the leave waits for the save
    expect(S().isLeavingProfile()).toBe(true);
    hold.release();
    expect(await leaving).toMatchObject({ ok: true, changed: true });

    expect(await walletOf(app, 'kid-a')).toBe(53);
    expect(await app.profiles.switchProfile('kid-b')).toMatchObject({ ok: true });
    await app.family.ensureFamilyLoaded();
    expect(app.family.peekFamily()?.wallet.pawTokens).toBe(7); // Leo sees nothing of Mia's change
    expect((await snapshot(app)).filter(([k]) => k.startsWith(scoped('kid-b', '')))).toEqual(beforeB);
  });

  test('callbacks that arrive after the stores let go change nothing: rewards, pet ticks, mail, family writes', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    await S().leaveProfile();
    const before = await snapshot(app);

    app.family.addToWallet(99); // a reward that was on its way
    app.family.advanceAllPets(new Date(T0 + 5 * HOUR), true); // the 60-second pet tick
    expect(await app.mail.runPawadiseDeliveries()).toBe(0);
    await expect(app.family.ensureFamilyLoaded()).rejects.toThrow('profile-released');
    await expect(app.kitty.completeKittyCatchRound(5)).rejects.toThrow();
    expect(app.family.peekFamily()).toBeNull();

    await app.profiles.switchProfile('kid-b'); // and the next person arrives
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.family.peekFamily()).toBeNull(); // nothing loaded itself for Leo
    expect(await snapshot(app)).toEqual(before);
  });

  test('the pet tick in the app shell skips a released profile and cannot throw', () => {
    const fs = require('fs');
    const path = require('path');
    const code = fs.readFileSync(path.resolve('src/app/_layout.tsx'), 'utf8') as string;
    const tick = code.slice(code.indexOf('const tick = () => {'), code.indexOf('const subscription'));
    expect(tick).toContain('isProfileOwner(owner)');
    expect(tick).toMatch(/try \{[\s\S]*advanceAllPets\([\s\S]*\} catch/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('family mode off (every real user and release build)', () => {
  test('there is no picker to go back to: nothing is locked, released, cancelled or changed', async () => {
    const app = await boot({ family: false });
    expect(await app.profiles.switchProfile('main')).toMatchObject({ ok: true });
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(1);
    const before = await snapshot(app);
    const calls = lists().mock.calls.length;
    const release = jest.spyOn(app.profiles, 'releaseActiveProfile');

    expect(await S().leaveProfile()).toEqual({ ok: false, reason: 'not-available' });

    expect(release).not.toHaveBeenCalled();
    expect(app.profiles.isProfileReleased()).toBe(false);
    expect(app.family.peekFamily()).not.toBeNull();
    expect(lists().mock.calls.length).toBe(calls);
    expect(S().isLeavingProfile()).toBe(false);
    expect(await snapshot(app)).toEqual(before);
  });
});
