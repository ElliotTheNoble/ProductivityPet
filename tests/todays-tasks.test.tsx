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
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/tasks', useLocalSearchParams: () => ({}), Link: 'Link' }));

// A child's Home "Today's Tasks" card and Tasks tab: ONE list of the parent's tasks and the child's own, no empty sections, a legend only for what
// is shown. Main (and anyone who is not a child of the household) keeps both screens exactly as they were.
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
const views = () => require('@/components/assigned-task-views') as typeof import('@/components/assigned-task-views');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: `Mine ${id}`, category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: false, ...extra });
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');

async function boot(language: 'en' | 'es' = 'en') {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app: App = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const added = await H().addChild('Billy');
  if (!added.ok || !added.id) throw new Error('child not added');
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  i18n().setCurrentLanguage(language);
  return { app, billy: added.id };
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
const count = (text: string, part: string) => text.split(part).length - 1;
const TasksScreen = () => (require('@/app/tasks') as typeof import('@/app/tasks')).default;

describe('the child\'s Tasks tab', () => {
  async function child(language: 'en' | 'es' = 'en') {
    const { app, billy } = await boot(language);
    await assign(billy, 'Do ten jumping jacks', 'gym');
    await assign(billy, 'Water the plants');
    await app.AsyncStorage.setItem(scoped(billy, 'tasks'), JSON.stringify([item('a'), item('b', { completed: true, completedAt: '2026-03-10T16:00:00.000Z' })]));
    await app.profiles.switchProfile(billy);
    return { app, billy };
  }

  test('ONE "Today\'s Tasks" section: the parent\'s tasks and the child\'s own together, each once, with their statuses', async () => {
    await child();
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    const text = words();
    expect(count(text, en('todaysTasks'))).toBe(1);
    expect(text).not.toContain(en('atTitle')); // no separate "Tasks from my parent" section
    expect(text).not.toMatch(new RegExp(` \\| ${en('sectionTasks')} \\| `)); // and no second "Tasks" section
    for (const title of ['Do ten jumping jacks', 'Water the plants', 'Mine a', 'Mine b']) expect(count(text, title)).toBe(1);
    expect(text).toContain(en('atToDo'));
    expect(text.indexOf('Do ten jumping jacks')).toBeLessThan(text.indexOf('Mine a'));
    expect(text).not.toContain(en('emptyTasksDay'));
    expect(text).toContain('March 10, 2026'); // the date stays visible
  });

  test('"No tasks for this day" does not appear when a parent task exists, and does when there is nothing at all', async () => {
    const { app, billy } = await boot();
    await app.profiles.switchProfile(billy);
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    expect(words()).toContain(en('emptyTasksDay')); // nothing assigned, nothing of their own: said once
    await RNTL.cleanup();
    await app.profiles.switchProfile('main');
    await assign(billy, 'Now there is one');
    await app.profiles.switchProfile(billy);
    await RNTL.render(<Screen />);
    await settle();
    expect(words()).not.toContain(en('emptyTasksDay'));
  });

  test('empty Appointments and Birthdays sections, the intro and unused legend entries are hidden; nothing is deleted', async () => {
    const { app, billy } = await child();
    const before = await app.AsyncStorage.getItem(scoped(billy, 'tasks'));
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    const text = words();
    expect(text).not.toContain(en('sectionAppointments'));
    expect(text).not.toContain(en('emptyAppointmentsDay'));
    expect(text).not.toContain(en('sectionBirthdays'));
    expect(text).not.toContain(en('emptyBirthdaysDay'));
    expect(text).not.toContain(en('tasksIntro'));
    for (const key of ['legendHoliday', 'legendAppointment', 'legendBirthday', 'legendImportant']) expect(text).not.toContain(en(key));
    expect(text).toContain(en('legendTask')); // the child's tasks this month have a (green) dot, so that one is explained
    expect(await app.AsyncStorage.getItem(scoped(billy, 'tasks'))).toBe(before); // hiding only: every record is still saved
  });

  test('a section with something in it is shown (an appointment and a birthday), with the legend entries they need', async () => {
    const { app, billy } = await boot();
    await app.AsyncStorage.setItem(
      scoped(billy, 'tasks'),
      JSON.stringify([item('appt', { kind: 'event', text: 'Dentist', time: '3:00 PM' }), item('bday', { kind: 'birthday', text: 'Grandma' }), item('imp', { important: true })])
    );
    await assign(billy, 'Parent task');
    await app.profiles.switchProfile(billy);
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    const text = words();
    expect(text).toContain(en('sectionAppointments'));
    expect(text).toContain('Dentist');
    expect(text).toContain(en('sectionBirthdays'));
    expect(text).toContain('Grandma');
    for (const key of ['legendAppointment', 'legendBirthday', 'legendImportant']) expect(text).toContain(en(key));
  });

  test('"I did it!" and Undo still work from the new section; the status follows', async () => {
    const { billy } = await child();
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atDoneFor', { task: 'Water the plants' }) }));
    await settle();
    expect(words()).toContain(en('atWaiting'));
    expect(H().peekHousehold()!.children.find((c) => c.id === billy)!.tasks.find((t) => t.text === 'Water the plants')!.status).toBe('pending');
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atUndoFor', { task: 'Water the plants' }) }));
    await settle();
    expect(H().peekHousehold()!.children.find((c) => c.id === billy)!.tasks.find((t) => t.text === 'Water the plants')!.status).toBe('assigned');
  });

  test('Spanish', async () => {
    await child('es');
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    expect(words()).toContain(es('todaysTasks'));
    expect(words()).not.toContain(es('sectionAppointments'));
  });

  test('Main keeps the screen as it was: intro, every legend entry, empty sections, a plain "Tasks" section, Add button', async () => {
    const { app } = await boot();
    await app.AsyncStorage.setItem(`${P}tasks`, JSON.stringify([item('m1')]));
    await app.profiles.switchProfile('main');
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    const text = words();
    expect(text).toContain(en('tasksIntro'));
    for (const key of ['legendHoliday', 'legendAppointment', 'legendBirthday', 'legendImportant', 'legendTask']) expect(text).toContain(en(key));
    expect(text).toContain(en('sectionAppointments'));
    expect(text).toContain(en('emptyAppointmentsDay'));
    expect(text).toContain(en('sectionBirthdays'));
    expect(text).toContain(en('emptyBirthdaysDay'));
    expect(text).toContain(en('sectionTasks'));
    expect(text).not.toContain(en('todaysTasks'));
    expect(text).toContain(en('addButton'));
    expect(text).toContain('Mine m1');
  });
});

describe('Home: ONE "Today\'s Tasks" card', () => {
  async function card(setup: (billy: string) => Promise<void>, personal: Record<string, unknown>[] = [], profile: 'child' | 'main' = 'child') {
    const { app, billy } = await boot();
    await setup(billy);
    await app.profiles.switchProfile(profile === 'child' ? billy : 'main');
    const { TaskCard } = require('@/components/task-card') as typeof import('@/components/task-card');
    const A = require('@/utils/assigned-tasks') as typeof import('@/utils/assigned-tasks');
    const { AssignedHomeRows } = views();
    function Home() {
      const assigned = A.useAssignedTasks();
      const noop = () => undefined;
      return (
        <TaskCard
          tasks={personal as never}
          dateLabel="Tuesday, March 10, 2026"
          onToggleTask={noop}
          onToggleImportant={noop}
          onDeleteTask={noop}
          onStopRepeating={noop}
          onRemoveToday={noop}
          isCelebrating={false}
          assignedRows={assigned.length > 0 ? <AssignedHomeRows /> : undefined}
          assignedTotal={assigned.length}
          assignedOutstanding={assigned.filter(A.isOutstanding).length}
        />
      );
    }
    await RNTL.render(<Home />);
    await settle();
    return { app, billy };
  }

  test('parent-assigned and personal tasks in the same card, one title, each task once; "no tasks" is never shown beside a parent task', async () => {
    await card(
      async (billy) => {
        await assign(billy, 'Do ten jumping jacks', 'gym');
        await assign(billy, 'Water the plants');
      },
      [item('a')]
    );
    const text = words();
    expect(count(text, en('todaysTasks'))).toBe(1);
    expect(text).not.toContain(en('atTitle'));
    for (const title of ['Do ten jumping jacks', 'Water the plants', 'Mine a']) expect(count(text, title)).toBe(1);
    expect(text).toContain(en('atFromParentRoom', { room: 'Gym' }));
    expect(text).toContain(en('atFromParent'));
    expect(text).not.toContain(en('noTasksToday'));
    expect(text).toContain('Tuesday, March 10, 2026');
  });

  test('only a parent task: still no "No tasks"; the count excludes waiting tasks and counts the child\'s unfinished own tasks', async () => {
    await card(
      async (billy) => {
        await assign(billy, 'Todo one', 'gym');
        await assign(billy, 'Todo two', 'gym');
        await H().markTaskDone(billy, await assign(billy, 'Handed in', 'gym'));
      },
      []
    );
    expect(words()).not.toContain(en('noTasksToday'));
    expect(words()).toContain(en('atOutstanding_other', { count: 2 })); // 2 to do; the waiting one is not counted but is listed
    expect(words()).toContain('Handed in');
    expect(words()).toContain(en('atWaiting'));
    await RNTL.cleanup();
    await card(async (billy) => {
      await assign(billy, 'Todo one', 'gym');
    }, [item('open'), item('done', { completed: true })]);
    expect(words()).toContain(en('atOutstanding_other', { count: 2 })); // 1 assigned to do + 1 own task not done; the finished own task is not counted
  });

  test('nothing assigned (or Main): the card is exactly the old one', async () => {
    await card(async () => undefined, [item('a')]);
    expect(words()).toContain(en('todaysTasks'));
    expect(words()).toContain('Mine a');
    expect(words()).toMatch(/0% complete|% complete/);
    await RNTL.cleanup();
    await card(async () => undefined, []);
    expect(words()).toContain(en('noTasksToday'));
    await RNTL.cleanup();
    await card(async (billy) => { await assign(billy, 'Not for Main', 'gym'); }, [], 'main');
    expect(words()).not.toContain('Not for Main');
    expect(words()).toContain(en('noTasksToday'));
  });

  test('wiring (source check): Home no longer renders a second "Tasks from my parent" card; only a child\'s screens change', () => {
    const home = read('src/app/index.tsx');
    expect(home).not.toMatch(/AssignedHomeCard/);
    expect(home).toMatch(/assignedRows=\{assignedTasks\.length > 0 \? <AssignedHomeRows \/> : undefined\}/);
    const tasks = read('src/app/tasks.tsx');
    expect(tasks).toMatch(/const isChild = useIsChildProfile\(\)/);
    expect(tasks).toMatch(/isChild && dayEvents\.length === 0 \? null/);
    expect(tasks).toMatch(/isChild && dayBirthdays\.length === 0 \? null/);
  });
});
