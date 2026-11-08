import * as ReactNative from 'react-native';
import * as ReactTop from 'react';

import { deferred, getFake, putScheduled, type Fake } from './notification-fake';
import type { ProfileCareInput } from '@/utils/family-care-plan';

// Stage 4.5e: the anonymous family-care reminders on the phone. Real scheduler, real ownership rules and clean-up state, over a stateful
// stand-in for the phone. What is checked: only its own reminders are ever replaced, what a reminder contains, the Android channels,
// who is included, the limits, and every way a run can go wrong or stale.

jest.mock('expo-notifications', () => require('./notification-fake').createNotificationFake().module);

const NOW = 1_700_000_000_000;
const H = 3_600_000;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
const originalOS = ReactNative.Platform.OS;

const input = (profileId: string, events: { atMs: number; urgency: 'normal' | 'critical' }[], over: Partial<ProfileCareInput> = {}): ProfileCareInput => ({
  profileId,
  kind: profileId === 'main' ? 'main' : 'child',
  archived: false,
  alertsEnabled: true,
  readable: true,
  events,
  ...over,
});

type Mods = {
  care: typeof import('@/utils/family-care');
  cleanup: typeof import('@/utils/notification-cleanup');
  notifications: typeof import('@/utils/notifications');
  session: typeof import('@/utils/family-session');
  profiles: typeof import('@/utils/profiles');
  i18n: typeof import('@/i18n');
};

let fake: Fake;
let mods: Mods;
let people: ProfileCareInput[] = [];
let open: string | null = null;

// `verified`: run the real clean-up once so that the state is verified (as after a normal leave or start-up).
async function boot(options: { family?: boolean; os?: 'ios' | 'android' | 'web'; verified?: boolean; language?: 'en' | 'es' } = {}): Promise<void> {
  jest.resetModules();
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  (ReactNative.Platform as { OS: string }).OS = options.os ?? 'ios';
  require('expo-notifications');
  fake = getFake();
  mods = {
    care: require('@/utils/family-care'),
    cleanup: require('@/utils/notification-cleanup'),
    notifications: require('@/utils/notifications'),
    session: require('@/utils/family-session'),
    profiles: require('@/utils/profiles'),
    i18n: require('@/i18n'),
  };
  mods.i18n.setCurrentLanguage(options.language ?? 'en');
  people = [];
  open = null;
  mods.care.configureFamilyCareForTests({ inputs: async () => people, openProfileId: () => open, now: () => NOW });
  mods.cleanup.configureCleanupForTests(null);
  if (options.verified !== false) await mods.cleanup.cleanPrivateNotifications();
}

beforeEach(() => jest.useRealTimers());
afterEach(() => {
  mods?.cleanup.configureCleanupForTests(null);
  mods?.care.configureFamilyCareForTests(null);
  (ReactNative.Platform as { OS: string }).OS = originalOS;
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const scheduledOwn = () => [...fake.state.scheduled.values()].filter((r) => r.identifier.startsWith('pp-family-care-')).sort((a, b) => a.identifier.localeCompare(b.identifier));

describe('what is scheduled', () => {
  test('one anonymous reminder per planned group: exact English text, an identifier of the reserved prefix, a date, and nothing else', async () => {
    await boot();
    people = [input('kid-mia', [{ atMs: NOW + 5 * H, urgency: 'normal' }]), input('main', [{ atMs: NOW + 20 * H, urgency: 'critical' }])];
    const result = await mods.care.syncFamilyCare();
    expect(result).toEqual({ status: 'scheduled', scheduled: 2, reason: null });
    const own = scheduledOwn();
    expect(own.map((r) => r.identifier)).toEqual(['pp-family-care-0', 'pp-family-care-1']);
    for (const request of own) {
      expect(request.content).toEqual({ title: 'ProductivityPet', body: 'A pet needs care. Open ProductivityPet.', data: {} }); // data {} is the phone's "none"
      expect(request.trigger).toMatchObject({ type: 'date' });
    }
    expect(fake.calls.schedule.every((request) => !('data' in request.content) || Object.keys(request.content.data ?? {}).length === 0)).toBe(true);
    // what was passed in, not only what the stand-in kept:
    for (const [call] of fake.module.scheduleNotificationAsync.mock.calls as [{ identifier?: string; content: Record<string, unknown>; trigger: unknown }][]) {
      expect(Object.keys(call.content).sort()).toEqual(['body', 'title']);
      expect(Object.keys(call).sort()).toEqual(['content', 'identifier', 'trigger']);
    }
    expect(+(own[0].trigger as { date: Date }).date).toBe(NOW + 5 * H);
  });

  test('the exact Spanish text', async () => {
    await boot({ language: 'es' });
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    await mods.care.syncFamilyCare();
    expect(scheduledOwn()[0].content).toMatchObject({ title: 'ProductivityPet', body: 'Una mascota necesita cuidados. Abre ProductivityPet.' });
  });

  test('nothing in what is scheduled names a child, pet, profile or condition', async () => {
    await boot();
    people = [
      input('kid-mia', [{ atMs: NOW + 5 * H, urgency: 'normal' }, { atMs: NOW + 29 * H, urgency: 'critical' }]),
      input('kid-leo', [{ atMs: NOW + 9 * H, urgency: 'normal' }]),
    ];
    await mods.care.syncFamilyCare();
    const text = JSON.stringify([...fake.state.scheduled.values()]);
    for (const secret of ['kid-mia', 'kid-leo', 'Mia', 'Leo', 'pet-', 'petId', 'sick', 'critical']) expect(text).not.toContain(secret);
  });

  test('running again replaces its own reminders and does not pile up', async () => {
    await boot();
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }, { atMs: NOW + 40 * H, urgency: 'normal' }])];
    await mods.care.syncFamilyCare();
    await mods.care.syncFamilyCare();
    await mods.care.syncFamilyCare();
    expect(scheduledOwn()).toHaveLength(2);
    people = [input('main', [{ atMs: NOW + 7 * H, urgency: 'normal' }])];
    await mods.care.syncFamilyCare();
    expect(scheduledOwn().map((r) => +(r.trigger as { date: Date }).date)).toEqual([NOW + 7 * H]); // the old second one is gone
  });

  test('a profile\'s open state decides who is included: at the picker everyone, with a profile open that one is left out', async () => {
    await boot();
    people = [input('kid-a', [{ atMs: NOW + 5 * H, urgency: 'normal' }]), input('kid-b', [{ atMs: NOW + 50 * H, urgency: 'normal' }])];
    await mods.care.syncFamilyCare();
    expect(scheduledOwn()).toHaveLength(2);
    open = 'kid-a';
    await mods.care.syncFamilyCare();
    expect(scheduledOwn().map((r) => +(r.trigger as { date: Date }).date)).toEqual([NOW + 50 * H]);
  });
});

describe('only its own reminders are ever touched', () => {
  test('task reminders, pet alerts, test and unknown notifications, and lookalikes, are left exactly as they are; a name that is not ours is not overwritten', async () => {
    await boot();
    putScheduled(fake, { identifier: 'task-1', content: { title: 'Task reminder', body: "Mia's task", data: { pp: 'task' } } });
    putScheduled(fake, { identifier: 'pet-1', content: { title: 'x', body: 'y', data: { petId: 'p', kind: 'sick' } } });
    putScheduled(fake, { identifier: 'test-1', content: { title: 'x', body: 'y', data: { pp: 'test' } } });
    putScheduled(fake, { identifier: 'mystery', content: { title: 'x', body: 'y', data: {} } });
    putScheduled(fake, { identifier: 'pp-family-care-0', content: { title: 'private', body: 'private', data: { pp: 'task' } } }); // our name, but NOT ours (it has data)
    putScheduled(fake, { identifier: 'pp-family-cars-0', content: { title: 'x', body: 'y', data: {} } });
    putScheduled(fake, { identifier: 'pp-family-care-5', content: { title: 'ProductivityPet', body: 'old one', data: {} } }); // ours: to be replaced
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }, { atMs: NOW + 40 * H, urgency: 'normal' }])];
    fake.calls.cancel = [];
    const result = await mods.care.syncFamilyCare();
    expect(fake.calls.cancel).toEqual(['pp-family-care-5']); // only the one notification that is positively family-care
    for (const id of ['task-1', 'pet-1', 'test-1', 'mystery', 'pp-family-cars-0']) expect(fake.state.scheduled.has(id)).toBe(true);
    // 'pp-family-care-0' belongs to something else: it is untouched, and the reminder that wanted that name is skipped (reported as degraded)
    expect(fake.state.scheduled.get('pp-family-care-0')?.content.data).toEqual({ pp: 'task' });
    expect(result).toMatchObject({ status: 'degraded', scheduled: 1 });
    expect(fake.state.scheduled.get('pp-family-care-1')?.content.title).toBe('ProductivityPet');
  });

  test('it never uses cancel-all or dismiss-all', async () => {
    await boot();
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    await mods.care.syncFamilyCare();
    open = 'main';
    await mods.care.syncFamilyCare();
    expect(fake.calls.cancelAll).toBe(0);
    expect(fake.calls.dismissAll).toBe(0);
  });
});

describe('Android channels', () => {
  test('two NEW private channels (normal and urgent), made before anything is scheduled', async () => {
    await boot({ os: 'android' });
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }, { atMs: NOW + 40 * H, urgency: 'critical' }])];
    await mods.care.syncFamilyCare();
    expect([...fake.state.channels.keys()].sort()).toEqual(['pp-family-care', 'pp-family-care-urgent']);
    const normal = fake.state.channels.get('pp-family-care')!;
    const urgent = fake.state.channels.get('pp-family-care-urgent')!;
    expect(normal).toMatchObject({ importance: 4, lockscreenVisibility: 2, showBadge: false }); // HIGH, PRIVATE
    expect(urgent).toMatchObject({ importance: 5, lockscreenVisibility: 2, showBadge: false }); // MAX, PRIVATE
    expect(urgent.vibrationPattern).toBeTruthy();
    // not the detailed-alert channels, which are left as they are
    expect([...fake.state.channels.keys()]).not.toContain('pet-health');
    expect([...fake.state.channels.keys()]).not.toContain('pet-emergency');
    // critical reminders use the urgent channel, normal ones the normal channel
    const channels = scheduledOwn().map((r) => (r.trigger as { channelId?: string }).channelId);
    expect(channels).toEqual(['pp-family-care', 'pp-family-care-urgent']);
    expect(fake.module.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(fake.module.scheduleNotificationAsync.mock.invocationCallOrder[0]);
  });

  test('the channel names say nothing private, in both languages', async () => {
    for (const language of ['en', 'es'] as const) {
      await boot({ os: 'android', language });
      people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
      await mods.care.syncFamilyCare();
      for (const channel of fake.state.channels.values()) expect(String(channel.name)).toMatch(language === 'es' ? /^Recordatorios (urgentes )?de cuidado de mascotas$/ : /^(Urgent )?[Pp]et care reminders$/);
    }
  });

  test('if the channels cannot be made, nothing is scheduled (it must not fall back to a channel without the lock-screen setting)', async () => {
    await boot({ os: 'android' });
    fake.state.failChannels = true;
    putScheduled(fake, { identifier: 'pp-family-care-3', content: { title: 'ProductivityPet', body: 'old', data: {} } });
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'degraded', scheduled: 0, reason: 'channels-failed' });
    expect(fake.calls.schedule).toEqual([]);
    expect(scheduledOwn()).toEqual([]); // and its old reminders are taken away rather than left stale
  });

  test('iOS: no channel at all', async () => {
    await boot({ os: 'ios' });
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'critical' }])];
    await mods.care.syncFamilyCare();
    expect(fake.state.channels.size).toBe(0);
    expect((scheduledOwn()[0].trigger as { channelId?: string }).channelId).toBeUndefined();
  });
});

describe('when it does nothing', () => {
  test('family mode off', async () => {
    await boot({ family: false });
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'skipped', reason: 'disabled' });
    expect(fake.calls.schedule).toEqual([]);
    expect(fake.module.getPermissionsAsync).not.toHaveBeenCalled();
  });

  test('the web', async () => {
    await boot({ os: 'web' });
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'skipped', reason: 'disabled' });
    expect(fake.calls.schedule).toEqual([]);
  });

  test('the private clean-up is not verified: nothing new is scheduled, and it is scheduled once the clean-up is verified', async () => {
    await boot({ verified: false });
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'skipped', reason: 'cleanup-not-verified' });
    expect(fake.calls.schedule).toEqual([]);
    putScheduled(fake, { identifier: 'mystery', content: { title: 'x', body: 'y', data: {} } });
    await mods.cleanup.cleanPrivateNotifications(); // unknown notification: unverified
    expect(await mods.care.syncFamilyCare()).toMatchObject({ reason: 'cleanup-not-verified' });
    fake.state.scheduled.clear();
    await mods.cleanup.cleanPrivateNotifications();
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'scheduled', scheduled: 1 });
  });

  test('no permission: it never asks, and takes away its own old reminders', async () => {
    await boot();
    putScheduled(fake, { identifier: 'pp-family-care-0', content: { title: 'ProductivityPet', body: 'old', data: {} } });
    fake.state.permission = false;
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'skipped', reason: 'no-permission' });
    expect(fake.calls.requestPermission).toBe(0);
    expect(fake.calls.schedule).toEqual([]);
    expect(scheduledOwn()).toEqual([]);
  });

  test('a phone without the notification module', async () => {
    await boot();
    mods.care.configureFamilyCareForTests({ native: null, inputs: async () => people, openProfileId: () => open, now: () => NOW });
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'skipped', reason: 'unsupported' });
  });
});

describe('limits', () => {
  test('at most 10, and the earliest group is kept', async () => {
    await boot();
    people = [input('main', Array.from({ length: 25 }, (_, i) => ({ atMs: NOW + (2 + i * 3) * H, urgency: 'normal' as const })))];
    const result = await mods.care.syncFamilyCare();
    expect(result.scheduled).toBe(10);
    expect(scheduledOwn()).toHaveLength(10);
    expect(+(scheduledOwn()[0].trigger as { date: Date }).date).toBe(NOW + 2 * H);
  });

  test('other pending notifications use up the platform limit: 60 others leave room for 4', async () => {
    await boot();
    for (let i = 0; i < 60; i += 1) {
      putScheduled(fake, { identifier: `task-${i}`, content: { title: 'Task reminder', body: `task ${i}`, data: { pp: 'task' } } });
    }
    fake.state.scheduled.clear();
    mods.cleanup.configureCleanupForTests(null);
    await mods.cleanup.cleanPrivateNotifications(); // verified
    for (let i = 0; i < 60; i += 1) {
      putScheduled(fake, { identifier: `task-${i}`, content: { title: 'Task reminder', body: `task ${i}`, data: { pp: 'task' } } });
    }
    people = [input('main', Array.from({ length: 12 }, (_, i) => ({ atMs: NOW + (2 + i * 3) * H, urgency: 'normal' as const })))];
    expect((await mods.care.syncFamilyCare()).scheduled).toBe(4);
    expect(fake.state.scheduled.size).toBe(64);
  });

  test('when the phone will not list what is scheduled, it assumes no room is used (cap 10) and cancels only its own fixed names', async () => {
    await boot();
    putScheduled(fake, { identifier: 'task-1', content: { title: 'Task reminder', body: 'b', data: { pp: 'task' } } });
    putScheduled(fake, { identifier: 'pp-family-care-2', content: { title: 'ProductivityPet', body: 'old', data: {} } });
    fake.state.listFailuresLeft = 1;
    people = [input('main', Array.from({ length: 12 }, (_, i) => ({ atMs: NOW + (2 + i * 3) * H, urgency: 'normal' as const })))];
    const result = await mods.care.syncFamilyCare();
    expect(result.scheduled).toBe(10);
    const cancelled = fake.calls.cancel;
    expect(cancelled.sort()).toEqual(Array.from({ length: 10 }, (_, i) => `pp-family-care-${i}`).sort()); // its own namespace, nothing else
    expect(fake.state.scheduled.has('task-1')).toBe(true);
  });
});

describe('failures', () => {
  test('one reminder that cannot be scheduled does not stop the others, and nothing throws', async () => {
    await boot();
    fake.state.failScheduleIds.add('pp-family-care-1');
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }, { atMs: NOW + 40 * H, urgency: 'normal' }, { atMs: NOW + 80 * H, urgency: 'normal' }])];
    const result = await mods.care.syncFamilyCare();
    expect(result).toMatchObject({ status: 'degraded', scheduled: 2 });
    expect(scheduledOwn().map((r) => r.identifier)).toEqual(['pp-family-care-0', 'pp-family-care-2']);
    expect(mods.care.getFamilyCareStatus().status).toBe('degraded');
  });

  test('everything failing: degraded, no throw, and the next run starts clean', async () => {
    await boot();
    fake.state.failSchedule = true;
    fake.state.failAllCancels = true;
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    await expect(mods.care.syncFamilyCare()).resolves.toMatchObject({ status: 'degraded', scheduled: 0 });
    fake.state.failSchedule = false;
    fake.state.failAllCancels = false;
    await expect(mods.care.syncFamilyCare()).resolves.toMatchObject({ status: 'scheduled', scheduled: 1 });
  });

  test('inputs that cannot be read: degraded, nothing scheduled, nothing cancelled that it should keep', async () => {
    await boot();
    mods.care.configureFamilyCareForTests({ inputs: async () => { throw new Error('storage'); }, openProfileId: () => open, now: () => NOW });
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'degraded', reason: 'inputs-unreadable' });
    expect(fake.calls.schedule).toEqual([]);
  });

  test('a phone call that never answers is given up after its deadline', async () => {
    await boot();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'performance', 'hrtime'] });
    fake.state.holdSchedule = new Promise<void>(() => undefined);
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    const run = mods.care.syncFamilyCare();
    await jest.advanceTimersByTimeAsync(mods.care.CALL_DEADLINE_MS + 50);
    await expect(run).resolves.toMatchObject({ status: 'degraded', scheduled: 0 });
  });
});

describe('races', () => {
  test('requests made while a run is going are collected into one more run', async () => {
    await boot();
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    const calls = [1, 2, 3, 4, 5].map(() => mods.care.syncFamilyCare());
    await Promise.all(calls);
    expect(fake.module.getPermissionsAsync.mock.calls.length).toBeLessThanOrEqual(2);
    expect(scheduledOwn()).toHaveLength(1);
  });

  test('a profile opened while a run is going: that run stops, and the fresh run leaves that profile out', async () => {
    await boot();
    people = [input('kid-a', [{ atMs: NOW + 5 * H, urgency: 'normal' }]), input('kid-b', [{ atMs: NOW + 50 * H, urgency: 'normal' }])];
    const hold = deferred();
    fake.state.holdSchedule = hold.promise; // the first reminder is being scheduled
    const run = mods.care.syncFamilyCare();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    open = 'kid-a'; // kid-a is chosen on the picker meanwhile
    hold.resolve();
    await run;
    // the final state is the plan for "kid-a is open": only kid-b's reminder
    expect(scheduledOwn().map((r) => +(r.trigger as { date: Date }).date)).toEqual([NOW + 50 * H]);
  });

  test('a profile swap (the notification epoch changing) during a run makes it stale and it runs again', async () => {
    await boot();
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
    const hold = deferred();
    fake.state.holdSchedule = hold.promise;
    const run = mods.care.syncFamilyCare();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    mods.profiles.trackCleanup(Promise.resolve()); // bumps the epoch, as a swap does
    hold.resolve();
    await run;
    expect(scheduledOwn()).toHaveLength(1); // exactly one, not two
    expect(fake.module.getPermissionsAsync.mock.calls.length).toBeGreaterThanOrEqual(2); // it ran again
  });
});

describe('foreground banners', () => {
  const handle = async (identifier: string) => {
    mods.notifications.ensureNotificationHandler();
    return fake.state.handler!.handleNotification({ request: { identifier } });
  };

  test('a family-care reminder is delivered to the list but not shown as a banner or sound while someone uses a profile', async () => {
    await boot();
    mods.session.markProfileChosen();
    expect(await handle('pp-family-care-0')).toEqual({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false });
  });

  test('at the picker (nobody chosen) it is shown as usual', async () => {
    await boot();
    expect(await handle('pp-family-care-0')).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true });
  });

  test('every other notification is shown as before, with a profile open too', async () => {
    await boot();
    mods.session.markProfileChosen();
    for (const id of ['abc', 'pp-family-cars-0', '']) expect(await handle(id)).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true });
  });

  test('family mode off: nothing is hidden', async () => {
    await boot({ family: false });
    expect(await handle('pp-family-care-0')).toMatchObject({ shouldShowBanner: true });
  });
});

describe('only a VERIFIED clean-up allows anything to be scheduled (Stage 4.5e review)', () => {
  const plan = () => {
    people = [input('main', [{ atMs: NOW + 5 * H, urgency: 'normal' }])];
  };

  test('verified: scheduled', async () => {
    await boot();
    expect(mods.cleanup.getCleanupSnapshot().state).toBe('verified');
    plan();
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'scheduled', scheduled: 1 });
  });

  test('unsupported: nothing is scheduled', async () => {
    await boot({ verified: false });
    fake.state.listError = Object.assign(new Error('x'), { code: 'ERR_UNAVAILABLE' });
    await mods.cleanup.cleanPrivateNotifications();
    expect(mods.cleanup.getCleanupSnapshot().state).toBe('unsupported');
    fake.state.listError = null;
    plan();
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'skipped', scheduled: 0, reason: 'cleanup-not-verified' });
    expect(fake.calls.schedule).toEqual([]);
  });

  test('unverified: nothing is scheduled', async () => {
    await boot({ verified: false });
    fake.state.listError = new Error('down');
    await mods.cleanup.cleanPrivateNotifications();
    expect(mods.cleanup.getCleanupSnapshot().state).toBe('unverified');
    fake.state.listError = null;
    plan();
    expect(await mods.care.syncFamilyCare()).toMatchObject({ status: 'skipped', reason: 'cleanup-not-verified' });
    expect(fake.calls.schedule).toEqual([]);
  });

  test('never run (idle) and still running: nothing is scheduled either', async () => {
    await boot({ verified: false });
    plan();
    expect(mods.cleanup.getCleanupSnapshot().state).toBe('idle');
    expect(await mods.care.syncFamilyCare()).toMatchObject({ reason: 'cleanup-not-verified' });
    const hold = deferred();
    fake.state.holdList = hold.promise; // a clean-up that has not finished yet
    const running = mods.cleanup.cleanPrivateNotifications();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(mods.cleanup.getCleanupSnapshot().state).toBe('running');
    // (the scheduler itself waits for a clean-up that a profile swap registered; this one was started by hand, so it sees "running")
    expect(await mods.care.syncFamilyCare()).toMatchObject({ reason: 'cleanup-not-verified' });
    expect(fake.calls.schedule).toEqual([]);
    hold.resolve();
    await running; // finished, so no timer is left behind
  });

  test('in no state does it ask for notification permission', async () => {
    for (const verified of [true, false]) {
      await boot({ verified });
      plan();
      await mods.care.syncFamilyCare();
      expect(fake.calls.requestPermission).toBe(0);
      expect(fake.module.requestPermissionsAsync).not.toHaveBeenCalled();
    }
  });
});
