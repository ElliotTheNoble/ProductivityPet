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
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/', useLocalSearchParams: () => ({}), Link: 'Link' }));

// Home Features: the parent's tasks grouped by room: ONE rounded card per room with "Room (N tasks)" on top and each task with its own state.
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
const flat = (el: { props: { style?: unknown } }) => (ReactNative.StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;
const enter = async (app: App, id: string) => expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
const inGroup = (key: string) => RNTL.within(RNTL.screen.getByTestId(`assigned-group-${key}`));

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
  const r = await H().addTask(childId, text, 'parent', room as never);
  if (!r.ok || !r.id) throw new Error('not assigned');
  return r.id;
};
async function homeRows(app: App, childId: string) {
  await enter(app, childId);
  const { AssignedHomeRows } = views();
  await RNTL.render(<AssignedHomeRows />);
  await settle();
}

describe('one rounded card per room', () => {
  test('Billy\'s example: Kitchen (2 tasks) with both, Study Room (1 task) with its one; each task shows its own state', async () => {
    const { app, ids } = await boot();
    const dogs = await assign(ids.Billy, 'Feed the dogs', 'kitchen');
    const book = await assign(ids.Billy, 'Read a book', 'study-room');
    const plants = await assign(ids.Billy, 'Water the plants', 'kitchen');
    await enter(app, ids.Billy);
    for (const id of [dogs, book, plants]) await A().submitAssignedTask(id);
    await RNTL.cleanup();
    await homeRows(app, ids.Billy);
    expect(RNTL.screen.getByText('Kitchen (2 tasks)')).toBeTruthy();
    expect(RNTL.screen.getByText('Study Room (1 task)')).toBeTruthy();
    const kitchen = inGroup('kitchen');
    expect(kitchen.getByText('Feed the dogs')).toBeTruthy();
    expect(kitchen.getByText('Water the plants')).toBeTruthy();
    expect(kitchen.queryByText('Read a book')).toBeNull();
    expect(kitchen.getAllByText(en('atWaiting'))).toHaveLength(2);
    const study = inGroup('study-room');
    expect(study.getByText('Read a book')).toBeTruthy();
    expect(study.getAllByText(en('atWaiting'))).toHaveLength(1);
    // one card per room, nothing more
    expect(RNTL.screen.queryByTestId('assigned-group-gym')).toBeNull();
    expect(RNTL.screen.getByTestId('assigned-group-kitchen')).toBeTruthy();
  });

  test('every room can have its own card, and "Anywhere" tasks are a group of their own; groups follow the order the tasks were assigned', async () => {
    const { app, ids } = await boot();
    const rooms = ['study-room', 'gym', 'bedroom', 'kitchen', 'bathroom'];
    for (const room of rooms) await assign(ids.Billy, `Task in ${room}`, room);
    await assign(ids.Billy, 'Anywhere one');
    await assign(ids.Billy, 'Anywhere two');
    await assign(ids.Billy, 'Second gym task', 'gym');
    await homeRows(app, ids.Billy);
    const names: Record<string, string> = { 'study-room': 'Study Room', gym: 'Gym', bedroom: 'Bedroom', kitchen: 'Kitchen', bathroom: 'Bathroom' };
    for (const room of rooms) expect(RNTL.screen.getByTestId(`assigned-group-${room}`)).toBeTruthy();
    expect(RNTL.screen.getByText('Gym (2 tasks)')).toBeTruthy();
    expect(RNTL.screen.getByText('Anywhere (2 tasks)')).toBeTruthy();
    expect(inGroup('anywhere').getByText('Anywhere one')).toBeTruthy();
    expect(inGroup('anywhere').getByText('Anywhere two')).toBeTruthy();
    expect(RNTL.screen.getByText(`${names['study-room']} (1 task)`)).toBeTruthy();
    const titles = RNTL.screen.getAllByTestId(/^assigned-group-title-/).map((n) => n.props.testID);
    expect(titles).toEqual(['assigned-group-title-study-room', 'assigned-group-title-gym', 'assigned-group-title-bedroom', 'assigned-group-title-kitchen', 'assigned-group-title-bathroom', 'assigned-group-title-anywhere']);
  });

  test('each task keeps its own state in the group: To do, Try again, Waiting', async () => {
    const { app, ids } = await boot();
    const a = await assign(ids.Billy, 'Fresh', 'kitchen');
    const b = await assign(ids.Billy, 'Again', 'kitchen');
    const c = await assign(ids.Billy, 'Handed in', 'kitchen');
    await H().markTaskDone(ids.Billy, b);
    await H().sendTaskBack(ids.Billy, b);
    await H().markTaskDone(ids.Billy, c);
    await homeRows(app, ids.Billy);
    const rows = RNTL.screen.getAllByTestId(/^assigned-home-/);
    const stateOf = (id: string) => RNTL.within(RNTL.screen.getByTestId(`assigned-home-${id}`));
    expect(stateOf(a).getByText(en('atToDo'))).toBeTruthy();
    expect(stateOf(b).getByText(en('atSentBack'))).toBeTruthy();
    expect(stateOf(c).getByText(en('atWaiting'))).toBeTruthy();
    expect(rows).toHaveLength(3);
  });
});

describe('it follows the tasks, and the tasks are untouched', () => {
  test('assigned, handed in, sent back, approved and deleted: the cards, their counts and their states update at once', async () => {
    const { app, ids } = await boot();
    await enter(app, ids.Billy);
    const { AssignedHomeRows } = views();
    await RNTL.render(<AssignedHomeRows />);
    await settle();
    expect(RNTL.screen.queryByTestId('assigned-group-kitchen')).toBeNull(); // nothing assigned: nothing drawn
    let one = '';
    let two = '';
    await RNTL.act(async () => {
      await enter(app, 'main');
      await app.gate.unlockParentArea(TEST_PIN);
      one = await assign(ids.Billy, 'One', 'kitchen');
      two = await assign(ids.Billy, 'Two', 'kitchen');
      await enter(app, ids.Billy);
    });
    await settle();
    expect(RNTL.screen.getByText('Kitchen (2 tasks)')).toBeTruthy(); // assigned
    await RNTL.act(async () => {
      await A().submitAssignedTask(one);
    });
    expect(inGroup('kitchen').getAllByText(en('atWaiting'))).toHaveLength(1); // handed in
    await RNTL.act(async () => {
      await enter(app, 'main');
      await app.gate.unlockParentArea(TEST_PIN);
      await H().sendTaskBack(ids.Billy, one);
      await enter(app, ids.Billy);
    });
    expect(inGroup('kitchen').getByTestId(`assigned-home-${one}`)).toBeTruthy();
    expect(RNTL.within(RNTL.screen.getByTestId(`assigned-home-${one}`)).getByText(en('atSentBack'))).toBeTruthy(); // sent back
    await RNTL.act(async () => {
      await A().submitAssignedTask(one);
      await enter(app, 'main');
      await app.gate.unlockParentArea(TEST_PIN);
      await H().approveTask(ids.Billy, one);
      await enter(app, ids.Billy);
    });
    expect(RNTL.screen.getByText('Kitchen (1 task)')).toBeTruthy(); // approved: it leaves the card
    await RNTL.act(async () => {
      await enter(app, 'main');
      await app.gate.unlockParentArea(TEST_PIN);
      await H().deleteTask(ids.Billy, two);
      await enter(app, ids.Billy);
    });
    expect(RNTL.screen.queryByTestId('assigned-group-kitchen')).toBeNull(); // deleted: the empty card is gone
  });

  test('grouping is only how the list is drawn: every task is still its own record, saved exactly as before', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'Feed the dogs', 'kitchen');
    await assign(ids.Billy, 'Water the plants', 'kitchen');
    const before = JSON.stringify(H().peekHousehold());
    await homeRows(app, ids.Billy);
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
    const tasks = H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.room === 'kitchen' && typeof t.id === 'string')).toBe(true);
    expect(code('src/components/assigned-task-views.tsx')).not.toMatch(/addTask|approveTask|sendTaskBack|setRewardSettings|collectHouseholdRewards/);
  });

  test('Billy never sees Sarah\'s tasks, in a group or a count', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'Billy chore', 'kitchen');
    await assign(ids.Sarah, 'Sarah chore', 'kitchen');
    await assign(ids.Sarah, 'Sarah other', 'kitchen');
    await homeRows(app, ids.Billy);
    expect(RNTL.screen.getByText('Kitchen (1 task)')).toBeTruthy();
    expect(RNTL.screen.queryByText('Sarah chore')).toBeNull();
    expect(RNTL.screen.queryByText('Sarah other')).toBeNull();
    expect(inGroup('kitchen').getByText('Billy chore')).toBeTruthy();
    await RNTL.cleanup();
    await homeRows(app, ids.Sarah);
    expect(RNTL.screen.getByText('Kitchen (2 tasks)')).toBeTruthy();
    expect(RNTL.screen.queryByText('Billy chore')).toBeNull();
  });
});

describe('behaviour is kept, the actions stay where they were', () => {
  test('a tap on a room card\'s title or on one of its tasks opens that room (with a fresh focus); an Anywhere group opens the Tasks tab; no I did it! or Undo on Home', async () => {
    const { app, ids } = await boot();
    const dogs = await assign(ids.Billy, 'Feed the dogs', 'kitchen');
    await assign(ids.Billy, 'Water the plants', 'kitchen');
    await assign(ids.Billy, 'Anywhere task');
    await homeRows(app, ids.Billy);
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('assigned-group-title-kitchen'));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/rooms/[room]', params: { room: 'kitchen', focus: expect.any(String) } });
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`assigned-home-${dogs}`));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/rooms/[room]', params: { room: 'kitchen', focus: expect.any(String) } });
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('assigned-group-title-anywhere'));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/tasks', params: { focus: expect.any(String) } });
    expect(RNTL.screen.queryByRole('button', { name: new RegExp(`^(${en('atDoneFor', { task: '' }).split(':')[0]}|${en('atUndoFor', { task: '' }).split(':')[0]})`) })).toBeNull();
    // the real actions are unchanged: in the room (and the Tasks tab) the same task still has its button
    await RNTL.cleanup();
    const { AssignedRoomTasks } = views();
    await RNTL.render(<AssignedRoomTasks room="kitchen" />);
    await settle();
    expect(RNTL.screen.getByRole('button', { name: en('atDoneFor', { task: 'Feed the dogs' }) })).toBeTruthy();
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atDoneFor', { task: 'Feed the dogs' }) }));
    await settle();
    expect(RNTL.screen.getByRole('button', { name: en('atUndoFor', { task: 'Feed the dogs' }) })).toBeTruthy();
  });

  test('accessibility: the title is a named button with the count, each task keeps its spoken name (task, state, where) and a hint', async () => {
    const { app, ids } = await boot();
    const dogs = await assign(ids.Billy, 'Feed the dogs', 'kitchen');
    await assign(ids.Billy, 'Water the plants', 'kitchen');
    await homeRows(app, ids.Billy);
    const title = RNTL.screen.getByTestId('assigned-group-title-kitchen');
    expect(title.props.accessibilityRole).toBe('button');
    expect(title.props.accessibilityLabel).toBe('Kitchen (2 tasks)');
    expect(title.props.accessibilityHint).toBe(en('atOpenRoom', { room: 'Kitchen' }));
    const row = RNTL.screen.getByTestId(`assigned-home-${dogs}`);
    expect(row.props.accessibilityLabel).toBe(en('atHomeRowLabel', { task: 'Feed the dogs', state: en('atToDo'), from: en('atFromParentRoom', { room: 'Kitchen' }) }));
    // controls are siblings, never nested: the title is not inside a task and no task is inside the title
    const inside = (node: { parent: unknown }, target: unknown): boolean => {
      for (let n = node as { parent: unknown } | null; n; n = n.parent as { parent: unknown } | null) if (n === target) return true;
      return false;
    };
    expect(inside(row as never, title)).toBe(false);
    expect(inside(title as never, row)).toBe(false);
  });
});

describe('narrow screens and Spanish', () => {
  test('a long task name wraps inside its card (two lines at most) next to a status that wraps under it; the card is a pastel rounded box that never spills', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'Feed all of the dogs and the puppies and also put fresh water in every one of the bowls', 'kitchen');
    await homeRows(app, ids.Billy);
    const card = flat(RNTL.screen.getByTestId('assigned-group-kitchen'));
    expect(card.borderRadius).toBeGreaterThan(8);
    expect(card.backgroundColor).toBe('#FFF4E3'); // the pastel
    const row = flat(RNTL.screen.getAllByTestId(/^assigned-home-/)[0]);
    expect(row.flexWrap).toBe('wrap');
    const title = RNTL.screen.getByText(/Feed all of the dogs/);
    expect(title.props.numberOfLines).toBe(2);
    expect(flat(title).minWidth).toBe(110);
  });

  test('Spanish: "Cocina (2 tareas)" style titles and the Spanish states; plural and singular', async () => {
    const { app, ids } = await boot('es');
    await assign(ids.Billy, 'Dar de comer', 'kitchen');
    await assign(ids.Billy, 'Regar', 'kitchen');
    await assign(ids.Billy, 'Leer', 'study-room');
    await homeRows(app, ids.Billy);
    expect(RNTL.screen.getByText(es('atGroupTitle_other', { room: 'Cocina', count: 2 }))).toBeTruthy();
    const studyName = (require('@/utils/rooms') as typeof import('@/utils/rooms')).ROOMS['study-room'].name; // the room's own Spanish name
    expect(RNTL.screen.getByText(es('atGroupTitle_one', { room: studyName, count: 1 }))).toBeTruthy();
    expect(es('atGroupTitle_other', { room: 'Cocina', count: 2 })).toBe('Cocina (2 tareas)');
    expect(es('atGroupTitle_one', { room: 'X', count: 1 })).toBe('X (1 tarea)');
    expect(inGroup('kitchen').getAllByText(es('atToDo'))).toHaveLength(2);
  });
});
