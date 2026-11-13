import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, TEST_PIN, configurePin, freezeClock, loadApp, unfreezeClock, type App } from './helpers';

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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), usePathname: () => '/rooms/kitchen', useLocalSearchParams: () => ({}), Link: 'Link' }));

// "No tasks yet! Let's add one!" invites someone to ADD a task. A child cannot add tasks (they play with the ones a parent assigns), and a room with
// assigned tasks in it (waiting ones included) is not empty, so the message was wrong in a child's room, for example right after Undo.
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
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const size = (width: number, height: number) => jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width, height, scale: 1, fontScale: 1 });
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
const enter = async (app: App, id: string) => expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
const ROOMS = ['study-room', 'gym', 'bedroom', 'bathroom', 'kitchen'] as const;

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
  const r = await H().addTask(childId, text, 'parent', room as never, { reward: 5 });
  if (!r.ok || !r.id) throw new Error('not assigned');
  return r.id;
};
// The room panel as the room screen draws it for a child: no way to add, the assigned section inside, hasAssigned from the assigned tasks.
function ChildPanel({ room, canAdd = false }: { room: (typeof ROOMS)[number]; canAdd?: boolean }) {
  const a = A();
  const { AssignedRoomTasks } = views();
  const { RoomTaskPanel } = require('@/components/room-task-panel') as typeof import('@/components/room-task-panel');
  const here = a.viewsForRoom(a.useAssignedTasks(), room);
  return (
    <RoomTaskPanel
      roomName={room}
      tasks={[]}
      onToggleTask={() => undefined}
      onAddTask={() => undefined}
      assignedSection={<AssignedRoomTasks room={room} />}
      assignedCount={here.filter(a.isOutstanding).length}
      hasAssigned={here.length > 0}
      canAdd={canAdd}
    />
  );
}
async function openPanel(room: (typeof ROOMS)[number], expand = true, canAdd = false) {
  size(1000, 700); // wide: the panel is always open
  await RNTL.render(<ChildPanel room={room} canAdd={canAdd} />);
  await settle();
  void expand;
}

describe('a child\'s room never shows "No tasks yet! Let\'s add one!"', () => {
  test.each(ROOMS)('%s: with assigned tasks (to do, waiting) and with nothing at all', async (room) => {
    const { app, ids } = await boot();
    const todo = await assign(ids.Billy, 'Do the thing', room);
    const waiting = await assign(ids.Billy, 'Handed in', room);
    await enter(app, ids.Billy);
    await A().submitAssignedTask(waiting);
    await openPanel(room);
    expect(words()).toContain('Do the thing');
    expect(words()).not.toContain(en('panelEmpty'));
    expect(words()).not.toMatch(/No tasks yet|add one/i);
    await RNTL.cleanup();
    // a child's room with nothing assigned at all: still no invitation to add (a child cannot add)
    await enter(app, ids.Sarah);
    await openPanel(room);
    expect(words()).not.toContain(en('panelEmpty'));
    expect(todo).toBeTruthy();
  });

  test('right after Undo (the case from the Samsung): the message does not appear, the task is back to To do, nothing else changed', async () => {
    const { app, ids } = await boot();
    const dogs = await assign(ids.Billy, 'Feed the dogs', 'kitchen');
    const plants = await assign(ids.Billy, 'Water the plants', 'kitchen');
    await enter(app, ids.Billy);
    await openPanel('kitchen');
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atDoneFor', { task: 'Feed the dogs' }) }));
    await settle();
    expect(RNTL.screen.getByRole('button', { name: en('atUndoFor', { task: 'Feed the dogs' }) })).toBeTruthy();
    expect(words()).not.toContain(en('panelEmpty'));
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atUndoFor', { task: 'Feed the dogs' }) }));
    await settle();
    expect(words()).not.toContain(en('panelEmpty')); // not after Undo either
    expect(words()).not.toMatch(/No tasks yet|add one/i);
    // back to To do, with its "I did it!" button; the other task and the saved records are as they were
    expect(RNTL.screen.getByRole('button', { name: en('atDoneFor', { task: 'Feed the dogs' }) })).toBeTruthy();
    const view = (id: string) => A().assignedTasksFor(H().peekHousehold(), ids.Billy).find((v) => v.id === id)!;
    expect(view(dogs).state).toBe('to-do');
    expect(view(plants).state).toBe('to-do');
    const saved = H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks;
    expect(saved.map((t) => [t.text, t.status, t.reward])).toEqual([['Feed the dogs', 'assigned', 5], ['Water the plants', 'assigned', 5]]);
    expect(saved.find((t) => t.id === dogs)!.submittedAt).toBeUndefined();
  });

  test('Undo of a task that had been sent back returns it to Try again (not to do), still without the message', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Again task', 'gym');
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await H().sendTaskBack(ids.Billy, id);
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    await openPanel('gym');
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atUndoFor', { task: 'Again task' }) }));
    await settle();
    expect(A().assignedTasksFor(H().peekHousehold(), ids.Billy)[0].state).toBe('sent-back');
    expect(words()).toContain(en('atSentBack'));
    expect(words()).not.toContain(en('panelEmpty'));
  });

  test('Spanish: the Spanish message is not shown either', async () => {
    const { app, ids } = await boot('es');
    await assign(ids.Billy, 'Tarea', 'kitchen');
    await enter(app, ids.Billy);
    await openPanel('kitchen');
    expect(words()).not.toContain(es('panelEmpty'));
  });
});

describe('the adult / Main room keeps its message where it is true', () => {
  test('someone who CAN add tasks, in a room with nothing: the invitation stays; as soon as assigned tasks are listed it goes', async () => {
    const { app } = await boot();
    await enter(app, 'main');
    await openPanel('kitchen', true, true);
    expect(words()).toContain(en('panelEmpty')); // Main: nothing here, and it can add
    await RNTL.cleanup();
    const { RoomTaskPanel } = require('@/components/room-task-panel') as typeof import('@/components/room-task-panel');
    await RNTL.render(<RoomTaskPanel roomName="kitchen" tasks={[]} onToggleTask={() => undefined} onAddTask={() => undefined} hasAssigned canAdd />);
    expect(words()).not.toContain(en('panelEmpty')); // not empty: assigned tasks are in the room
  });

  test('the personal task list of a room with tasks is untouched', async () => {
    const { RoomTaskPanel } = require('@/components/room-task-panel') as typeof import('@/components/room-task-panel');
    size(1000, 700);
    await boot();
    const task = { id: 't1', text: 'Own task', category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: false } as never;
    await RNTL.render(<RoomTaskPanel roomName="kitchen" tasks={[task]} onToggleTask={() => undefined} onAddTask={() => undefined} canAdd />);
    expect(words()).toContain('Own task');
    expect(words()).not.toContain(en('panelEmpty'));
  });

  test('wiring (source check): the room screen passes whether anything is assigned, and the message needs canAdd and an empty room', () => {
    expect(code('src/components/room-detail-screen.tsx')).toMatch(/hasAssigned=\{assignedHere\.length > 0\}/);
    expect(code('src/components/room-task-panel.tsx')).toMatch(/totalCount === 0 && canAdd && !hasAssigned/);
  });
});
