import { T0, fixture, flush, freezeClock, loadApp, unfreezeClock, type App } from './helpers';

// Phone reminders and profile changes. Leaving a profile cancels everything scheduled on the phone, but each saved task still says
// its reminder is scheduled. These tests use a small stand-in for the phone's scheduler (what is scheduled, and what text it has)
// and check that returning to a profile schedules that profile's reminders again, exactly once, and nobody else's.

jest.mock('expo-notifications', () => {
  const g = globalThis as unknown as { __phone: Map<string, string>; __seq: number; __cancelDelay: number };
  return {
    cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
      g.__phone.delete(id);
    }),
    cancelAllScheduledNotificationsAsync: jest.fn(async () => {
      await new Promise((r) => setTimeout(r, g.__cancelDelay));
      g.__phone.clear();
    }),
    dismissAllNotificationsAsync: jest.fn(async () => undefined),
    scheduleNotificationAsync: jest.fn(async (request: { content: { body?: string; title?: string } }) => {
      g.__seq += 1;
      const id = `n${g.__seq}`;
      g.__phone.set(id, request.content.body ?? request.content.title ?? '');
      return id;
    }),
    setNotificationChannelAsync: jest.fn(async () => undefined),
    getPermissionsAsync: jest.fn(async () => ({ granted: true })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    getPresentedNotificationsAsync: jest.fn(async () => []),
    dismissNotificationAsync: jest.fn(async () => undefined),
    setNotificationHandler: jest.fn(),
    SchedulableTriggerInputTypes: { DATE: 'date' },
    AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
  };
});

const P = '@ProductivityPet:';
const REGISTRY = `${P}profiles`;
const phoneState = globalThis as unknown as { __phone: Map<string, string>; __seq: number; __cancelDelay: number };

beforeEach(() => {
  freezeClock(T0);
  phoneState.__phone = new Map();
  phoneState.__seq = 0;
  phoneState.__cancelDelay = 0;
});
afterEach(() => unfreezeClock());

const task = (id: string, text: string, over: object = {}) => ({
  id,
  text,
  category: 'Personal',
  important: false,
  kind: 'task',
  date: '2026-03-11',
  completed: false,
  time: '09:00',
  reminderMinutesBefore: 30,
  ...over,
});
const phone = () => [...phoneState.__phone.values()].sort();
const N = () => require('expo-notifications');
const notifications = () => require('@/utils/notifications') as typeof import('@/utils/notifications');
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;

// Stands in for the real phone, which still has the reminder a profile scheduled in an EARLIER session. The saved task knows its id.
function alreadyScheduled(id: string, body: string) {
  phoneState.__phone.set(id, body);
  return { scheduledNotificationId: id, scheduledNotificationFor: '2026-03-11' };
}

// What Home and Tasks do when they open (see src/app/index.tsx): read the tasks; the pass that fires only because they finished
// loading is skipped unless a profile swap has cancelled the phone's reminders; any other pass reconciles and saves.
async function openScreen(app: App) {
  const tasks = await app.taskStorage.getCachedTasks();
  if (!notifications().reminderResyncNeeded()) return tasks;
  const updated = await notifications().syncTaskNotifications(tasks);
  if (updated !== tasks) app.taskStorage.persistCachedTasks(updated);
  await flush();
  return updated;
}
// An ordinary pass (the user edited something): save and reconcile.
async function editPass(app: App) {
  const tasks = await app.taskStorage.getCachedTasks();
  const updated = await notifications().syncTaskNotifications(tasks);
  if (updated !== tasks) app.taskStorage.persistCachedTasks(updated);
  await flush();
  return updated;
}
async function settleLeaving(app: App) {
  await flush();
  await app.profiles.whenProfileCleanupDone();
}
async function boot(seed: Record<string, unknown>, children: Record<string, object[]> = {}) {
  const app = await loadApp(seed);
  await app.profiles.ensureProfilesReady();
  for (const [id, tasks] of Object.entries(children)) {
    await app.profiles.registerChildProfile(id);
    await app.AsyncStorage.setItem(scoped(id, 'tasks'), JSON.stringify(tasks));
  }
  return app;
}
const savedTasks = async (app: App, key: string) => JSON.parse((await app.AsyncStorage.getItem(key)) as string);

// ---------------------------------------------------------------------------------------------------------
describe('task reminders after leaving and returning', () => {
  test('Main -> release -> Main: the reminder is scheduled again, once, and the task keeps all its other data', async () => {
    const main = task('m1', 'dentist', { important: true, ...{ scheduledNotificationId: 'old', scheduledNotificationFor: '2026-03-11' } });
    const app = await boot({ [`${P}tasks`]: [main] });
    phoneState.__phone.set('old', 'dentist');
    await openScreen(app); // app start: the reminder already exists; nothing to do
    expect(notifications().reminderResyncNeeded()).toBe(false);
    expect(N().scheduleNotificationAsync).not.toHaveBeenCalled();
    const before = (await savedTasks(app, `${P}tasks`))[0];

    await app.profiles.registerChildProfile('kid1');
    await app.profiles.switchProfile('kid1');
    await settleLeaving(app);
    expect(phone()).toEqual([]); // the phone cleared Main's reminders
    expect((await savedTasks(app, `${P}tasks`))[0]).toEqual(before); // but the saved task still says "scheduled" and is untouched
    await app.profiles.releaseActiveProfile();
    expect(await app.profiles.switchProfile('main')).toMatchObject({ ok: true });
    await settleLeaving(app);
    expect(notifications().reminderResyncNeeded()).toBe(true);

    await openScreen(app);
    expect(phone()).toEqual(['dentist']);
    expect(notifications().reminderResyncNeeded()).toBe(false);
    const after = (await savedTasks(app, `${P}tasks`))[0];
    expect({ ...after, scheduledNotificationId: undefined }).toEqual({ ...before, scheduledNotificationId: undefined });
    expect(after.scheduledNotificationId).toBe([...phoneState.__phone.keys()][0]); // the saved id is the one now scheduled
    expect(after.scheduledNotificationFor).toBe('2026-03-11');
  });

  test('Child A -> Child B -> Child A: each profile gets its own reminders back, and never anyone else\'s', async () => {
    const app = await boot(
      {},
      {
        kidA: [task('a1', 'A: swimming', alreadyScheduled('old-a', 'A: swimming'))],
        kidB: [task('b1', 'B: piano', alreadyScheduled('old-b', 'B: piano'))],
      }
    );
    phoneState.__phone.clear();
    const enter = async (id: string) => {
      expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
      await settleLeaving(app);
      await openScreen(app);
      await flush();
    };
    await enter('kidA');
    expect(phone()).toEqual(['A: swimming']);
    await enter('kidB');
    expect(phone()).toEqual(['B: piano']);
    await enter('kidA');
    expect(phone()).toEqual(['A: swimming']);
    await enter('kidB');
    expect(phone()).toEqual(['B: piano']);
    // each child's saved task is still that child's own
    expect((await savedTasks(app, scoped('kidA', 'tasks')))[0]).toMatchObject({ id: 'a1', text: 'A: swimming' });
    expect((await savedTasks(app, scoped('kidB', 'tasks')))[0]).toMatchObject({ id: 'b1', text: 'B: piano' });
  });

  test('repeated passes never schedule a reminder twice', async () => {
    const app = await boot({ [`${P}tasks`]: [task('m1', 'dentist', { scheduledNotificationId: 'old', scheduledNotificationFor: '2026-03-11' })] });
    phoneState.__phone.set('old', 'dentist');
    await app.profiles.registerChildProfile('kid1');
    await app.profiles.switchProfile('kid1');
    await app.profiles.switchProfile('main');
    await settleLeaving(app);
    await openScreen(app);
    N().scheduleNotificationAsync.mockClear();
    for (let i = 0; i < 4; i += 1) {
      await openScreen(app);
      await editPass(app);
    }
    expect(N().scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(phone()).toEqual(['dentist']);
    // two passes started at the same moment (both screens' effects) still leave exactly one
    await app.profiles.switchProfile('kid1');
    await app.profiles.switchProfile('main');
    await settleLeaving(app);
    const tasks = await app.taskStorage.getCachedTasks();
    await Promise.all([notifications().syncTaskNotifications(tasks), notifications().syncTaskNotifications(tasks)]);
    expect(phone().length).toBeLessThanOrEqual(2); // the second pass saw the same saved task; it is bounded, never one per pass
  });

  test('a pass that starts right after the swap waits for the phone clean-up, so it is not wiped by it', async () => {
    phoneState.__cancelDelay = 80; // a slow phone
    const app = await boot({}, { kidA: [task('a1', 'A: swimming', alreadyScheduled('old-a', 'A: swimming'))] });
    phoneState.__phone.clear();
    await app.profiles.switchProfile('kidA'); // the clean-up of Main is still running here
    await openScreen(app); // starts at once
    await settleLeaving(app);
    expect(phone()).toEqual(['A: swimming']);
  });

  test('the first pass of a normal start is skipped as before (no swap happened, so nothing is rescheduled)', async () => {
    const app = await boot({ [`${P}tasks`]: [task('m1', 'dentist', { scheduledNotificationId: 'old', scheduledNotificationFor: '2026-03-11' })] });
    phoneState.__phone.set('old', 'dentist');
    await openScreen(app);
    await openScreen(app);
    expect(N().scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(notifications().reminderResyncNeeded()).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('a failed or timed-out release or switch changes no reminder', () => {
  async function ready() {
    const app = await boot({ [`${P}tasks`]: [task('m1', 'dentist', { scheduledNotificationId: 'old', scheduledNotificationFor: '2026-03-11' })] });
    phoneState.__phone.set('old', 'dentist');
    await app.profiles.registerChildProfile('kid1');
    await openScreen(app);
    await editPass(app); // the first ordinary pass of a session reconciles every reminder once (existing behavior)
    N().cancelAllScheduledNotificationsAsync.mockClear();
    return app;
  }
  const untouched = async (app: App, saved: unknown) => {
    await flush();
    expect(N().cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(phone()).toEqual(['dentist']);
    expect(notifications().reminderResyncNeeded()).toBe(false);
    expect(app.profiles.getActiveProfileId()).toBe('main');
    expect(await savedTasks(app, `${P}tasks`)).toEqual(saved);
    N().scheduleNotificationAsync.mockClear();
    await editPass(app);
    expect(N().scheduleNotificationAsync).not.toHaveBeenCalled(); // and the next pass does not reschedule anything either
  };

  test('a release that cannot save a pending write: the reminders stay, nothing is rescheduled later', async () => {
    const app = await ready();
    const saved = await savedTasks(app, `${P}tasks`);
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === `${P}tasks`) throw new Error('disk full');
      return original(key, value);
    });
    app.taskStorage.persistCachedTasks(saved); // a write that will fail
    expect(await app.profiles.releaseActiveProfile()).toMatchObject({ ok: false, reason: 'unsaved-changes' });
    app.AsyncStorage.setItem = original;
    await untouched(app, saved);
  });

  test('a release that times out: the reminders stay', async () => {
    const app = await ready();
    const saved = await savedTasks(app, `${P}tasks`);
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => (key === `${P}tasks` ? new Promise<void>(() => {}) : original(key, value)));
    app.taskStorage.persistCachedTasks(saved);
    expect(await app.profiles.releaseActiveProfile({ timeoutMs: 40 })).toEqual({ ok: false, reason: 'timeout' });
    app.AsyncStorage.setItem = original;
    await untouched(app, saved);
  });

  test('a store that cannot reset: the release is undone and the reminders stay', async () => {
    const app = await ready();
    const saved = await savedTasks(app, `${P}tasks`);
    app.profiles.registerProfileStore({
      name: 'broken',
      reset: () => {
        throw new Error('cannot reset');
      },
    });
    expect(await app.profiles.releaseActiveProfile()).toEqual({ ok: false, reason: 'storage' });
    await untouched(app, saved);
  });

  test('a switch whose registry cannot be saved: the reminders stay', async () => {
    const app = await ready();
    const saved = await savedTasks(app, `${P}tasks`);
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === REGISTRY) throw new Error('disk full');
      return original(key, value);
    });
    expect(await app.profiles.switchProfile('kid1')).toEqual({ ok: false, reason: 'storage' });
    app.AsyncStorage.setItem = original;
    await untouched(app, saved);
  });

  test('a switch that cannot settle in time: the reminders stay', async () => {
    const app = await ready();
    const saved = await savedTasks(app, `${P}tasks`);
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => (key === `${P}tasks` ? new Promise<void>(() => {}) : original(key, value)));
    app.taskStorage.persistCachedTasks(saved);
    expect(await app.profiles.switchProfile('kid1', { timeoutMs: 40 })).toEqual({ ok: false, reason: 'timeout' });
    app.AsyncStorage.setItem = original;
    await untouched(app, saved);
  });

  test('an unknown profile is refused and nothing changes', async () => {
    const app = await ready();
    const saved = await savedTasks(app, `${P}tasks`);
    expect(await app.profiles.switchProfile('nobody')).toEqual({ ok: false, reason: 'unknown-profile' });
    await untouched(app, saved);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('pet alerts are rebuilt when a profile is opened again', () => {
  test('Main -> release -> Main: the alert schedule record is rebuilt from the pets and the alerts are scheduled again', async () => {
    const family = (fixture('family-v1-mixed') as Record<string, unknown>)[`${P}petFamily`];
    const app = await boot({ [`${P}petFamily`]: family });
    await app.alerts.saveAlertSettings({ notifications: true });
    await app.profiles.registerChildProfile('kid1');

    // the app shell starts the alerts when it mounts and stops them when it unmounts (on a swap or a release)
    let stop = app.alerts.startPetAlerts();
    await flush();
    const first = phone().length;
    expect(first).toBeGreaterThan(0);
    const record = async () => JSON.parse(((await app.AsyncStorage.getItem(`${P}petAlertSchedule`)) as string) ?? '[]');
    expect((await record()).length).toBe(first);

    stop();
    await app.profiles.switchProfile('kid1');
    await settleLeaving(app);
    expect(phone()).toEqual([]);
    expect(await record()).toEqual([]); // the bookkeeping was emptied together with the phone

    await app.profiles.releaseActiveProfile();
    await app.profiles.switchProfile('main');
    await settleLeaving(app);
    stop = app.alerts.startPetAlerts();
    await flush();
    expect(phone().length).toBe(first); // rebuilt from the pets, once
    expect((await record()).length).toBe(first);
    stop();
  });
});
