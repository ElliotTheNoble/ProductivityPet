import { T0, configurePin, flush, freezeClock, iso, loadApp, pet, resetSecure, unfreezeClock, type App } from './helpers';

// Stage 4 hardening: delayed work that belongs to one profile session must never change another profile, even after that other
// profile has loaded. Over the real profile layer, parent gate, PIN module and stores with an in-memory storage, and a small
// stand-in for the phone's notification scheduler that can be held back.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
jest.mock('expo-notifications', () => {
  const g = globalThis as unknown as { __phone: Map<string, string>; __seq: number; __holdSchedule: Promise<void> | null; __holdPermission: Promise<void> | null };
  return {
    cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
      g.__phone.delete(id);
    }),
    cancelAllScheduledNotificationsAsync: jest.fn(async () => {
      g.__phone.clear();
    }),
    dismissAllNotificationsAsync: jest.fn(async () => undefined),
    scheduleNotificationAsync: jest.fn(async (request: { content: { body?: string; title?: string } }) => {
      if (g.__holdSchedule) await g.__holdSchedule;
      g.__seq += 1;
      const id = `n${g.__seq}`;
      g.__phone.set(id, request.content.body ?? request.content.title ?? '');
      return id;
    }),
    setNotificationChannelAsync: jest.fn(async () => undefined),
    getPermissionsAsync: jest.fn(async () => ({ granted: !g.__holdPermission })),
    requestPermissionsAsync: jest.fn(async () => {
      if (g.__holdPermission) await g.__holdPermission;
      return { granted: true };
    }),
    getPresentedNotificationsAsync: jest.fn(async () => []),
    dismissNotificationAsync: jest.fn(async () => undefined),
    setNotificationHandler: jest.fn(),
    SchedulableTriggerInputTypes: { DATE: 'date' },
    AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
  };
});

const phoneState = globalThis as unknown as { __phone: Map<string, string>; __seq: number; __holdSchedule: Promise<void> | null; __holdPermission: Promise<void> | null };
const P = '@ProductivityPet:';
const REGISTRY = `${P}profiles`;
const HOUSEHOLD = `${P}household`;
const BACKUP = `${P}backup:preM2:`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => {
  freezeClock(T0);
  phoneState.__phone = new Map();
  phoneState.__seq = 0;
  phoneState.__holdSchedule = null;
  phoneState.__holdPermission = null;
});
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
const PR = () => require('@/utils/profiles') as typeof import('@/utils/profiles');
const NT = () => require('@/utils/notifications') as typeof import('@/utils/notifications');

const seed = () => ({
  [HOUSEHOLD]: household([child('kid-a', 'Mia'), child('kid-b', 'Leo')]),
  [scoped('kid-a', 'petFamily')]: family([pet({ id: 'a1' })], 42),
  [scoped('kid-b', 'petFamily')]: family([pet({ id: 'b1' })], 7),
  [scoped('kid-b', 'ownedShopItems')]: JSON.stringify(['bow-2']),
  [`${P}petFamily`]: family([pet({ id: 'main-pet' })], 100),
  [`${P}tasks`]: JSON.stringify([{ id: 'main-task', text: 'm' }]),
});

type Options = { family?: boolean };
async function boot(options: Options = {}): Promise<App> {
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  resetSecure();
  const app = await loadApp(seed());
  await app.profiles.ensureProfilesReady();
  if (options.family !== false) {
    await configurePin(app, { unlocked: true });
    await FP().reconcileFamilyProfiles();
  }
  return app;
}

async function open(app: App, id: string) {
  expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
  S().markProfileChosen();
  S().consumePendingRoute();
  return app.family.ensureFamilyLoaded();
}

const snapshot = async (app: App) =>
  [...(await app.dump())]
    .filter(([k]) => k !== REGISTRY && !k.startsWith(BACKUP) && !k.includes('parentAuth') && !k.includes('parentGate') && !k.endsWith('petAlertSchedule'))
    .sort(([a], [b]) => a.localeCompare(b));
const walletOf = async (app: App, id: string) => JSON.parse((await app.AsyncStorage.getItem(scoped(id, 'petFamily')))!).wallet.pawTokens;
const targetKey = (id: string) => (id === 'main' ? `${P}petFamily` : scoped(id, 'petFamily'));

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
function hold(kind: '__holdSchedule' | '__holdPermission') {
  let open: () => void = () => undefined;
  phoneState[kind] = new Promise<void>((resolve) => {
    open = resolve;
  });
  return () => {
    const release = open;
    phoneState[kind] = null;
    release();
  };
}

// ---------------------------------------------------------------------------------------------------------
describe('profile owners', () => {
  test('an owner is valid for the profile session that issued it, and only for that one', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const owner = PR().captureProfileOwner();
    expect(PR().isProfileOwner(owner)).toBe(true);
    expect(() => PR().assertProfileOwner(owner)).not.toThrow();

    await S().leaveProfile();
    expect(PR().isProfileOwner(owner)).toBe(false);
    expect(() => PR().assertProfileOwner(owner)).toThrow(PR().StaleProfileError);

    await open(app, 'kid-b');
    expect(PR().isProfileOwner(owner)).toBe(false); // still stale after another profile has loaded
    expect(PR().isProfileOwner(PR().captureProfileOwner())).toBe(true);
  });

  test('coming back to the SAME profile is a new session: a callback from before the leave is stale after it', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const before = PR().captureProfileOwner();
    await S().leaveProfile();
    await open(app, 'kid-a');
    expect(PR().isProfileOwner(before)).toBe(false);
    expect(PR().isProfileOwner(PR().captureProfileOwner())).toBe(true);
  });

  test('an owner taken while no profile is open (the picker is showing) is already stale', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    await S().leaveProfile();
    expect(PR().isProfileOwner(PR().captureProfileOwner())).toBe(false);
  });

  test('a callback wrapped with ownedCallback runs for its own session and does nothing after it', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const spy = jest.fn((n: number) => n * 2);
    const wrapped = PR().ownedCallback(spy);
    expect(wrapped(2)).toBe(4);
    await S().leaveProfile();
    expect(wrapped(3)).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('a leave that fails keeps the session: owners issued before it are still valid, and nothing else becomes valid', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const owner = PR().captureProfileOwner();
    const generation = PR().getProfileGeneration();
    app.family.addToWallet(1);
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === scoped('kid-a', 'petFamily')) throw new Error('storage failed');
      return original(key, value);
    });
    expect(await S().leaveProfile({ timeoutMs: 200 })).toMatchObject({ ok: false, reason: 'unsaved-changes' });
    app.AsyncStorage.setItem = original;
    expect(PR().isProfileOwner(owner)).toBe(true);
    expect(PR().getProfileGeneration()).toBe(generation);
    expect(PR().getActiveProfileId()).toBe('kid-a'); // access is only ever to the profile that was open
    expect(PR().isProfileReleased()).toBe(false);
  });

  test('a swap that fails and goes back to the profile that was open does not end its session', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const owner = PR().captureProfileOwner();
    const generation = PR().getProfileGeneration();
    PR().registerProfileStore({
      name: 'cannot-let-go',
      reset: () => {
        throw new Error('cannot reset');
      },
    });
    expect(await app.profiles.switchProfile('kid-b')).toMatchObject({ ok: false, reason: 'storage' });
    expect(PR().getActiveProfileId()).toBe('kid-a');
    expect(PR().getProfileGeneration()).toBe(generation);
    expect(PR().isProfileOwner(owner)).toBe(true); // work that belongs to Mia's session still belongs to it
  });
});

// ---------------------------------------------------------------------------------------------------------
describe.each([['kid-b'], ['main']])('a delayed callback from Child A after %s has loaded', (target) => {
  async function arrange() {
    const app = await boot();
    await open(app, 'kid-a');
    const owner = PR().captureProfileOwner();
    const profileFromA = await app.family.getPetProfileForSelectedPet(); // a profile object read in Mia's session
    await S().leaveProfile();
    await open(app, target);
    return { app, owner, profileFromA };
  }

  test('a minigame reward from Mia pays nothing into the profile that is open now', async () => {
    const { app, owner } = await arrange();
    const before = await snapshot(app);
    const walletBefore = app.family.peekFamily()!.wallet.pawTokens;

    await expect(app.kitty.completeKittyCatchRound(9, owner)).rejects.toBeInstanceOf(PR().StaleProfileError);
    await expect(app.memory.completeMemoryMatchRound('easy', 12, owner)).rejects.toBeInstanceOf(PR().StaleProfileError);
    await flush();

    expect(app.family.peekFamily()!.wallet.pawTokens).toBe(walletBefore);
    expect(await snapshot(app)).toEqual(before);
  });

  test('a pet profile Mia read earlier is not saved into the pet or the wallet of the profile that is open now', async () => {
    const { app, profileFromA } = await arrange();
    const before = await snapshot(app);
    const live = app.family.peekFamily()!;

    app.family.savePetProfileForSelectedPet({ ...profileFromA, pawTokens: 9999, happiness: 1, hunger: 1 });
    await flush();

    expect(app.family.peekFamily()).toEqual(live);
    expect(app.family.peekFamily()!.wallet.pawTokens).not.toBe(9999);
    expect(await snapshot(app)).toEqual(before);
    expect(JSON.parse((await app.AsyncStorage.getItem(targetKey(target)))!).wallet.pawTokens).toBe(target === 'main' ? 100 : 7);
  });

  test('a callback wrapped for Mia does nothing, and Mia\'s own saved data was not changed by any of this', async () => {
    const { app } = await arrange();
    const spy = jest.fn();
    const stale = PR().ownedCallback(spy, { generation: PR().getProfileGeneration() - 1 });
    stale();
    expect(spy).not.toHaveBeenCalled();
    expect(await walletOf(app, 'kid-a')).toBe(42);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('delayed work after the profile was released (nobody has loaded yet)', () => {
  test('a reward, a profile save and a deferred save from the profile that was left do nothing', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const owner = PR().captureProfileOwner();
    const profileFromA = await app.family.getPetProfileForSelectedPet();
    await S().leaveProfile();
    const before = await snapshot(app);

    await expect(app.kitty.completeKittyCatchRound(9, owner)).rejects.toBeInstanceOf(PR().StaleProfileError);
    app.family.savePetProfileForSelectedPet({ ...profileFromA, pawTokens: 777 });
    app.family.addToWallet(50);
    await flush();
    expect(app.family.peekFamily()).toBeNull();

    // and when the next person arrives, none of it is applied to them
    await open(app, 'kid-b');
    await flush();
    expect(app.family.peekFamily()!.wallet.pawTokens).toBe(7);
    expect((await snapshot(app)).filter(([k]) => !k.includes('kid-a') && k !== scoped('kid-b', 'petFamily'))).toEqual(
      before.filter(([k]) => !k.includes('kid-a') && k !== scoped('kid-b', 'petFamily'))
    );
    expect(await walletOf(app, 'kid-a')).toBe(42);
    expect(await walletOf(app, 'kid-b')).toBe(7);
  });

  test('a save of a profile that was read BEFORE the person left is ignored even when it arrives while the pets are loading', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const profileFromA = await app.family.getPetProfileForSelectedPet();
    await S().leaveProfile();
    await app.profiles.switchProfile('kid-b');
    S().markProfileChosen();
    // Leo's pets are not loaded yet: the old deferred path would have waited for them and then applied Mia's profile
    app.family.savePetProfileForSelectedPet({ ...profileFromA, pawTokens: 555 });
    await app.family.ensureFamilyLoaded();
    await flush();
    expect(app.family.peekFamily()!.wallet.pawTokens).toBe(7);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the profile session changing while asynchronous work is pending', () => {
  test('a reward still being saved when someone leaves is finished first, lands in Mia, and never in the next profile', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const before = await snapshot(app);
    const holdA = holdWrites(app, (k) => k === scoped('kid-a', 'petFamily'));

    const round = app.kitty.completeKittyCatchRound(9);
    await flush();
    const leaving = S().leaveProfile({ timeoutMs: 5000 });
    let finished = false;
    void leaving.then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(finished).toBe(false); // the leave is waiting for the reward

    holdA.release();
    await expect(round).resolves.toMatchObject({ score: 9 });
    expect(await leaving).toEqual({ ok: true, changed: true });

    expect(await walletOf(app, 'kid-a')).toBeGreaterThan(42);
    await open(app, 'kid-b');
    expect(app.family.peekFamily()!.wallet.pawTokens).toBe(7);
    const after = await snapshot(app);
    const rest = (rows: [string, string][]) => rows.filter(([k]) => !k.startsWith(scoped('kid-a', '')));
    expect(rest(after)).toEqual(rest(before));
  });

  test('an owner stays valid while the work of its own session finishes, and turns stale the moment the session ends', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const owner = PR().captureProfileOwner();
    const seen: boolean[] = [];
    const off = PR().subscribeToActiveProfile(() => seen.push(PR().isProfileOwner(owner)));
    await S().leaveProfile();
    off();
    expect(seen).toEqual([false]); // already stale in the very notification that tells the app the profile changed
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('notification-related asynchronous work', () => {
  const reminderTask = (text: string) => ({
    id: 't1',
    text,
    category: 'Personal',
    important: false,
    kind: 'task',
    date: '2026-03-11',
    completed: false,
    time: '09:00',
    reminderMinutesBefore: 30,
  });

  test('a reminder sync that Mia started schedules nothing for her once she has left, and takes back what the phone had just scheduled', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const tasks = [reminderTask("Mia's secret task")] as unknown as import('@/utils/tasks').Task[];
    const release = hold('__holdSchedule');
    const sync = NT().syncTaskNotifications(tasks);
    await flush(); // the phone has been asked to schedule it, and is taking its time

    expect(await S().leaveProfile()).toEqual({ ok: true, changed: true }); // the leave does not wait for the phone
    release();
    const result = await sync;

    expect(result).toBe(tasks); // unchanged: no reminder id was saved onto Mia's task
    expect([...phoneState.__phone.values()]).toEqual([]); // and nothing of Mia's is left on the phone
  });

  test('a reminder sync started while nobody is open schedules nothing at all', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    await S().leaveProfile();
    const tasks = [reminderTask("Mia's secret task")] as unknown as import('@/utils/tasks').Task[];
    const result = await NT().syncTaskNotifications(tasks);
    expect(result).toBe(tasks);
    expect(require('expo-notifications').scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(phoneState.__phone.size).toBe(0);
  });

  test('a sync for the profile that IS open still schedules its reminders as before', async () => {
    const app = await boot();
    await open(app, 'kid-b');
    const tasks = [reminderTask("Leo's task")] as unknown as import('@/utils/tasks').Task[];
    const result = await NT().syncTaskNotifications(tasks);
    expect(result).not.toBe(tasks);
    expect([...phoneState.__phone.values()]).toEqual(["Leo's task"]);
  });

  test('an alert setting asked for through a permission prompt that stays open is not saved into the next profile', async () => {
    const app = await boot();
    await open(app, 'kid-a');
    const release = hold('__holdPermission');
    const pending = app.alerts.setNotificationsEnabled(true); // the prompt is open
    await flush();
    await S().leaveProfile();
    await open(app, 'kid-b');
    const before = await snapshot(app);

    release(); // Mia answers the prompt later
    expect(await pending).toBe(false);
    await flush();
    expect(await snapshot(app)).toEqual(before);
    expect(await app.AsyncStorage.getItem(scoped('kid-b', 'petAlertSettings'))).toBeNull();
  });

  test('the shell timers and the pet-alert and Pawadise registrations are bound to their own session', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8') as string;
    const layout = read('src/app/_layout.tsx');
    expect(layout.slice(layout.indexOf('const tick = () => {'), layout.indexOf('const subscription'))).toContain('isProfileOwner(owner)');
    expect(layout).toMatch(/captureProfileOwner\(\);[\s\S]{0,400}checkForPoopAccumulation/);
    expect(read('src/utils/pawadise-mail.ts')).toMatch(/startPawadiseMail[\s\S]*captureProfileOwner\(\)[\s\S]*isProfileOwner\(owner\)/);
    expect(read('src/utils/pet-alerts.ts')).toMatch(/export function startPetAlerts[\s\S]*captureProfileOwner\(\)[\s\S]*isProfileOwner\(owner\)/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('family mode off (every real user and release build)', () => {
  test('rewards, reminders and saves work exactly as before, and nothing is ever stale without a profile change', async () => {
    const app = await boot({ family: false });
    await app.family.ensureFamilyLoaded();
    const owner = PR().captureProfileOwner();
    const walletBefore = app.family.peekFamily()!.wallet.pawTokens;

    const round = await app.kitty.completeKittyCatchRound(9, owner);
    expect(round.totalPawTokensAwarded).toBeGreaterThan(0);
    expect(app.family.peekFamily()!.wallet.pawTokens).toBeGreaterThan(walletBefore);

    const profile = await app.family.getPetProfileForSelectedPet();
    app.family.savePetProfileForSelectedPet({ ...profile, pawTokens: profile.pawTokens + 5 });
    expect(app.family.peekFamily()!.wallet.pawTokens).toBe(profile.pawTokens + 5);
    expect(PR().isProfileOwner(owner)).toBe(true);
    expect(await S().leaveProfile()).toEqual({ ok: false, reason: 'not-available' });
    expect(PR().isProfileOwner(owner)).toBe(true);
  });
});
