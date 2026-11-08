import { createNotificationFake, getFake, putPresented, putScheduled, deferred } from './notification-fake';
import {
  CALL_DEADLINE_MS,
  CLEANUP_BOUND_MS,
  RETRY_DELAYS_MS,
  cleanPrivateNotifications,
  configureCleanupForTests,
  getCleanupSnapshot,
  retryCleanupIfNeeded,
  subscribeToCleanup,
  whenCleanupSettled,
  type NativeNotifications,
} from '@/utils/notification-cleanup';

jest.mock('expo-notifications', () => require('./notification-fake').createNotificationFake().module);
require('expo-notifications'); // creates the stand-in phone (see notification-fake.ts)

// Stage 4.5e: the checked clean-up of private notifications. List, classify, cancel only what is positively private, list again, and
// say "verified" only when that is really so. Over a stateful stand-in for the phone that can fail, hang and answer slowly.

const task = { content: { title: 'Task reminder', body: "Mia's secret task", data: { pp: 'task' } } };
const pet = { content: { title: '🤒 Kitty isn\'t feeling well', body: 'Kitty needs food', data: { petId: 'pet-1', kind: 'sick' } } };
const legacy = { content: { title: 'Task reminder', body: 'Old reminder', data: {} } };
const generic = { content: { title: 'ProductivityPet', body: 'A pet needs care. Open ProductivityPet.', data: {} } };
const testNote = { content: { title: 'T', body: 'B', data: { pp: 'test' } } };
const unknown = { content: { title: 'Mystery', body: 'Who made me?', data: {} } };

let timers: { id: number; run: () => void; ms: number }[] = [];
let canRun = true;
const fake = () => getFake();
const api = () => fake().module as unknown as NativeNotifications;

function setup(overrides: Parameters<typeof configureCleanupForTests>[0] = {}) {
  timers = [];
  canRun = true;
  let next = 1;
  configureCleanupForTests({
    api,
    canRun: () => canRun,
    setTimer: (run, ms) => {
      const id = next++;
      timers.push({ id, run, ms });
      return id;
    },
    clearTimer: (handle) => {
      timers = timers.filter((timer) => timer.id !== handle);
    },
    ...overrides,
  });
}
const fire = () => {
  const timer = timers.shift();
  if (!timer) throw new Error('no retry timer is waiting');
  timer.run();
};

beforeEach(() => {
  createNotificationFake(); // a fresh phone for every test (nothing left over from an earlier one)
  setup();
});
afterEach(() => {
  jest.useRealTimers();
  configureCleanupForTests(null);
});

describe('a clean-up that works', () => {
  test('cancels exactly the private ones (task, pet alert, older task reminder), checks, and says verified', async () => {
    putScheduled(fake(), { identifier: 'a-task', ...task });
    putScheduled(fake(), { identifier: 'a-pet', ...pet });
    putScheduled(fake(), { identifier: 'a-legacy', ...legacy, trigger: { type: 'date' } });
    putScheduled(fake(), { identifier: 'pp-family-care-0', ...generic });
    putScheduled(fake(), { identifier: 'a-test', ...testNote });
    const result = await cleanPrivateNotifications();
    expect(result).toEqual({ state: 'verified', reason: null, remaining: 0, unknown: 0 });
    expect(fake().calls.cancel.sort()).toEqual(['a-legacy', 'a-pet', 'a-task']);
    expect([...fake().state.scheduled.keys()].sort()).toEqual(['a-test', 'pp-family-care-0']); // everything else is exactly as it was
    expect(fake().calls.cancelAll).toBe(0);
    expect(fake().calls.dismissAll).toBe(0);
  });

  test('lists twice (before and after) so the claim is checked, never assumed', async () => {
    putScheduled(fake(), { identifier: 'a-task', ...task });
    await cleanPrivateNotifications();
    expect(fake().calls.list).toBe(2);
  });

  test('with nothing on the phone it is verified', async () => {
    expect((await cleanPrivateNotifications()).state).toBe('verified');
    expect(fake().calls.cancel).toEqual([]);
  });

  test('private notifications in the tray are dismissed one by one; family-care and test ones stay', async () => {
    putPresented(fake(), { identifier: 't-pet', ...pet });
    putPresented(fake(), { identifier: 't-task', ...task });
    putPresented(fake(), { identifier: 'pp-family-care-1', ...generic });
    putPresented(fake(), { identifier: 't-test', ...testNote });
    expect((await cleanPrivateNotifications()).state).toBe('verified');
    expect(fake().calls.dismiss.sort()).toEqual(['t-pet', 't-task']);
    expect(fake().state.presented.map((item) => item.request.identifier).sort()).toEqual(['pp-family-care-1', 't-test']);
    expect(fake().calls.dismissAll).toBe(0);
  });

  test('only the snapshot is cancelled: something scheduled after the list is never touched by this run (and the run does not claim it is clean)', async () => {
    putScheduled(fake(), { identifier: 'old', ...task });
    const hold = deferred();
    fake().state.holdCancel = hold.promise; // the run has listed ['old'] and is now waiting to cancel it
    const run = cleanPrivateNotifications();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    putScheduled(fake(), { identifier: 'newer', ...task }); // another profile's reminder, scheduled while the clean-up waits
    hold.resolve();
    const result = await run;
    expect(fake().calls.cancel).toEqual(['old']); // 'newer' was not in the snapshot, so it was not cancelled
    expect(fake().state.scheduled.has('newer')).toBe(true);
    expect(result).toMatchObject({ state: 'unverified', reason: 'still-scheduled', remaining: 1 }); // and it does not say "verified"
  });
});

describe('what is never touched', () => {
  test('an unknown notification is never cancelled or dismissed, and keeps the state unverified', async () => {
    putScheduled(fake(), { identifier: 'mystery', ...unknown });
    putScheduled(fake(), { identifier: 'a-task', ...task });
    putPresented(fake(), { identifier: 'tray-mystery', ...unknown });
    const result = await cleanPrivateNotifications();
    expect(result.state).toBe('unverified');
    expect(result.reason).toBe('unknown-notification');
    expect(result.unknown).toBe(2);
    expect(fake().calls.cancel).toEqual(['a-task']); // the private one still goes
    expect(fake().calls.dismiss).toEqual([]);
    expect(fake().state.scheduled.has('mystery')).toBe(true);
  });

  test('a lookalike (the reserved prefix with data) is unknown and untouched', async () => {
    putScheduled(fake(), { identifier: 'pp-family-care-3', content: { title: 'x', body: 'y', data: { pp: 'task' } } });
    const result = await cleanPrivateNotifications();
    expect(result.state).toBe('unverified');
    expect(fake().calls.cancel).toEqual([]);
  });

  test('a title that merely looks like a task reminder, without a date trigger, is unknown and untouched', async () => {
    putScheduled(fake(), { identifier: 'looks-like', content: { title: 'Task reminder', body: 'b', data: {} }, trigger: null });
    const result = await cleanPrivateNotifications();
    expect(result.state).toBe('unverified');
    expect(fake().calls.cancel).toEqual([]);
  });
});

describe('failures are reported, never hidden', () => {
  test('the first list fails: nothing is cancelled and the state is unverified', async () => {
    putScheduled(fake(), { identifier: 'a-task', ...task });
    fake().state.listError = new Error('boom');
    const result = await cleanPrivateNotifications();
    expect(result).toMatchObject({ state: 'unverified', reason: 'list-failed' });
    expect(fake().calls.cancel).toEqual([]);
    expect(fake().state.scheduled.has('a-task')).toBe(true);
  });

  test('the check-list after cancelling fails: unverified even though everything was cancelled', async () => {
    putScheduled(fake(), { identifier: 'a-task', ...task });
    const original = fake().module.getAllScheduledNotificationsAsync.getMockImplementation()!;
    let n = 0;
    fake().module.getAllScheduledNotificationsAsync.mockImplementation(async () => {
      n += 1;
      if (n === 2) throw new Error('second list failed');
      return original();
    });
    const result = await cleanPrivateNotifications();
    expect(result).toMatchObject({ state: 'unverified', reason: 'list-failed' });
    expect(fake().state.scheduled.has('a-task')).toBe(false);
  });

  test('one cancel fails (partial completion): the others are done, the state is unverified with the count', async () => {
    putScheduled(fake(), { identifier: 'ok-1', ...task });
    putScheduled(fake(), { identifier: 'bad', ...pet });
    putScheduled(fake(), { identifier: 'ok-2', ...task });
    fake().state.cancelFails.add('bad');
    const result = await cleanPrivateNotifications();
    expect(result).toMatchObject({ state: 'unverified', reason: 'cancel-failed', remaining: 1 });
    expect([...fake().state.scheduled.keys()]).toEqual(['bad']);
  });

  test('every cancel fails: unverified, nothing claimed', async () => {
    putScheduled(fake(), { identifier: 'a', ...task });
    putScheduled(fake(), { identifier: 'b', ...pet });
    fake().state.failAllCancels = true;
    const result = await cleanPrivateNotifications();
    expect(result).toMatchObject({ state: 'unverified', reason: 'cancel-failed', remaining: 2 });
  });

  test('a cancel the phone reports as done but that is still listed afterwards is unverified', async () => {
    putScheduled(fake(), { identifier: 'ghost', ...task });
    fake().module.cancelScheduledNotificationAsync.mockImplementation(async () => undefined); // says yes, does nothing
    expect(await cleanPrivateNotifications()).toMatchObject({ state: 'unverified', reason: 'still-scheduled', remaining: 1 });
  });

  test('the tray cannot be listed: unverified', async () => {
    fake().state.presentedError = new Error('tray failed');
    expect(await cleanPrivateNotifications()).toMatchObject({ state: 'unverified', reason: 'tray-failed' });
  });

  test('a tray notification that cannot be dismissed: unverified', async () => {
    putPresented(fake(), { identifier: 'stuck', ...pet });
    fake().state.dismissFails.add('stuck');
    expect(await cleanPrivateNotifications()).toMatchObject({ state: 'unverified', reason: 'tray-remaining' });
  });

  test('the phone calls throwing at once (not even a promise) are handled', async () => {
    fake().module.getAllScheduledNotificationsAsync.mockImplementation((() => {
      throw new Error('sync throw');
    }) as never);
    expect(await cleanPrivateNotifications()).toMatchObject({ state: 'unverified', reason: 'list-failed' });
  });
});

describe('where there is nothing to clean', () => {
  test('Expo Go on Android (every call fails with the same descriptive error) is "unsupported", not a failure', async () => {
    fake().state.listError = new Error('Android Push notifications functionality provided by expo-notifications was removed from Expo Go');
    expect(await cleanPrivateNotifications()).toMatchObject({ state: 'unsupported', reason: null });
  });

  test('no notification module at all (the web) is "unsupported" and calls nothing', async () => {
    setup({ api: () => null });
    expect(await cleanPrivateNotifications()).toMatchObject({ state: 'unsupported' });
    expect(fake().calls.list).toBe(0);
  });

  test('a different failure is never mistaken for "unsupported"', async () => {
    fake().state.listError = new Error('The operation could not be completed');
    expect((await cleanPrivateNotifications()).state).toBe('unverified');
  });
});

describe('time', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'performance', 'hrtime'] }));

  test('one call that never answers is given up after its deadline, and the state is unverified (not hung)', async () => {
    putScheduled(fake(), { identifier: 'a-task', ...task });
    fake().state.holdCancel = new Promise<void>(() => undefined); // never answers
    const run = cleanPrivateNotifications();
    await jest.advanceTimersByTimeAsync(CALL_DEADLINE_MS + 10);
    expect(await run).toMatchObject({ state: 'unverified', reason: 'cancel-failed', remaining: 1 });
  });

  test('the whole clean-up has a bound: slow answers end as "timeout" at ten seconds, and a late success still improves the state', async () => {
    putScheduled(fake(), { identifier: 'a-task', ...task });
    fake().state.delayMs = 3500; // list, cancel, list, presented, dismiss-less, presented: more than ten seconds in all
    const run = cleanPrivateNotifications();
    await jest.advanceTimersByTimeAsync(CLEANUP_BOUND_MS + 1);
    expect(await run).toMatchObject({ state: 'unverified', reason: 'timeout' });
    await jest.advanceTimersByTimeAsync(20_000); // the slow work finishes after all
    expect(getCleanupSnapshot().state).toBe('verified');
  });

  test('the state is "running" while it works', async () => {
    fake().state.delayMs = 100;
    const states: string[] = [];
    subscribeToCleanup(() => states.push(getCleanupSnapshot().state));
    const run = cleanPrivateNotifications();
    expect(getCleanupSnapshot().state).toBe('running');
    await jest.advanceTimersByTimeAsync(2000);
    await run;
    expect(states[0]).toBe('running');
    expect(states[states.length - 1]).toBe('verified');
  });
});

describe('a request made while a clean-up is running', () => {
  test('is not satisfied by that run: one more run starts after it and sees what was scheduled meanwhile', async () => {
    const hold = deferred();
    fake().state.holdList = hold.promise;
    const first = cleanPrivateNotifications();
    await Promise.resolve();
    const second = cleanPrivateNotifications(); // e.g. a profile was just left
    const third = cleanPrivateNotifications(); // and a third request joins the same follow-up run
    expect(second).toBe(third);
    putScheduled(fake(), { identifier: 'scheduled-meanwhile', ...pet }); // scheduled after the first run started, before it listed
    hold.resolve();
    await first;
    expect((await second).state).toBe('verified');
    expect(fake().state.scheduled.has('scheduled-meanwhile')).toBe(false);
    expect(fake().calls.list).toBe(4); // two full runs
  });
});

describe('retries', () => {
  test('an unverified result is retried after 2, 10 and 60 seconds, then left to the later triggers', async () => {
    fake().state.listError = new Error('down');
    await cleanPrivateNotifications();
    expect(timers.map((timer) => timer.ms)).toEqual([RETRY_DELAYS_MS[0]]);
    fire();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(timers.map((timer) => timer.ms)).toEqual([RETRY_DELAYS_MS[1]]);
    fire();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(timers.map((timer) => timer.ms)).toEqual([RETRY_DELAYS_MS[2]]);
    fire();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(timers).toEqual([]); // no more by itself
    expect(getCleanupSnapshot().state).toBe('unverified');
  });

  test('a retry that works ends the retrying and the warning', async () => {
    fake().state.listError = new Error('down');
    await cleanPrivateNotifications();
    fake().state.listError = null;
    fire();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(getCleanupSnapshot().state).toBe('verified');
    expect(timers).toEqual([]);
  });

  test('a retry never runs while somebody has a profile open (it could cancel THEIR reminders)', async () => {
    fake().state.listError = new Error('down');
    await cleanPrivateNotifications();
    const lists = fake().calls.list;
    canRun = false;
    putScheduled(fake(), { identifier: 'open-profile-task', ...task });
    fake().state.listError = null;
    fire();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(fake().calls.list).toBe(lists);
    expect(fake().state.scheduled.has('open-profile-task')).toBe(true);
  });

  test('retryCleanupIfNeeded runs only when the state is unverified and nobody has a profile open', async () => {
    expect((await retryCleanupIfNeeded()).state).toBe('verified'); // idle -> runs once
    const lists = fake().calls.list;
    await retryCleanupIfNeeded();
    expect(fake().calls.list).toBe(lists); // verified: nothing to do
    fake().state.listError = new Error('down');
    await cleanPrivateNotifications();
    fake().state.listError = null;
    canRun = false;
    const before = fake().calls.list;
    await retryCleanupIfNeeded();
    expect(fake().calls.list).toBe(before);
    canRun = true;
    expect((await retryCleanupIfNeeded()).state).toBe('verified');
  });
});

describe('a clean-up that nobody is waiting for gives up when a profile opens (Stage 4.5e review)', () => {
  const settle = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

  async function unverifiedFirst() {
    fake().state.listError = new Error('down');
    await cleanPrivateNotifications();
    fake().state.listError = null;
    expect(getCleanupSnapshot().state).toBe('unverified');
  }

  test('THE RACE: a retry waits for a slow phone, a new profile schedules a task reminder, the late list contains it, and it is NOT cancelled', async () => {
    await unverifiedFirst();
    const hold = deferred();
    fake().state.holdList = hold.promise; // the phone is slow to answer the list
    fire(); // the retry timer: nobody has a profile open at this moment
    await settle();
    canRun = false; // a child's profile opens...
    putScheduled(fake(), { identifier: 'new-profile-task', ...task }); // ...and schedules ITS OWN reminder
    hold.resolve(); // now the late list arrives, containing it
    await settle();
    await settle();
    expect(fake().calls.cancel).toEqual([]);
    expect(fake().state.scheduled.has('new-profile-task')).toBe(true);
  });

  test('a gave-up run claims nothing: the state is exactly what it was, and in particular not verified', async () => {
    await unverifiedFirst();
    const before = getCleanupSnapshot();
    const hold = deferred();
    fake().state.holdList = hold.promise;
    const run = retryCleanupIfNeeded();
    await settle();
    canRun = false;
    hold.resolve();
    const after = await run;
    expect(after).toEqual(before);
    expect(after.state).not.toBe('verified');
    expect(fake().calls.list).toBe(2); // the first (failed) run's list, and this run's one list: it never listed again to "check"
  });

  test('a gave-up run from the idle state leaves it idle (so a later trigger can still run)', async () => {
    const hold = deferred();
    fake().state.holdList = hold.promise;
    const run = cleanPrivateNotifications({ guarded: true });
    await settle();
    canRun = false;
    hold.resolve();
    expect((await run).state).toBe('idle');
    canRun = true;
    expect((await retryCleanupIfNeeded()).state).toBe('verified');
  });

  test('the tray is guarded too: a profile that opens while the tray is being listed keeps its delivered notifications', async () => {
    putPresented(fake(), { identifier: 'new-profile-tray', ...task });
    let calls = 0;
    const original = fake().module.getPresentedNotificationsAsync.getMockImplementation()!;
    fake().module.getPresentedNotificationsAsync.mockImplementation(async () => {
      calls += 1;
      const answer = await original();
      canRun = false; // the profile opens while the phone is answering the tray list
      return answer;
    });
    const result = await cleanPrivateNotifications({ guarded: true });
    expect(fake().calls.dismiss).toEqual([]);
    expect(fake().state.presented.map((item) => item.request.identifier)).toEqual(['new-profile-tray']);
    expect(result.state).toBe('idle');
    expect(calls).toBe(1);
  });

  test('a guarded request while a run is going joins it; it does not queue a second run', async () => {
    const hold = deferred();
    fake().state.holdList = hold.promise;
    const first = cleanPrivateNotifications();
    await settle();
    const joined = cleanPrivateNotifications({ guarded: true });
    expect(joined).toBe(first);
    hold.resolve();
    await first;
    expect(fake().calls.list).toBe(2); // one run only
  });

  test('a clean-up started by a leave is NOT guarded: it finishes even though the next profile is already being chosen (the next profile waits for it)', async () => {
    putScheduled(fake(), { identifier: 'left-profile-task', ...task });
    canRun = false;
    const result = await cleanPrivateNotifications();
    expect(result.state).toBe('verified');
    expect(fake().calls.cancel).toEqual(['left-profile-task']);
  });

  test('whenCleanupSettled waits for the run in progress and the one queued behind it, and is immediate when there is none', async () => {
    await expect(whenCleanupSettled()).resolves.toBeUndefined();
    const hold = deferred();
    fake().state.holdList = hold.promise;
    const first = cleanPrivateNotifications();
    await settle();
    const second = cleanPrivateNotifications();
    let settled = false;
    void whenCleanupSettled().then(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);
    hold.resolve();
    await Promise.all([first, second]);
    await settle();
    expect(settled).toBe(true);
  });
});

describe('what counts as "unsupported" (Stage 4.5e review)', () => {
  const failWith = async (error: unknown) => {
    fake().module.getAllScheduledNotificationsAsync.mockImplementation((async () => {
      throw error;
    }) as never);
    return cleanPrivateNotifications();
  };

  test.each([
    ["The notification service isn't available right now"],
    ['This feature is not available on this device'],
    ['Notifications are not available on this platform at the moment'],
    ['ERR_UNAVAILABLE'], // the code written in the text only: wording alone proves nothing
    ['ERR_METHOD_NOT_AVAILABLE'],
    ['Unavailable'],
    ['The operation could not be completed'],
    ['network error'],
    [''],
  ])('the ambiguous message %j is a failure (unverified), never "unsupported"', async (message) => {
    const result = await failWith(new Error(message));
    expect(result.state).toBe('unverified');
    expect(result.reason).toBe('list-failed');
  });

  test('odd things thrown are failures too: null, undefined, a number, an object without a code', async () => {
    for (const thrown of [null, undefined, 7, {}, { code: 'ERR_SOMETHING_ELSE' }, { message: 'Expo Go' }]) {
      configureCleanupForTests({ api, canRun: () => true, setTimer: () => 0, clearTimer: () => undefined });
      expect([thrown, (await failWith(thrown)).state]).toEqual([thrown, 'unverified']);
    }
  });

  test('the confirmed signs are recognised: the exact error code, and the Expo Go message', async () => {
    const withCode = Object.assign(new Error('The method or property getAllScheduledNotificationsAsync is not available on android'), { code: 'ERR_UNAVAILABLE' });
    expect((await failWith(withCode)).state).toBe('unsupported');
    configureCleanupForTests({ api, canRun: () => true, setTimer: () => 0, clearTimer: () => undefined });
    expect((await failWith(new Error('expo-notifications: Android Push notifications functionality was removed from Expo Go with SDK 53'))).state).toBe('unsupported');
    configureCleanupForTests({ api, canRun: () => true, setTimer: () => 0, clearTimer: () => undefined });
    expect((await failWith('Expo Go does not support this')).state).toBe('unsupported');
  });

  test('"unsupported" is never "verified", and never carries a reason or counts', async () => {
    const result = await failWith(Object.assign(new Error('x'), { code: 'ERR_UNAVAILABLE' }));
    expect(result).toEqual({ state: 'unsupported', reason: null, remaining: 0, unknown: 0 });
    expect(result.state).not.toBe('verified');
  });

  test('the tray listing failing with an ambiguous message is a failure, not unsupported', async () => {
    fake().state.presentedError = new Error("tray isn't available");
    expect(await cleanPrivateNotifications()).toMatchObject({ state: 'unverified', reason: 'tray-failed' });
  });

  test('the tray listing failing with the Expo Go message is tolerated (there is no tray to clean)', async () => {
    fake().state.presentedError = new Error('removed from Expo Go');
    expect((await cleanPrivateNotifications()).state).toBe('verified');
  });
});
