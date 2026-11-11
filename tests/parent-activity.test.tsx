import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, configurePin, freezeClock, iso, loadApp, pet, unfreezeClock, type App } from './helpers';

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

// What a parent sees for one child on the Parent Dashboard: the Tasks, Accomplishments and Activity history sections, from saved records only.
// "Today" is 2026-03-10 (the frozen test clock).
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    useRouter: () => mockRouter,
    usePathname: () => '/dashboard',
    Redirect: () => null,
    Slot: () => {
      const Page = require('@/app/dashboard').default;
      return R.createElement(Page);
    },
    ThemeProvider: ({ children }: { children: unknown }) => children,
    DarkTheme: {},
    DefaultTheme: {},
  };
});

const P = '@ProductivityPet:';
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;

beforeEach(() => {
  freezeClock(T0);
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
});
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const task = (over: Record<string, unknown>) => ({ id: `t${Math.random()}`, text: 'x', category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: false, ...over });
const tokenEvent = (id: string, dateISO: string, amount: number, source = 'task') => ({ id, at: `${dateISO}T15:00:00.000Z`, dateISO, amount, source });
const family = (pets: object[], pawTokens = 0) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens } });

async function boot(language: 'en' | 'es' = 'en') {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app: App = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const household = require('@/utils/household') as typeof import('@/utils/household');
  const ids: Record<string, string> = {};
  for (const name of ['Billy', 'Sarah']) {
    const added = await household.addChild(name);
    if (!added.ok || !added.id) throw new Error('child not added');
    ids[name] = added.id;
  }
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  (require('@/i18n') as typeof import('@/i18n')).setCurrentLanguage(language);
  return { app, ids, household };
}

async function seedBilly(app: App, ids: Record<string, string>) {
  await app.AsyncStorage.setItem(
    scoped(ids.Billy, 'tasks'),
    JSON.stringify([
      task({ id: 'a', text: 'Homework', date: '2026-03-10' }),
      task({ id: 'b', text: 'Tidy room', date: '2026-03-09' }),
      task({ id: 'c', text: 'Library book', date: '2026-03-15' }),
      task({ id: 'd', text: 'Read', date: '2026-03-02', completed: true, completedAt: '2026-03-02T16:00:00.000Z', important: true }),
      task({ id: 'e', text: 'Old chore', date: '2026-01-01', completed: true }),
      task({ id: 'f', text: 'Brush teeth', date: '2026-03-01', repeat: { kind: 'daily' }, completedDates: ['2026-03-05', '2026-03-09', '2026-03-10'] }),
      task({ id: 'g', text: 'Dentist', kind: 'event', date: '2026-03-12' }),
    ])
  );
  await app.AsyncStorage.setItem(
    scoped(ids.Billy, 'tokenEarnings'),
    JSON.stringify({ startedAt: '2026-03-05T15:00:00.000Z', events: [tokenEvent('e1', '2026-03-05', 3), tokenEvent('e2', '2026-03-09', 5, 'kitty-catch'), tokenEvent('e3', '2026-03-10', 2)] })
  );
  await app.AsyncStorage.setItem(scoped(ids.Billy, 'ownedShopItems'), JSON.stringify(['bow-1', 'hat-2']));
  await app.AsyncStorage.setItem(
    scoped(ids.Billy, 'petFamily'),
    family([pet({ id: 'p1', name: 'Biscuit', events: [{ id: 'adopted:1', type: 'adopted', at: '2026-01-05T15:00:00.000Z' }, { id: 'hatched:1', type: 'hatched', at: '2026-02-01T15:00:00.000Z' }] })], 17)
  );
}

const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 25; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const press = (name: string | RegExp) => RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name }));
const pressRadio = (name: string) => RNTL.fireEvent.press(RNTL.screen.getByRole('radio', { name }));

async function openChild(name: string, say: typeof en = en) {
  const { ShellChooser } = require('@/components/shell-chooser') as typeof import('@/components/shell-chooser');
  await RNTL.render(<ShellChooser renderGame={() => <ReactNative.Text>GAME</ReactNative.Text>} />);
  await settle();
  await RNTL.screen.findByText(name);
  await press(say('phOpenChild', { name }));
  await settle();
}

describe('a child with saved data', () => {
  test('Tasks: how things stand today, with every list and count taken from the saved tasks', async () => {
    const { app, ids } = await boot();
    await seedBilly(app, ids);
    await openChild('Billy');
    expect(RNTL.screen.getByText(en('paDueToday_one', { count: 1 }))).toBeTruthy();
    expect(RNTL.screen.getByText('Homework')).toBeTruthy();
    expect(RNTL.screen.getByText(en('paDoneToday', { count: 1 }))).toBeTruthy();
    expect(RNTL.screen.getByText(`${en('paUpcoming')} (1)`)).toBeTruthy();
    expect(RNTL.screen.getByText('Library book')).toBeTruthy();
    expect(RNTL.screen.getByText(`${en('paPastDue')} (1)`)).toBeTruthy();
    expect(RNTL.screen.getByText('Tidy room')).toBeTruthy();
    expect(RNTL.screen.getByText(en('paCompletedTotal_other', { count: 5 }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paCompletedImportant', { count: 1 }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paCompletedUndated_one', { count: 1 }))).toBeTruthy();
    expect(RNTL.screen.queryByText('Dentist')).toBeNull(); // an appointment is not a task
    expect(RNTL.screen.getByText(en('paRepeatingRunning_one', { count: 1 }))).toBeTruthy();
  });

  test('repeating tasks are an ESTIMATE, labelled as such, and never called missed history', async () => {
    const { app, ids } = await boot();
    await seedBilly(app, ids);
    await openChild('Billy');
    expect(RNTL.screen.getByText(en('paRepeating'))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paRepeatingNote', { days: 30 }))).toBeTruthy();
    expect(RNTL.screen.getByText('Brush teeth: Mar 1, Mar 2, Mar 3, Mar 4, Mar 6, Mar 7 +1')).toBeTruthy();
    const all = JSON.stringify(RNTL.screen.toJSON());
    expect(all).not.toMatch(/"missed"|Missed/); // the word is never used as a claim
    expect(en('paRepeating')).toMatch(/estimate/i);
    expect(en('paRepeatingNote', { days: 30 })).toMatch(/not verified history/i);
  });

  test('tasks assigned by the parent are in their own card, separate from the child\'s own', async () => {
    const { app, ids, household } = await boot();
    await seedBilly(app, ids);
    expect(await household.addTask(ids.Billy, 'Wash the car', 'parent')).toMatchObject({ ok: true });
    await openChild('Billy');
    expect(RNTL.screen.getByText(en('paAssignedTitle'))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paAssignedNote', { name: 'Billy' }))).toBeTruthy();
    expect(RNTL.screen.getByText(`${en('paAssignedToDo')} (1)`)).toBeTruthy();
    expect(RNTL.screen.getByText('Wash the car')).toBeTruthy();
    expect(RNTL.screen.getByText(en('paCompletedTotal_other', { count: 5 }))).toBeTruthy(); // still 5: not added to
  });

  test('Accomplishments: pet milestones, streak, Paw Tokens since tracking began (with that date), items owned', async () => {
    const { app, ids } = await boot();
    await seedBilly(app, ids);
    await openChild('Billy');
    expect(RNTL.screen.getByText(en('paMsHatched', { pet: 'Biscuit' }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paMsArrived', { pet: 'Biscuit' }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paDays_other', { count: 2 }))).toBeTruthy(); // day streak
    expect(RNTL.screen.getByText(en('paBest', { value: en('paDays_other', { count: 2 }) }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paTokensEarned', { count: 10, date: 'Mar 5, 2026' }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('thSrcKittyCatch'))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paTokensNow', { count: 17 }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paShopItems'))).toBeTruthy();
    expect(RNTL.screen.getByText('2')).toBeTruthy(); // shop items owned
  });

  test('Activity history: day, week, month and year from dated records; before token tracking began says so instead of showing zero', async () => {
    const { app, ids } = await boot();
    await seedBilly(app, ids);
    await openChild('Billy');
    const rows = () => RNTL.within(RNTL.screen.getByTestId(/^activity-/));
    // day (the default): today has one completion and 2 tokens; yesterday one completion and 5 tokens
    expect(RNTL.screen.getByTestId('activity-day')).toBeTruthy();
    expect(rows().getByText(en('paRowTokens', { count: 2 }))).toBeTruthy();
    expect(rows().getByText(en('paRowTokens', { count: 5 }))).toBeTruthy();
    expect(rows().getAllByText(en('paRowTasks_one', { count: 1 })).length).toBeGreaterThanOrEqual(2);
    expect(rows().getAllByText(en('paRowTokensBefore')).length).toBeGreaterThan(0); // Mar 4 and earlier: tracking had not begun
    expect(RNTL.screen.getByText(en('paActUndated_one', { count: 1 }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paActSince', { date: 'Jan 5, 2026' }))).toBeTruthy(); // the earliest thing recorded (the first pet's arrival): the history begins there
    await pressRadio(en('paPeriodWeek'));
    expect(RNTL.screen.getByTestId('activity-week')).toBeTruthy();
    expect(rows().getByText(en('paWeekOf', { date: 'Mar 8' }))).toBeTruthy(); // weeks start on Sunday
    await pressRadio(en('paPeriodMonth'));
    expect(rows().getByText('March 2026')).toBeTruthy();
    expect(rows().getByText(en('paRowTokensPartial', { count: 10 }))).toBeTruthy(); // tracking began during March
    await pressRadio(en('paPeriodYear'));
    expect(rows().getByText('2026')).toBeTruthy();
  });

  test('the choice of Day / Week / Month / Year is the only control; nothing can be edited', async () => {
    const { app, ids } = await boot();
    await seedBilly(app, ids);
    await openChild('Billy');
    const names = RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
    expect([...names].sort()).toEqual(['Switch player. Playing as Main.', en('phNavDashboard'), en('phSettings'), `‹ ${en('phBack')}`].sort());
    const radios = RNTL.screen.getAllByRole('radio').map((r) => String(r.props.accessibilityLabel));
    expect(radios).toEqual([en('paPeriodDay'), en('paPeriodWeek'), en('paPeriodMonth'), en('paPeriodYear')]);
    expect(RNTL.screen.queryByPlaceholderText(/./)).toBeNull();
  });
});

describe('what is not saved shows a plain empty state, never a made-up number', () => {
  test('a child who has not played: no tasks, no milestones, no tokens, "no history" for tokens in every period', async () => {
    const { ids } = await boot();
    void ids;
    await openChild('Sarah');
    expect(RNTL.screen.getByText(en('paTasksEmpty'))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paNoMilestones'))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paTokensNone'))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paAssignedEmpty', { name: 'Sarah' }))).toBeTruthy();
    // no tasks at all really is a streak of 0 days (and a best of 0 days)
    expect(RNTL.screen.getByText(en('paDays_other', { count: 0 }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('paBest', { value: en('paDays_other', { count: 0 }) }))).toBeTruthy();
    // the history has not begun: no period is listed, nothing before it is shown as tracked
    expect(RNTL.screen.getByText(en('paActNothing'))).toBeTruthy();
    expect(RNTL.screen.queryByText(en('paRowNone'))).toBeNull();
    expect(RNTL.screen.queryByText(en('paRowTokensBefore'))).toBeNull();
    expect(RNTL.screen.queryByText(/^Since /)).toBeNull();
    expect(RNTL.screen.queryByText(/\d+ tasks? completed in total/)).toBeNull();
    expect(RNTL.screen.queryByText(/earned since tracking began/)).toBeNull();
  });

  test('damaged records say they could not be read, and show nothing for that part', async () => {
    const { app, ids } = await boot();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), '{ not json');
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tokenEarnings'), '{ not json');
    await openChild('Billy');
    expect(RNTL.screen.getAllByText(en('paUnavailable')).length).toBeGreaterThanOrEqual(1); // the task list
    expect(RNTL.screen.getAllByText(en('paReadError')).length).toBeGreaterThanOrEqual(2); // the streak and the Paw Tokens: a short error, never a 0
    expect(RNTL.screen.queryByText(en('paDays_other', { count: 0 }))).toBeNull();
    expect(RNTL.screen.queryByText(/tasks? completed in total/)).toBeNull();
  });
});

describe('privacy, protection and Spanish', () => {
  test('no journal content, private or shared, and no mood record is read or shown', async () => {
    const { app, ids } = await boot();
    await seedBilly(app, ids);
    await app.AsyncStorage.setItem(
      scoped(ids.Billy, 'journal'),
      JSON.stringify([
        { id: 'a', dateISO: '2026-03-01', text: 'PRIVATE-WORDS', createdAt: iso(T0), updatedAt: iso(T0) },
        { id: 'b', dateISO: '2026-03-02', text: 'SHARED-WORDS', createdAt: iso(T0), updatedAt: iso(T0), visibility: 'shared' },
      ])
    );
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'moodLog'), JSON.stringify([{ id: 'm', mood: 'Happy', at: iso(T0), dateISO: '2026-03-10' }]));
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    getItem.mockClear();
    await openChild('Billy');
    const read = getItem.mock.calls.map(([key]) => String(key)); // before the dump below
    expect(read.filter((key) => /journal|moodLog|:mood$/.test(key))).toEqual([]);
    expect(JSON.stringify(RNTL.screen.toJSON())).not.toMatch(/PRIVATE-WORDS|SHARED-WORDS/);
  });

  test('viewing writes nothing and leaves every saved record byte for byte as it was (Main\'s and the children\'s)', async () => {
    const { app, ids } = await boot();
    await seedBilly(app, ids);
    await app.AsyncStorage.setItem(`${P}tasks`, JSON.stringify([task({ id: 'm', text: 'MAIN-TASK' })]));
    await app.AsyncStorage.setItem(`${P}petFamily`, family([pet({ id: 'mp', name: 'MainPet' })]));
    const before = await app.dump();
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    const removeItem = jest.spyOn(app.AsyncStorage, 'removeItem');
    setItem.mockClear();
    removeItem.mockClear();
    await openChild('Billy');
    await pressRadio(en('paPeriodMonth'));
    await pressRadio(en('paPeriodYear'));
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(await app.dump()).toEqual(before);
    expect(JSON.stringify(RNTL.screen.toJSON())).not.toMatch(/MAIN-TASK|MainPet/);
  });

  test('a locked parent area shows the PIN screen: no task, token or milestone appears', async () => {
    const { app, ids } = await boot();
    await seedBilly(app, ids);
    await openChild('Billy');
    expect(RNTL.screen.getByText('Homework')).toBeTruthy();
    await RNTL.act(async () => {
      app.gate.lockParentArea();
    });
    await settle();
    expect(RNTL.screen.queryByText('Homework')).toBeNull();
    expect(RNTL.screen.queryByText(en('paTokens'))).toBeNull();
    expect(await RNTL.screen.findByText(new RegExp(en('pgTitle')))).toBeTruthy();
  });

  test('the same sections in Spanish', async () => {
    const { app, ids } = await boot('es');
    await seedBilly(app, ids);
    await openChild('Billy', es);
    expect(RNTL.screen.getByText(es('paDueToday_one', { count: 1 }))).toBeTruthy();
    expect(RNTL.screen.getByText(es('paRepeating'))).toBeTruthy();
    expect(RNTL.screen.getByText(es('paRepeatingNote', { days: 30 }))).toBeTruthy();
    expect(RNTL.screen.getByText(es('paAssignedTitle'))).toBeTruthy();
    expect(RNTL.screen.getByText(es('paMsHatched', { pet: 'Biscuit' }))).toBeTruthy();
    expect(RNTL.screen.getByText(es('paActTitle'))).toBeTruthy();
    expect(RNTL.screen.getByRole('radio', { name: es('paPeriodWeek') })).toBeTruthy();
    expect(es('paRepeatingNote', { days: 30 })).toMatch(/estimaci|no es un historial comprobado/i);
  });
});
