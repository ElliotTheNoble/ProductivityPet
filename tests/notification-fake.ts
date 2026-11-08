// A stateful stand-in for the phone's notification system (expo-notifications), for the notification tests. It remembers what is
// scheduled and what is in the tray, can be told to fail, hang or answer slowly, and counts every call. Use it as
//   jest.mock('expo-notifications', () => require('./notification-fake').createNotificationFake().module);
// and read the current one with getFake() (it is created again whenever the modules are reset).

export type FakeRequest = {
  identifier: string;
  content: { title?: string | null; body?: string | null; data?: Record<string, unknown> };
  trigger: { type: string; date?: unknown; channelId?: string } | null;
};

export type Fake = ReturnType<typeof createNotificationFake>;

export function createNotificationFake() {
  const state = {
    scheduled: new Map<string, FakeRequest>(),
    presented: [] as { request: FakeRequest }[],
    channels: new Map<string, Record<string, unknown>>(),
    seq: 0,
    permission: true,
    listError: null as Error | null,
    listFailuresLeft: 0, // the next N list calls fail
    presentedError: null as Error | null,
    cancelFails: new Set<string>(),
    failAllCancels: false,
    failSchedule: false,
    failScheduleIds: new Set<string>(),
    failChannels: false,
    dismissFails: new Set<string>(),
    holdList: null as Promise<void> | null, // the next list call waits for this
    holdSchedule: null as Promise<void> | null,
    holdCancel: null as Promise<void> | null,
    delayMs: 0, // every list, cancel, dismiss and presented call answers this much later (use with fake timers)
    handler: null as null | { handleNotification: (n: unknown) => Promise<Record<string, boolean>> },
  };
  const calls = { list: 0, cancel: [] as string[], schedule: [] as FakeRequest[], dismiss: [] as string[], cancelAll: 0, dismissAll: 0, requestPermission: 0 };

  const slow = async () => {
    if (state.delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, state.delayMs));
  };

  const module = {
    getAllScheduledNotificationsAsync: jest.fn(async () => {
      calls.list += 1;
      await slow();
      if (state.holdList) {
        const wait = state.holdList;
        state.holdList = null;
        await wait;
      }
      if (state.listFailuresLeft > 0) {
        state.listFailuresLeft -= 1;
        throw new Error('list failed');
      }
      if (state.listError) throw state.listError;
      return [...state.scheduled.values()].map((request) => ({ ...request }));
    }),
    cancelScheduledNotificationAsync: jest.fn(async (identifier: string) => {
      calls.cancel.push(identifier);
      await slow();
      if (state.holdCancel) await state.holdCancel;
      if (state.failAllCancels || state.cancelFails.has(identifier)) throw new Error('cancel failed');
      state.scheduled.delete(identifier);
    }),
    getPresentedNotificationsAsync: jest.fn(async () => {
      await slow();
      if (state.presentedError) throw state.presentedError;
      return state.presented.map((item) => ({ request: { ...item.request } }));
    }),
    dismissNotificationAsync: jest.fn(async (identifier: string) => {
      calls.dismiss.push(identifier);
      if (state.dismissFails.has(identifier)) throw new Error('dismiss failed');
      state.presented = state.presented.filter((item) => item.request.identifier !== identifier);
    }),
    scheduleNotificationAsync: jest.fn(async (request: { identifier?: string; content: FakeRequest['content']; trigger: FakeRequest['trigger'] }) => {
      if (state.holdSchedule) await state.holdSchedule;
      if (state.failSchedule || (request.identifier && state.failScheduleIds.has(request.identifier))) throw new Error('schedule failed');
      state.seq += 1;
      const identifier = request.identifier ?? `auto-${state.seq}`;
      const stored: FakeRequest = {
        identifier,
        content: { title: request.content.title ?? null, body: request.content.body ?? null, data: request.content.data ?? {} },
        trigger: request.trigger === null ? null : { ...request.trigger, type: request.trigger.type ?? 'date' },
      };
      calls.schedule.push(stored);
      // A notification with no trigger is shown at once: it goes to the tray, not to the scheduled list.
      if (request.trigger === null) state.presented.push({ request: stored });
      else state.scheduled.set(identifier, stored);
      return identifier;
    }),
    cancelAllScheduledNotificationsAsync: jest.fn(async () => {
      calls.cancelAll += 1;
      state.scheduled.clear();
    }),
    dismissAllNotificationsAsync: jest.fn(async () => {
      calls.dismissAll += 1;
      state.presented = [];
    }),
    setNotificationChannelAsync: jest.fn(async (id: string, input: Record<string, unknown>) => {
      if (state.failChannels) throw new Error('channel failed');
      state.channels.set(id, input);
    }),
    getPermissionsAsync: jest.fn(async () => ({ granted: state.permission })),
    requestPermissionsAsync: jest.fn(async () => {
      calls.requestPermission += 1;
      return { granted: state.permission };
    }),
    setNotificationHandler: jest.fn((handler: { handleNotification: (n: unknown) => Promise<Record<string, boolean>> } | null) => {
      state.handler = handler;
    }),
    SchedulableTriggerInputTypes: { DATE: 'date' },
    AndroidImportance: { UNKNOWN: 0, UNSPECIFIED: -1000, NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
    AndroidNotificationVisibility: { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 },
    AndroidNotificationPriority: { MIN: 'min', LOW: 'low', DEFAULT: 'default', HIGH: 'high', MAX: 'max' },
  };

  const fake = { module, state, calls };
  (globalThis as unknown as { __fakeNotifications: typeof fake }).__fakeNotifications = fake;
  return fake;
}

export function getFake(): Fake {
  return (globalThis as unknown as { __fakeNotifications: Fake }).__fakeNotifications;
}

// Helpers to put things on the "phone" the way the app's own code would.
export function putScheduled(fake: Fake, request: Partial<FakeRequest> & { identifier: string }): void {
  fake.state.scheduled.set(request.identifier, {
    identifier: request.identifier,
    content: request.content ?? { title: 'x', body: 'y', data: {} },
    trigger: request.trigger === undefined ? { type: 'date' } : request.trigger,
  });
}
export function putPresented(fake: Fake, request: Partial<FakeRequest> & { identifier: string }): void {
  fake.state.presented.push({
    request: { identifier: request.identifier, content: request.content ?? { title: 'x', body: 'y', data: {} }, trigger: request.trigger ?? null },
  });
}
export const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
