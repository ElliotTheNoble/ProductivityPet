import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, configurePin, freezeClock, loadApp, unfreezeClock, type App } from './helpers';

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

// Step 4A on screen: the child's room panels, Home's right-hand tab (a small number and a quiet card), the three distinct states, handing a
// task in, and the parent's room choice. Counts come from one function, so the number on the tab, the rows in the card and the lists in the
// rooms can never disagree.
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/', Link: 'Link' }));

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => {
  freezeClock(T0);
  mockRouter.push.mockClear();
});
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const H = () => require('@/utils/household') as typeof import('@/utils/household');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 25; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });

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
const views = () => require('@/components/assigned-task-views') as typeof import('@/components/assigned-task-views');

describe('inside a room', () => {
  test('a room shows only its own assigned tasks, each with a clearly different state; nothing when the room has none', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'Do ten jumping jacks', 'gym');
    const back = await assign(ids.Billy, 'Stretch your arms', 'gym');
    const wait = await assign(ids.Billy, 'Hold a plank', 'gym');
    await assign(ids.Billy, 'Make the bed', 'bedroom');
    await H().markTaskDone(ids.Billy, back);
    await H().sendTaskBack(ids.Billy, back);
    await H().markTaskDone(ids.Billy, wait);
    await app.profiles.switchProfile(ids.Billy);
    const { AssignedRoomTasks } = views();
    await RNTL.render(<AssignedRoomTasks room="gym" />);
    await settle();
    const text = words();
    expect(text).toContain(en('atTitle'));
    for (const task of ['Do ten jumping jacks', 'Stretch your arms', 'Hold a plank']) expect(text).toContain(task);
    expect(text).not.toContain('Make the bed'); // another room's task
    expect(text).toContain(en('atToDo'));
    expect(text).toContain(en('atSentBack'));
    expect(text).toContain(en('atWaiting'));
    // one button per task, in the same place: "I did it!" for the two that need the child, "Undo" for the one waiting for the parent
    expect(RNTL.screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).filter((l: string) => /^(I did it|Undo): /.test(l))).toEqual([
      en('atDoneFor', { task: 'Do ten jumping jacks' }),
      en('atDoneFor', { task: 'Stretch your arms' }),
      en('atUndoFor', { task: 'Hold a plank' }),
    ]);
    await RNTL.cleanup();
    await RNTL.render(<AssignedRoomTasks room="kitchen" />);
    await settle();
    expect(words()).toBe(''); // no tasks here: nothing at all
  });

  test('handing in: the row turns to "Waiting for my parent", the button goes away, and the household task is pending exactly once', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'Tidy the desk', 'study-room');
    await app.profiles.switchProfile(ids.Billy);
    const { AssignedRoomTasks } = views();
    await RNTL.render(<AssignedRoomTasks room="study-room" />);
    await settle();
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atDoneFor', { task: 'Tidy the desk' }) }));
    await settle();
    expect(words()).toContain(en('atWaiting'));
    // the same place now holds "Undo" (and only while the task is waiting)
    expect(RNTL.screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).filter((l: string) => /^(I did it|Undo): /.test(l))).toEqual([en('atUndoFor', { task: 'Tidy the desk' })]);
    const mine = H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks;
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe('pending');
  });

  test('in Spanish', async () => {
    const { app, ids } = await boot('es');
    await assign(ids.Billy, 'Hacer la cama', 'bedroom');
    await app.profiles.switchProfile(ids.Billy);
    const { AssignedRoomTasks } = views();
    await RNTL.render(<AssignedRoomTasks room="bedroom" />);
    await settle();
    expect(words()).toContain(es('atTitle'));
    expect(words()).toContain(es('atToDo'));
    expect(RNTL.screen.getByRole('button', { name: es('atDoneFor', { task: 'Hacer la cama' }) })).toBeTruthy();
  });

  test('the room panel shows the assigned section above the child\'s own list, and looks the same without one', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'Wash the dishes', 'kitchen');
    await app.profiles.switchProfile(ids.Billy);
    const { RoomTaskPanel } = require('@/components/room-task-panel') as typeof import('@/components/room-task-panel');
    const { AssignedRoomTasks } = views();
    const noop = () => undefined;
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 1000, height: 700, scale: 1, fontScale: 1 });
    await RNTL.render(<RoomTaskPanel roomName="kitchen" tasks={[]} onToggleTask={noop} onAddTask={noop} assignedSection={<AssignedRoomTasks room="kitchen" />} assignedCount={1} />);
    await settle();
    const text = words();
    expect(text).toContain('Wash the dishes');
    expect(text.indexOf(en('atTitle'))).toBeLessThan(text.indexOf(en('panelEmpty'))); // above the personal list
    await RNTL.cleanup();
    await RNTL.render(<RoomTaskPanel roomName="kitchen" tasks={[]} onToggleTask={noop} onAddTask={noop} />);
    await settle();
    expect(words()).not.toContain(en('atTitle'));
  });
});

describe('Home\'s right-hand tab', () => {
  test('the tab shows a small number (outstanding tasks only); nothing for zero; "9+" for many; the screen reader is told', async () => {
    await boot();
    const { SlideOutPanel } = require('@/components/slide-out-panel') as typeof import('@/components/slide-out-panel');
    const render = (badge: number | undefined) =>
      RNTL.render(
        <SlideOutPanel side="right" label="Home Features" icon="home" tint="#FBC9DB" panelBackground="#FFF1F6" panelWidth={300} open={false} badge={badge} badgeLabel="3 tasks" onOpen={() => undefined} onClose={() => undefined}>
          <ReactNative.Text>content</ReactNative.Text>
        </SlideOutPanel>
      );
    await render(3);
    expect(RNTL.screen.getByTestId('tab-badge', { hidden: true })).toBeTruthy();
    expect(RNTL.screen.getByText('3')).toBeTruthy();
    expect(RNTL.screen.getByLabelText(/3 tasks/, { hidden: true })).toBeTruthy();
    await RNTL.cleanup();
    await render(0);
    expect(RNTL.screen.queryByTestId('tab-badge', { hidden: true })).toBeNull();
    await RNTL.cleanup();
    await render(undefined);
    expect(RNTL.screen.queryByTestId('tab-badge', { hidden: true })).toBeNull();
    await RNTL.cleanup();
    await render(14);
    expect(RNTL.screen.getByText('9+')).toBeTruthy();
  });

  test('one compact row per task: title, where it is from, its status; waiting ones are shown differently', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'g1', 'gym');
    await assign(ids.Billy, 'g2', 'gym');
    const wait = await assign(ids.Billy, 'b1', 'bedroom');
    await assign(ids.Billy, 'Water the plants');
    await H().markTaskDone(ids.Billy, wait);
    await app.profiles.switchProfile(ids.Billy);
    const { AssignedHomeRows } = views();
    await RNTL.render(<AssignedHomeRows />);
    await settle();
    const text = words();
    for (const title of ['g1', 'g2', 'b1', 'Water the plants']) expect(text).toContain(title);
    expect(text).toContain(en('atFromParentRoom', { room: 'Gym' }));
    expect(text).toContain(en('atFromParentRoom', { room: 'Bedroom' })); // a room whose task is only waiting stays listed
    expect(text).not.toContain('Kitchen'); // no tasks there: not listed
    expect(text).toContain(en('atWaiting'));
    expect(text).not.toContain(en('atDone'));
    // tapping a room task opens its room (with a fresh "focus" so the task panel opens and lights up); an anywhere task opens the Tasks tab
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: /^g1,/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/rooms/[room]', params: { room: 'gym', focus: expect.any(String) } });
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: /^Water the plants,/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/tasks', params: { focus: expect.any(String) } });
  });

  test('nothing at all (no card, no number) for a child with no assigned tasks, for another child\'s tasks, and for Main', async () => {
    const { app, ids } = await boot();
    await assign(ids.Sarah, 'Only Sarah has this', 'gym');
    const { AssignedHomeRows } = views();
    await app.profiles.switchProfile(ids.Billy);
    await RNTL.render(<AssignedHomeRows />);
    await settle();
    expect(words()).toBe('');
    await RNTL.cleanup();
    await app.profiles.switchProfile('main');
    await RNTL.render(<AssignedHomeRows />);
    await settle();
    expect(words()).toBe('');
  });

  test('no pop-up of any kind: the new UI uses no modal, alert or toast', () => {
    const fs = require('fs');
    const code = fs.readFileSync(require('path').resolve('src/components/assigned-task-views.tsx'), 'utf8') as string;
    expect(code).not.toMatch(/Modal|Alert\.|Toast|ConfirmModal/);
  });

  test('the card and the numbers come from one function: the tab number equals the sum of the room counts', async () => {
    const { ids } = await boot();
    for (const room of ['gym', 'gym', 'bedroom', 'kitchen', 'study-room', 'bathroom']) await assign(ids.Billy, `t-${room}-${Math.random()}`, room);
    await assign(ids.Billy, 'any');
    const lib = require('@/utils/assigned-tasks') as typeof import('@/utils/assigned-tasks');
    const list = lib.assignedTasksFor(H().peekHousehold(), ids.Billy);
    expect(lib.outstandingTotal(list)).toBe(Object.values(lib.outstandingByRoom(list)).reduce((a, b) => a + b, 0));
    expect(lib.outstandingTotal(list)).toBe(7);
  });
});

describe('the parent chooses a room when assigning', () => {
  test('Family Settings: room buttons next to the task field; the chosen room is saved; the default is anywhere; the room shows in the list', async () => {
    const { app, ids } = await boot();
    await H().selectChild(ids.Billy);
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
    expect(RNTL.screen.getByText(en('atRoomPick'))).toBeTruthy();
    await RNTL.fireEvent.changeText(RNTL.screen.getAllByPlaceholderText(en('taskPlaceholder'))[0], 'Do some stretches');
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: `${en('atRoomPick')}: Gym` }));
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('assign') }));
    await settle();
    const tasks = H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks;
    expect(tasks.map((t) => [t.text, t.room])).toEqual([['Do some stretches', 'gym']]);
    expect(words()).toContain(`${en('createdByParent')} · ${en('atParentRoomLine', { room: 'Gym' })}`);
    // a second task with no room chosen: anywhere
    await RNTL.fireEvent.changeText(RNTL.screen.getAllByPlaceholderText(en('taskPlaceholder'))[0], 'Anywhere task');
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('assign') }));
    await settle();
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks.map((t) => t.room ?? null)).toEqual(['gym', null]);
    void app;
  });
});
