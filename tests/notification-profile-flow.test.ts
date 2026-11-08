import * as ReactNative from 'react-native';

import { deferred, getFake, putScheduled, type Fake } from './notification-fake';
import { HOUR, T0, configurePin, flush, freezeClock, iso, loadApp, pet, resetSecure, unfreezeClock, type App } from './helpers';

// Stage 4.5e, end to end: leaving and entering profiles, the app starting, and a tab handing over, over the real profile layer, parent
// gate, stores and notification code, with a stand-in phone that remembers what is scheduled. What must hold: the private reminders of a
// profile are gone (and CHECKED) when it is left, nothing else is touched, a failed check is reported and never called success, the next
// profile never inherits or sees the old one's reminders, and a late callback of the old profile schedules nothing.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
jest.mock('expo-notifications', () => require('./notification-fake').createNotificationFake().module);

const P = '@ProductivityPet:';
const HOUSEHOLD = `${P}household`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
const originalOS = ReactNative.Platform.OS;

beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  (ReactNative.Platform as { OS: string }).OS = originalOS;
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  getCleanup().configureCleanupForTests(null);
  getCare().configureFamilyCareForTests(null);
});

const child = (id: string, nickname: string) => ({
  id,
  nickname,
  createdAt: iso(T0),
  settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' },
  tasks: [],
});
const family = (pets: object[]) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens: 5 } });
const hungry = (id: string) => pet({ id, p: { hunger: 10 } });
const alertsOn = JSON.stringify({ notifications: true, vibration: true, flash: false });

const S = () => require('@/utils/family-session') as typeof import('@/utils/family-session');
const FP = () => require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');
const NT = () => require('@/utils/notifications') as typeof import('@/utils/notifications');
const getCleanup = () => require('@/utils/notification-cleanup') as typeof import('@/utils/notification-cleanup');
const getCare = () => require('@/utils/family-care') as typeof import('@/utils/family-care');
const FN = () => require('@/utils/family-notifications') as typeof import('@/utils/family-notifications');

const reminderTask = (text: string, id = 't1') => ({
  id,
  text,
  category: 'Personal',
  important: false,
  kind: 'task',
  date: '2026-03-11',
  completed: false,
  time: '09:00',
  reminderMinutesBefore: 30,
});

const seed = () => ({
  [HOUSEHOLD]: JSON.stringify({ version: 1, parent: null, children: [child('kid-a', 'Mia'), child('kid-b', 'Leo')], selectedChildId: null }),
  [scoped('kid-a', 'petFamily')]: family([hungry('a1')]),
  [scoped('kid-a', 'petAlertSettings')]: alertsOn,
  [scoped('kid-b', 'petFamily')]: family([hungry('b1')]),
  [scoped('kid-b', 'petAlertSettings')]: alertsOn,
  [`${P}petFamily`]: family([hungry('m1')]),
  [`${P}petAlertSettings`]: alertsOn,
});

async function boot(options: { family?: boolean; os?: 'ios' | 'android' | 'web' } = {}): Promise<{ app: App; fake: Fake }> {
  jest.doMock('react-native', () => ReactNative); // the code under test sees the Platform this test sets
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  resetSecure();
  const app = await loadApp(seed());
  (ReactNative.Platform as { OS: string }).OS = options.os ?? 'ios'; // after the modules were reset: Platform is a module of its own
  await app.profiles.ensureProfilesReady();
  if (options.family !== false) {
    await configurePin(app, { unlocked: true });
    await FP().reconcileFamilyProfiles();
  }
  require('expo-notifications'); // (re)creates the stand-in phone for this set of modules
  const fake = getFake();
  getCleanup().configureCleanupForTests(null);
  getCare().configureFamilyCareForTests(null);
  return { app, fake };
}

async function open(app: App, id: string) {
  expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
  S().markProfileChosen();
  S().consumePendingRoute();
  await app.family.ensureFamilyLoaded();
}

// What the app itself would have scheduled for the open profile: a detailed pet alert and a task reminder.
async function scheduleOwnPrivate(app: App, text: string) {
  await app.alerts.setNotificationsEnabled(true);
  await app.alerts.syncPetAlerts();
  await flush();
  const tasks = [reminderTask(text)] as unknown as import('@/utils/tasks').Task[];
  await NT().syncTaskNotifications(tasks);
}
const kinds = (fake: Fake) => [...fake.state.scheduled.values()].map((r) => ({ id: r.identifier, data: r.content.data }));

describe('what the app really schedules is recognised as private', () => {
  test('a detailed pet alert and a task reminder, made by the real code, are what the clean-up cancels', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    const own = kinds(fake);
    expect(own.some((r) => (r.data as { pp?: string }).pp === 'task')).toBe(true);
    expect(own.some((r) => typeof (r.data as { petId?: string }).petId === 'string')).toBe(true);
    const { classifyNotification, isPrivateClass } = require('@/utils/notification-ownership') as typeof import('@/utils/notification-ownership');
    for (const request of fake.state.scheduled.values()) expect(isPrivateClass(classifyNotification(request))).toBe(true);
  });
});

describe('leaving a profile', () => {
  test('its private reminders are cancelled and CHECKED: the answer says verified, and the phone really has none left', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    expect(fake.state.scheduled.size).toBeGreaterThan(0);
    const result = await S().leaveProfile();
    expect(result).toEqual({ ok: true, changed: true, notificationCleanup: 'verified' });
    expect(fake.state.scheduled.size).toBe(0);
    expect(fake.calls.cancelAll).toBe(0);
  });

  test('anonymous family-care reminders and unrelated notifications are not touched by the clean-up (and an unknown one makes it unverified)', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    putScheduled(fake, { identifier: 'pp-family-care-0', content: { title: 'ProductivityPet', body: 'A pet needs care. Open ProductivityPet.', data: {} } });
    putScheduled(fake, { identifier: 'other-feature', content: { title: 'Something else', body: 'b', data: { x: 1 } } });
    const result = await S().leaveProfile();
    expect(result).toMatchObject({ ok: true, changed: true, notificationCleanup: 'unverified' }); // the unknown one cannot be vouched for
    expect([...fake.state.scheduled.keys()].sort()).toEqual(['other-feature', 'pp-family-care-0']); // both untouched, the private ones gone
    expect(getCleanup().getCleanupSnapshot()).toMatchObject({ state: 'unverified', reason: 'unknown-notification', unknown: 1 });
  });

  test('when the phone cannot be checked the leave still succeeds (the data is safe) but says unverified, and nothing is called cleared', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    fake.state.listError = new Error('phone said no');
    const result = await S().leaveProfile();
    expect(result).toMatchObject({ ok: true, changed: true, notificationCleanup: 'unverified' });
    expect(S().hasChosenProfile()).toBe(false); // the picker is showing
    expect(app.profiles.isProfileReleased()).toBe(true); // the profile's data was released
    expect(getCleanup().getCleanupSnapshot().state).toBe('unverified');
    expect(fake.state.scheduled.size).toBeGreaterThan(0); // and the private reminders are really still there: nothing claimed
  });

  test('a cancel that fails for one reminder leaves the state unverified with the count', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    const first = [...fake.state.scheduled.keys()][0];
    fake.state.cancelFails.add(first);
    expect(await S().leaveProfile()).toMatchObject({ ok: true, notificationCleanup: 'unverified' });
    expect(getCleanup().getCleanupSnapshot()).toMatchObject({ state: 'unverified', reason: 'cancel-failed', remaining: 1 });
  });

  test('no family-care reminder is scheduled while the clean-up is unverified; it is scheduled once a retry verifies', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    fake.state.listError = new Error('down');
    await S().leaveProfile();
    getCare().configureFamilyCareForTests({ now: () => T0 });
    expect(await getCare().syncFamilyCare()).toMatchObject({ status: 'skipped', reason: 'cleanup-not-verified' });
    expect([...fake.state.scheduled.keys()].some((id) => id.startsWith('pp-family-care-'))).toBe(false);
    fake.state.listError = null;
    expect((await getCleanup().retryCleanupIfNeeded()).state).toBe('verified');
    expect(fake.state.scheduled.size).toBe(0);
    const result = await getCare().syncFamilyCare();
    expect(result.status).toBe('scheduled');
    expect([...fake.state.scheduled.keys()].every((id) => id.startsWith('pp-family-care-'))).toBe(true);
  });

  test('the leave does not wait forever for a phone that never answers: ten seconds at most, then "unverified"', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'performance', 'hrtime'] });
    fake.state.holdList = new Promise<void>(() => undefined);
    fake.state.delayMs = 3500;
    const leaving = S().leaveProfile();
    await jest.advanceTimersByTimeAsync(11_000);
    const result = await leaving;
    expect(result).toMatchObject({ ok: true, changed: true, notificationCleanup: 'unverified' });
  });
});

describe('the next profile', () => {
  test('never sees or inherits the old profile\'s reminders: Mia\'s are gone when Leo starts, and Leo\'s own are Leo\'s', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    await S().leaveProfile();
    await open(app, 'kid-b');
    expect(JSON.stringify([...fake.state.scheduled.values()])).not.toContain('secret');
    expect(fake.state.scheduled.size).toBe(0);
    await scheduleOwnPrivate(app, "Leo's own task");
    const text = JSON.stringify([...fake.state.scheduled.values()]);
    expect(text).toContain("Leo's own task");
    expect(text).not.toContain("Mia's secret task");
    // and leaving Leo takes exactly Leo's away
    expect(await S().leaveProfile()).toMatchObject({ notificationCleanup: 'verified' });
    expect(fake.state.scheduled.size).toBe(0);
  });

  test('a callback of the profile that was left cannot schedule a private reminder afterwards', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await app.alerts.setNotificationsEnabled(true);
    await app.alerts.syncPetAlerts();
    await flush();
    const hold = deferred();
    fake.state.holdSchedule = hold.promise; // from now on the phone takes its time to schedule
    const sync = NT().syncTaskNotifications([reminderTask("Mia's secret task")] as unknown as import('@/utils/tasks').Task[]);
    await flush();
    expect(await S().leaveProfile()).toMatchObject({ ok: true });
    hold.resolve();
    await sync;
    expect(JSON.stringify([...fake.state.scheduled.values()])).not.toContain('secret'); // taken back at once
  });

  test('entering a profile retries a clean-up that was left unverified, before the profile starts', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    fake.state.listError = new Error('down');
    await S().leaveProfile();
    fake.state.listError = null;
    await FN().prepareForProfileEntry(); // what the picker does right before switching
    expect(getCleanup().getCleanupSnapshot().state).toBe('verified');
    expect(fake.state.scheduled.size).toBe(0);
  });

  test('while a profile is open nothing retries behind its back: its own reminders are never cancelled by a retry', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    fake.state.listError = new Error('down');
    getCleanup().configureCleanupForTests(null);
    await getCleanup().cleanPrivateNotifications(); // unverified
    fake.state.listError = null;
    const before = fake.state.scheduled.size;
    await getCleanup().retryCleanupIfNeeded(); // a profile is open: it must do nothing
    expect(fake.state.scheduled.size).toBe(before);
    expect(getCleanup().getCleanupSnapshot().state).toBe('unverified');
  });
});

describe('the app starting', () => {
  test('stale private reminders left by an earlier run (never left properly) are cleaned before anything schedules, and reminders are re-scheduled', async () => {
    const { app, fake } = await boot();
    // as if the app had been closed by the system while Mia was open:
    putScheduled(fake, { identifier: 'stale-task', content: { title: 'Task reminder', body: "Mia's secret task", data: { pp: 'task' } } });
    putScheduled(fake, { identifier: 'stale-pet', content: { title: '🤒 Kitty', body: 'Kitty needs food', data: { petId: 'a1', kind: 'sick' } } });
    putScheduled(fake, { identifier: 'pp-family-care-0', content: { title: 'ProductivityPet', body: 'A pet needs care. Open ProductivityPet.', data: {} } });
    const epoch = app.profiles.getNotificationEpoch();
    FN().startFamilyNotifications();
    await app.profiles.whenProfileCleanupDone();
    expect(getCleanup().getCleanupSnapshot().state).toBe('verified');
    expect([...fake.state.scheduled.keys()]).toEqual(['pp-family-care-0']); // the private ones are gone, the anonymous one stays
    expect(app.profiles.getNotificationEpoch()).toBe(epoch + 1); // so the next profile's reminders are scheduled again
    expect(NT().reminderResyncNeeded()).toBe(true);
    FN().resetFamilyNotificationsForTests();
  });

  test('a profile that starts right away waits for the clean-up: its sync is not cancelled by it', async () => {
    const { app, fake } = await boot();
    putScheduled(fake, { identifier: 'stale-task', content: { title: 'Task reminder', body: 'old', data: { pp: 'task' } } });
    FN().startFamilyNotifications();
    await open(app, 'kid-b');
    await app.alerts.setNotificationsEnabled(true);
    await NT().syncTaskNotifications([reminderTask("Leo's own task")] as unknown as import('@/utils/tasks').Task[]);
    const text = JSON.stringify([...fake.state.scheduled.values()]);
    expect(text).toContain("Leo's own task");
    expect(fake.state.scheduled.has('stale-task')).toBe(false);
    FN().resetFamilyNotificationsForTests();
  });

  test('on the web nothing is started and the clean-up is "unsupported"', async () => {
    const { fake } = await boot({ os: 'web' });
    FN().startFamilyNotifications();
    expect(fake.calls.list).toBe(0);
    expect((await getCleanup().cleanPrivateNotifications()).state).toBe('unsupported');
    FN().resetFamilyNotificationsForTests();
  });
});

describe('a tab handing over (the web)', () => {
  test('leaving on the web is unaffected: the leave works and reports "unsupported" instead of claiming a clean-up', async () => {
    const { app, fake } = await boot({ os: 'web' });
    await open(app, 'kid-a');
    app.family.addToWallet(3);
    const result = await S().leaveProfile();
    expect(result).toEqual({ ok: true, changed: true, notificationCleanup: 'unsupported' });
    expect(fake.calls.list).toBe(0); // the web has no notification system to ask
    expect(app.profiles.isProfileReleased()).toBe(true);
  });
});

describe('family mode off', () => {
  test('releasing a profile still uses the old clean-up (cancel and dismiss everything), and the checked clean-up is never used', async () => {
    const { app, fake } = await boot({ family: false });
    expect(await app.profiles.switchProfile('main')).toMatchObject({ ok: true });
    await app.profiles.registerChildProfile('kid-x');
    await app.profiles.switchProfile('kid-x');
    await flush();
    await app.profiles.whenProfileCleanupDone();
    expect(fake.calls.cancelAll).toBeGreaterThan(0);
    expect(fake.calls.dismissAll).toBeGreaterThan(0);
    expect(fake.calls.list).toBe(0);
    expect(getCleanup().getCleanupSnapshot().state).toBe('idle');
    expect(await S().leaveProfile()).toEqual({ ok: false, reason: 'not-available' });
  });

  test('nothing in the notification layer starts or schedules', async () => {
    const { fake } = await boot({ family: false });
    FN().startFamilyNotifications();
    expect(await getCare().syncFamilyCare()).toMatchObject({ status: 'skipped', reason: 'disabled' });
    expect(fake.calls.list).toBe(0);
    expect(fake.calls.schedule).toEqual([]);
    FN().resetFamilyNotificationsForTests();
  });
});

describe('the family-care reminders around a leave', () => {
  test('after leaving, the anonymous reminders cover the profile that was just left too; with a profile open they leave that one out', async () => {
    const { app, fake } = await boot();
    getCare().configureFamilyCareForTests({ now: () => T0 });
    await open(app, 'kid-a');
    await getCleanup().cleanPrivateNotifications();
    await getCare().syncFamilyCare();
    const whileOpen = [...fake.state.scheduled.values()].filter((r) => r.identifier.startsWith('pp-family-care-'));
    await S().leaveProfile();
    await getCare().syncFamilyCare();
    const atPicker = [...fake.state.scheduled.values()].filter((r) => r.identifier.startsWith('pp-family-care-'));
    // three profiles (Main, Mia, Leo) have an identical hungry pet and alerts on: events group into one sick and one critical reminder
    // either way, but with Mia open only Main and Leo count and at the picker all three do
    expect(atPicker.length).toBeGreaterThan(0);
    expect(whileOpen.length).toBeGreaterThan(0);
    for (const request of atPicker) expect(request.content).toEqual({ title: 'ProductivityPet', body: 'A pet needs care. Open ProductivityPet.', data: {} });
    expect(JSON.stringify(atPicker)).not.toMatch(/Mia|Leo|kid-|a1|b1|m1/);
  });
});

describe('the race that was found in review: a retry that was waiting for the phone', () => {
  test('a retry is waiting for a slow phone, the next profile opens and schedules its task reminder, the late list arrives: the reminder survives and nothing is claimed', async () => {
    const { app, fake } = await boot();
    const timers: (() => void)[] = [];
    getCleanup().configureCleanupForTests({ setTimer: (run) => timers.push(run), clearTimer: () => undefined }); // the real "nobody has a profile open" rule stays
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    fake.state.listError = new Error('down');
    expect(await S().leaveProfile()).toMatchObject({ ok: true, notificationCleanup: 'unverified' });
    fake.state.listError = null;
    expect(timers).toHaveLength(1); // the retry is armed

    const hold = deferred();
    fake.state.holdList = hold.promise; // the phone is slow to answer
    timers[0](); // the retry fires: the picker is showing, nobody has a profile open
    await flush();
    await open(app, 'kid-b'); // a child taps their name
    await app.alerts.setNotificationsEnabled(true);
    await NT().syncTaskNotifications([reminderTask("Leo's own task")] as unknown as import('@/utils/tasks').Task[]);
    expect(JSON.stringify([...fake.state.scheduled.values()])).toContain("Leo's own task");
    const leoIds = [...fake.state.scheduled.values()].filter((r) => r.content.body === "Leo's own task").map((r) => r.identifier);

    hold.resolve(); // now the late list arrives, and it contains Leo's reminder
    await getCleanup().whenCleanupSettled();
    await flush();
    for (const id of leoIds) expect(fake.state.scheduled.has(id)).toBe(true); // survived
    expect(fake.calls.cancel.filter((id) => leoIds.includes(id))).toEqual([]); // never even asked to cancel it
    expect(getCleanup().getCleanupSnapshot().state).toBe('unverified'); // and the earlier failure is still not called cleared
    expect(JSON.stringify([...fake.state.scheduled.values()])).toContain("Mia's secret task"); // honest: Mia's are still there, because it could not be checked
  });

  test('entering a profile waits for a clean-up that is running, but never more than three seconds', async () => {
    const { app, fake } = await boot();
    await open(app, 'kid-a');
    await scheduleOwnPrivate(app, "Mia's secret task");
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'performance', 'hrtime'] });
    fake.state.delayMs = 500; // list, cancel, list, tray, tray: a few seconds in all
    const leaving = S().leaveProfile();
    await jest.advanceTimersByTimeAsync(10);
    expect(getCleanup().getCleanupSnapshot().state).toBe('running');
    let entered = false;
    void FN().prepareForProfileEntry().then(() => {
      entered = true;
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(entered).toBe(false); // still waiting for the clean-up (it takes about 2.5 seconds)
    await jest.advanceTimersByTimeAsync(2200);
    expect(entered).toBe(true);
    await jest.advanceTimersByTimeAsync(5000);
    await leaving;

    // a phone that is much slower than that does not hold the entry for more than three seconds
    await open(app, 'kid-b');
    await scheduleOwnPrivate(app, "Leo's task");
    fake.state.delayMs = 2500;
    const second = S().leaveProfile();
    await jest.advanceTimersByTimeAsync(10);
    let enteredAgain = false;
    void FN().prepareForProfileEntry().then(() => {
      enteredAgain = true;
    });
    await jest.advanceTimersByTimeAsync(3050);
    expect(enteredAgain).toBe(true);
    expect(getCleanup().getCleanupSnapshot().state).toBe('running'); // the clean-up carries on in the background
    await jest.advanceTimersByTimeAsync(30_000);
    await second;
  });

  test('when nothing needs doing, preparing to enter is immediate and asks the phone nothing', async () => {
    const { fake } = await boot();
    await getCleanup().cleanPrivateNotifications();
    const lists = fake.calls.list;
    await FN().prepareForProfileEntry();
    expect(fake.calls.list).toBe(lists);
  });
});

describe('family mode off: notification content is exactly what it always was', () => {
  test('a task reminder has a title and a body and nothing else', async () => {
    const { app, fake } = await boot({ family: false });
    await app.alerts.setNotificationsEnabled(true);
    await NT().syncTaskNotifications([reminderTask("Mia's task")] as unknown as import('@/utils/tasks').Task[]);
    const requests = fake.module.scheduleNotificationAsync.mock.calls.map(([request]: [{ content: Record<string, unknown> }]) => request);
    expect(requests.length).toBeGreaterThan(0);
    const task = requests.find((request) => request.content.body === "Mia's task")!;
    expect(Object.keys(task.content).sort()).toEqual(['body', 'title']);
  });

  test('the test notification has no ownership tag', async () => {
    const { app, fake } = await boot({ family: false });
    expect(await app.alerts.sendTestNotification()).toBe(true);
    const [request] = fake.module.scheduleNotificationAsync.mock.calls[0] as [{ content: Record<string, unknown> }];
    expect(Object.keys(request.content).sort()).toEqual(['body', 'sound', 'title']);
  });

  test('with family mode ON the same two carry their tags (the ownership classes the clean-up relies on)', async () => {
    const { app, fake } = await boot();
    await app.alerts.setNotificationsEnabled(true);
    await NT().syncTaskNotifications([reminderTask("Mia's task")] as unknown as import('@/utils/tasks').Task[]);
    await app.alerts.sendTestNotification();
    const calls = fake.module.scheduleNotificationAsync.mock.calls as [{ content: { body?: string; data?: Record<string, unknown> } }][];
    expect(calls.find(([request]) => request.content.body === "Mia's task")![0].content.data).toEqual({ pp: 'task' });
    expect(calls[calls.length - 1][0].content.data).toEqual({ pp: 'test' });
  });
});
