import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, TEST_PIN, configurePin, flush, freezeClock, loadApp, unfreezeClock, type App } from './helpers';

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
jest.mock('expo-local-authentication', () => ({
  getEnrolledLevelAsync: jest.fn(async () => 2),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));
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
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/tasks', useLocalSearchParams: () => ({}), Link: 'Link' }));

// The child's Tasks tab shows the tasks a parent assigned (all rooms and "anywhere"), in a section of its own above the child's own tasks, with
// the same buttons as the rooms and Home's tab. All of them read and change the SAME household records, so they stay in step.
const P = '@ProductivityPet:';
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;

beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const H = () => require('@/utils/household') as typeof import('@/utils/household');
const A = () => require('@/utils/assigned-tasks') as typeof import('@/utils/assigned-tasks');
const views = () => require('@/components/assigned-task-views') as typeof import('@/components/assigned-task-views');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const personal = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: `Mine ${id}`, category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: false, ...extra });

async function boot(language: 'en' | 'es' = 'en') {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app: App = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const ids: Record<string, string> = {};
  for (const name of ['Billy', 'Sarah']) {
    const added = await H().addChild(name);
    if (!added.ok || !added.id) throw new Error('child not added');
    ids[name] = added.id;
  }
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  i18n().setCurrentLanguage(language);
  return { app, ids };
}
const assign = async (childId: string, text: string, room?: string) => {
  const result = await H().addTask(childId, text, 'parent', room as never);
  if (!result.ok || !result.id) throw new Error('not assigned');
  return result.id;
};
const task = (childId: string, taskId: string) => H().peekHousehold()!.children.find((c) => c.id === childId)!.tasks.find((t) => t.id === taskId)!;
const words = (): string => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    for (const child of (node as { children?: unknown[] }).children ?? []) {
      if (typeof child === 'string') out.push(child);
      else walk(child);
    }
  };
  const tree = RNTL.screen.toJSON();
  for (const root of Array.isArray(tree) ? tree : [tree]) walk(root);
  return out.join(' | ');
};
const labels = () => RNTL.screen.queryAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
const TasksScreen = () => (require('@/app/tasks') as typeof import('@/app/tasks')).default;

describe('what the child\'s Tasks tab shows', () => {
  test('every assigned task of THIS child, with its title, its room (or Anywhere) and its state; another child\'s tasks are not there', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'Do ten jumping jacks', 'gym');
    const back = await assign(ids.Billy, 'Make the bed', 'bedroom');
    const wait = await assign(ids.Billy, 'Water the plants');
    await assign(ids.Sarah, 'SARAH-ONLY-TASK', 'kitchen');
    await H().markTaskDone(ids.Billy, back);
    await H().sendTaskBack(ids.Billy, back);
    await H().markTaskDone(ids.Billy, wait);
    await app.profiles.switchProfile(ids.Billy);
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    const text = words();
    expect(text).toContain(en('todaysTasks'));
    for (const title of ['Do ten jumping jacks', 'Make the bed', 'Water the plants']) expect(text).toContain(title);
    expect(text).toContain(en('atParentRoomLine', { room: 'Gym' }));
    expect(text).toContain(en('atParentRoomLine', { room: 'Bedroom' }));
    expect(text).toContain(en('atParentRoomLine', { room: en('atAnywhere') }));
    expect(text).toContain(en('atToDo'));
    expect(text).toContain(en('atSentBack'));
    expect(text).toContain(en('atWaiting')); // a pending task stays visible
    expect(text).not.toContain('SARAH-ONLY-TASK');
  });

  test('To do and Try again show "I did it!"; a task waiting for the parent shows "Undo" in the same place', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'Fresh one', 'gym');
    const back = await assign(ids.Billy, 'Redo one', 'gym');
    const wait = await assign(ids.Billy, 'Handed in', 'gym');
    await H().markTaskDone(ids.Billy, back);
    await H().sendTaskBack(ids.Billy, back);
    await H().markTaskDone(ids.Billy, wait);
    await app.profiles.switchProfile(ids.Billy);
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    const assignedButtons = labels().filter((l) => /^(I did it|Undo): /.test(l));
    expect(assignedButtons).toEqual([en('atDoneFor', { task: 'Fresh one' }), en('atDoneFor', { task: 'Redo one' }), en('atUndoFor', { task: 'Handed in' })]);
  });

  test('the child\'s own tasks stay in their own section, unchanged, and no Add button comes back', async () => {
    const { app, ids } = await boot();
    const mine = [personal('a'), personal('b', { completed: true, completedAt: '2026-03-10T16:00:00.000Z' })];
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify(mine));
    await assign(ids.Billy, 'From my parent task', 'gym');
    const before = (await app.dump()).get(scoped(ids.Billy, 'tasks'));
    await app.profiles.switchProfile(ids.Billy);
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    const text = words();
    expect(text).toContain('Mine a');
    expect(text).toContain('Mine b');
    expect(text).toContain(en('todaysTasks')); // ONE section: the parent's tasks and the child's own together, parent's first
    expect(text).not.toContain(en('atTitle'));
    expect(text.indexOf('From my parent task')).toBeLessThan(text.indexOf('Mine a'));
    expect(text).not.toContain(en('addButton'));
    expect((await app.dump()).get(scoped(ids.Billy, 'tasks'))).toBe(before); // nothing of the personal list was changed
    // personal and assigned tasks are separate records: the assigned one is not in the personal list
    expect(JSON.parse((await app.AsyncStorage.getItem(scoped(ids.Billy, 'tasks')))!).map((t: { id: string }) => t.id)).toEqual(['a', 'b']);
  });

  test('a child with nothing assigned sees no such section; Main sees none and keeps its Add button and its own tasks', async () => {
    const { app, ids } = await boot();
    await assign(ids.Sarah, 'Not for Billy', 'gym');
    await app.AsyncStorage.setItem(`${P}tasks`, JSON.stringify([personal('m1')]));
    const Screen = TasksScreen();
    await app.profiles.switchProfile(ids.Billy);
    await RNTL.render(<Screen />);
    await settle();
    expect(words()).not.toContain(en('atTitle'));
    expect(words()).not.toContain('Not for Billy');
    await RNTL.cleanup();
    await app.profiles.switchProfile('main');
    await RNTL.render(<Screen />);
    await settle();
    expect(words()).not.toContain(en('atTitle'));
    expect(words()).not.toContain('Not for Billy');
    expect(words()).toContain(en('addButton')); // the adult can still create tasks
    expect(words()).toContain('Mine m1');
  });

  test('the same screen in Spanish', async () => {
    const { app, ids } = await boot('es');
    await assign(ids.Billy, 'Hacer la cama', 'bedroom');
    await app.profiles.switchProfile(ids.Billy);
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    expect(words()).toContain(es('todaysTasks'));
    expect(words()).toContain(es('atParentRoomLine', { room: 'Dormitorio' }));
    expect(words()).toContain(es('atToDo'));
    expect(RNTL.screen.getByRole('button', { name: es('atDoneFor', { task: 'Hacer la cama' }) })).toBeTruthy();
  });
});

describe('actions from every view, all in step', () => {
  async function everyView(app: App, ids: Record<string, string>) {
    await app.profiles.switchProfile(ids.Billy);
    const Screen = TasksScreen();
    const { AssignedRoomTasks, AssignedHomeRows } = views();
    await RNTL.render(
      <>
        <Screen />
        <AssignedRoomTasks room="gym" />
        <AssignedHomeRows />
      </>
    );
    await settle();
  }
  const buttons = (task: string, kind: 'atDoneFor' | 'atUndoFor') => RNTL.screen.queryAllByRole('button', { name: en(kind, { task }) });

  test('handing in from the Tasks tab updates the room section, the Home card counts and the household at once; Undo from the room reverses it everywhere', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Stretch for a minute', 'gym');
    await assign(ids.Billy, 'Another gym task', 'gym');
    await everyView(app, ids);
    // three views of the same task: the Tasks tab, the Gym section, and (as a count) Home's card
    expect(buttons('Stretch for a minute', 'atDoneFor')).toHaveLength(2); // Tasks tab + Gym section
    expect(words()).toContain(en('atFromParentRoom', { room: 'Gym' })); // Home's guide
    await RNTL.fireEvent.press(buttons('Stretch for a minute', 'atDoneFor')[0]); // from the Tasks tab
    await settle();
    expect(buttons('Stretch for a minute', 'atDoneFor')).toHaveLength(0);
    expect(buttons('Stretch for a minute', 'atUndoFor')).toHaveLength(2); // both views now show Undo
    expect(words()).toContain(en('atFromParentRoom', { room: 'Gym' })); // Home's guide: one task is still to do
    expect(task(ids.Billy, id).status).toBe('pending'); // the parent's approval list sees it
    expect(H().tasksByStatus(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!).pending.map((t) => t.id)).toEqual([id]);
    await RNTL.fireEvent.press(buttons('Stretch for a minute', 'atUndoFor')[1]); // undo from the room section
    await settle();
    expect(buttons('Stretch for a minute', 'atDoneFor')).toHaveLength(2);
    expect(buttons('Stretch for a minute', 'atUndoFor')).toHaveLength(0);
    expect(task(ids.Billy, id).status).toBe('assigned');
    expect(H().tasksByStatus(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!).pending).toEqual([]);
  });

  test('an "Anywhere" task can be handed in and undone from the Tasks tab and from Home\'s card', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Water the plants');
    await everyView(app, ids);
    expect(words()).toContain(en('atFromParent')); // Home's guide
    expect(buttons('Water the plants', 'atDoneFor')).toHaveLength(1); // only the Tasks tab has the button
    await RNTL.fireEvent.press(buttons('Water the plants', 'atDoneFor')[0]);
    await settle();
    expect(buttons('Water the plants', 'atUndoFor')).toHaveLength(1);
    await RNTL.fireEvent.press(buttons('Water the plants', 'atUndoFor')[0]);
    await settle();
    expect(buttons('Water the plants', 'atDoneFor')).toHaveLength(1);
    expect(task(ids.Billy, id).status).toBe('assigned');
  });

  test('when the parent approves, the task disappears from every active list at once, and nothing was paid', async () => {
    const { app, ids } = await boot();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tokenEarnings'), JSON.stringify({ startedAt: '2026-03-01T00:00:00.000Z', events: [] }));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify([personal('keep', { completed: true, completedAt: '2026-03-10T16:00:00.000Z' })]));
    const id = await assign(ids.Billy, 'Finish me', 'gym');
    await flush();
    const before = new Map((await app.dump()).entries());
    await everyView(app, ids);
    await RNTL.fireEvent.press(buttons('Finish me', 'atDoneFor')[0]);
    await settle();
    await RNTL.act(async () => {
      await app.gate.unlockParentArea(TEST_PIN);
      await H().approveTask(ids.Billy, id);
    });
    await settle();
    expect(words()).not.toContain('Finish me');
    expect(words()).not.toContain(en('atTitle'));
    expect(labels().filter((l) => /^(I did it|Undo): /.test(l))).toEqual([]);
    const after = await app.dump();
    for (const key of [scoped(ids.Billy, 'tokenEarnings'), scoped(ids.Billy, 'tasks')]) expect([key, after.get(key)]).toEqual([key, before.get(key)]);
    expect([...after.keys()].filter((key) => /awardedTaskTokens|petFamily/.test(key) && !before.has(key))).toEqual([]); // no payout record
    expect(await app.history.getTokenHistory()).toMatchObject({ events: [] });
    expect(app.tasks.getCompletedTaskCount(await app.taskStorage.getCachedTasks())).toBe(1); // personal statistics did not move
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks).toHaveLength(1); // still the one record
  });

  test('a change made somewhere else (the parent sends it back) shows up in the views that are open', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Try again soon', 'gym');
    await app.profiles.switchProfile(ids.Billy);
    await A().submitAssignedTask(id);
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    expect(words()).toContain(en('atWaiting'));
    await RNTL.act(async () => {
      await app.gate.unlockParentArea(TEST_PIN);
      await H().sendTaskBack(ids.Billy, id);
    });
    await settle();
    expect(words()).toContain(en('atSentBack'));
    expect(words()).not.toContain(en('atWaiting'));
  });
});

describe('who can see or use these tasks', () => {
  test('another child, Main, an archived child and an unknown profile get nothing from the reader, and cannot hand in or undo', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Billy\'s task', 'gym');
    await H().markTaskDone(ids.Billy, id);
    const household = H().peekHousehold();
    for (const profile of [ids.Sarah, 'main', 'stranger']) expect(A().assignedTasksFor(household, profile)).toEqual([]);
    await app.profiles.switchProfile(ids.Sarah);
    const before = JSON.stringify(H().peekHousehold());
    expect(await A().submitAssignedTask(id)).toBe('not-yours');
    expect(await A().undoAssignedTask(id)).toBe('not-yours');
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
    expect(await H().setChildArchived(ids.Billy, true)).toMatchObject({ ok: true });
    expect(A().assignedTasksFor(H().peekHousehold(), ids.Billy)).toEqual([]);
    expect(task(ids.Billy, id).status).toBe('pending'); // archived: hidden, nothing lost
  });

  test('child task creation stays blocked, and Main can still create tasks', async () => {
    const { app, ids } = await boot();
    const storage = require('@/utils/task-storage') as typeof import('@/utils/task-storage');
    await app.profiles.switchProfile(ids.Billy);
    const loaded = await storage.getCachedTasks();
    storage.persistCachedTasks([...loaded, personal('sneaky') as never]);
    await flush();
    expect(await app.AsyncStorage.getItem(scoped(ids.Billy, 'tasks'))).toMatch(/^\[\]$|^null$/);
    await app.profiles.switchProfile('main');
    const mainLoaded = await storage.getCachedTasks();
    storage.persistCachedTasks([...mainLoaded, personal('adult') as never]);
    await flush();
    expect(JSON.parse((await app.AsyncStorage.getItem(`${P}tasks`))!).map((t: { id: string }) => t.id)).toEqual(['adult']);
  });

  test('the new section reads only through the per-child reader and writes only through the existing household functions (source check)', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8').replace(/\/\/.*$/gm, '');
    const component = read('src/components/assigned-task-views.tsx');
    expect(component).not.toMatch(/@\/utils\/household'|AsyncStorage|task-storage|paw-tokens|persistCachedTasks/);
    expect(read('src/app/tasks.tsx')).toMatch(/<AssignedAllTasks /);
    expect(read('src/app/tasks.tsx')).not.toMatch(/@\/utils\/household'/);
  });
});
