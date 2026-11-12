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
// Home's slide-out panels are hidden from the accessibility tree while closed; these tests look inside them anyway.
RNTL.configure({ defaultIncludeHiddenElements: true });

const mockState = { path: '/' };
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => mockState.path, useLocalSearchParams: () => ({}), Link: 'Link' }));

// The player's own mood, one record per day: empty until picked, picked / changed / cleared for today (Home) and for any past day (Tasks
// calendar), the two always agreeing, each profile with its own. Nothing here is the PET's mood, needs or growth.
// T0 is Tuesday 2026-03-10.
const TODAY = '2026-03-10';
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => {
  freezeClock(T0);
  mockState.path = '/';
});
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const H = () => require('@/utils/household') as typeof import('@/utils/household');
const log = () => require('@/utils/mood-log') as typeof import('@/utils/mood-log');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');
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
const saved = async (app: App, key: string) => JSON.parse((await app.AsyncStorage.getItem(key)) ?? '[]') as { mood: string; dateISO: string; id: string }[];
const MAIN_LOG = '@ProductivityPet:moodLog';
const childLog = (id: string) => `@ProductivityPet:p:${id}:moodLog`;
const HomeScreen = () => (require('@/app/index') as typeof import('@/app/index')).default;
const TasksScreen = () => (require('@/app/tasks') as typeof import('@/app/tasks')).default;
const happy = () => RNTL.screen.getByRole('button', { name: 'Happy' });

describe('one mood per day: the record', () => {
  test('nothing is chosen for anyone: no mood on any day until the player picks one', async () => {
    const { app } = await boot();
    const entries = await log().getMoodLog();
    expect(log().moodOnDate(entries, TODAY)).toBeNull();
    expect(await saved(app, MAIN_LOG)).toEqual([]);
  });

  test('select, change (replaces), tap the same again (clears); never two records for a day', async () => {
    const { app } = await boot();
    expect(await log().toggleMoodForDate(TODAY, 'Happy')).toBe('set');
    expect((await saved(app, MAIN_LOG)).map((e) => [e.dateISO, e.mood])).toEqual([[TODAY, 'Happy']]);
    expect(await log().toggleMoodForDate(TODAY, 'Calm')).toBe('set'); // a different mood replaces it
    expect((await saved(app, MAIN_LOG)).map((e) => [e.dateISO, e.mood])).toEqual([[TODAY, 'Calm']]);
    expect(await log().toggleMoodForDate(TODAY, 'Calm')).toBe('cleared'); // the same again clears the day
    expect(await saved(app, MAIN_LOG)).toEqual([]);
    expect(log().moodOnDate(await log().getMoodLog(), TODAY)).toBeNull();
    await log().toggleMoodForDate(TODAY, 'Tired');
    await log().toggleMoodForDate(TODAY, 'Tired');
    await log().toggleMoodForDate(TODAY, 'Tired');
    expect(await saved(app, MAIN_LOG)).toHaveLength(1);
  });

  test('past days can be filled in, changed and cleared; other days (and their history) are never touched', async () => {
    const { app } = await boot();
    const now = new Date(T0);
    // history that already exists, including a day with several older check-ins
    await app.AsyncStorage.setItem(
      MAIN_LOG,
      JSON.stringify([
        { id: 'o1', mood: 'Stressed', at: '2026-03-05T09:00:00.000Z', dateISO: '2026-03-05' },
        { id: 'o2', mood: 'Calm', at: '2026-03-06T09:00:00.000Z', dateISO: '2026-03-06' },
        { id: 'o3', mood: 'Focused', at: '2026-03-06T18:00:00.000Z', dateISO: '2026-03-06' },
      ])
    );
    await app.profiles.switchProfile('main'); // reload the log from storage
    expect(await log().toggleMoodForDate('2026-03-08', 'Sick', now)).toBe('set'); // a missed past day
    expect(await log().toggleMoodForDate('2026-03-08', 'Tired', now)).toBe('set'); // changed
    const afterEdit = await saved(app, MAIN_LOG);
    expect(afterEdit.filter((e) => e.dateISO === '2026-03-08').map((e) => e.mood)).toEqual(['Tired']);
    expect(afterEdit.filter((e) => e.dateISO === '2026-03-05').map((e) => e.id)).toEqual(['o1']); // untouched
    expect(afterEdit.filter((e) => e.dateISO === '2026-03-06').map((e) => e.id)).toEqual(['o2', 'o3']); // untouched
    expect(await log().toggleMoodForDate('2026-03-08', 'Tired', now)).toBe('cleared');
    const afterClear = await saved(app, MAIN_LOG);
    expect(afterClear.map((e) => e.id)).toEqual(['o1', 'o2', 'o3']); // everything recorded before is still there
  });

  test('a future day is refused and writes nothing', async () => {
    const { app } = await boot();
    expect(await log().toggleMoodForDate('2026-03-11', 'Happy', new Date(T0))).toBe('future');
    expect(await log().toggleMoodForDate('2027-01-01', 'Happy', new Date(T0))).toBe('future');
    expect(await log().toggleMoodForDate('not-a-date', 'Happy', new Date(T0))).toBe('future');
    expect(await saved(app, MAIN_LOG)).toEqual([]);
  });

  test('each profile has its own history: Main and a child never see or change each other\'s', async () => {
    const { app, billy } = await boot();
    await log().toggleMoodForDate(TODAY, 'Happy');
    await app.profiles.switchProfile(billy);
    expect(log().moodOnDate(await log().getMoodLog(), TODAY)).toBeNull();
    await log().toggleMoodForDate(TODAY, 'Tired');
    expect((await saved(app, childLog(billy))).map((e) => e.mood)).toEqual(['Tired']);
    expect((await saved(app, MAIN_LOG)).map((e) => e.mood)).toEqual(['Happy']);
    await app.profiles.switchProfile('main');
    expect(log().moodOnDate(await log().getMoodLog(), TODAY)).toBe('Happy');
    await log().toggleMoodForDate(TODAY, 'Happy'); // clearing Main's day
    expect((await saved(app, childLog(billy))).map((e) => e.mood)).toEqual(['Tired']); // the child's is still there
  });

  test('the pet is not touched: no pet, needs or growth record changes when moods are picked and cleared', async () => {
    const { app } = await boot();
    const before = new Map([...(await app.dump()).entries()].filter(([key]) => /pet|growth|tokens|household/i.test(key)));
    await log().toggleMoodForDate(TODAY, 'Sick');
    await log().toggleMoodForDate('2026-03-01', 'Happy');
    await log().toggleMoodForDate(TODAY, 'Sick');
    const after = await app.dump();
    for (const [key, value] of before) expect([key, after.get(key)]).toEqual([key, value]);
    const source = read('src/utils/mood-log.ts');
    expect(source).not.toMatch(/pet-profile|pet-family|paw-tokens/);
  });
});

describe('Home: Today\'s Mood', () => {
  async function home(app: App, profile = 'main') {
    await app.profiles.switchProfile(profile);
    const Home = HomeScreen();
    await RNTL.render(<Home />);
    await settle();
  }

  test('empty by default, even with an old saved "Happy"; nothing is saved by just opening Home', async () => {
    const { app } = await boot();
    await app.AsyncStorage.setItem('@ProductivityPet:mood', 'Happy'); // the old default value some profiles still have saved
    await home(app);
    expect(RNTL.screen.getByTestId('today-mood-empty')).toBeTruthy();
    expect(words()).toContain(en('moodNotRecorded'));
    expect(words()).not.toContain(en('moodExclaim', { name: 'Happy' }));
    for (const name of ['Happy', 'Calm', 'Focused', 'Stressed', 'Tired', 'Sick']) {
      expect(RNTL.screen.getByRole('button', { name }).props.accessibilityState.selected).toBe(false);
    }
    expect(await saved(app, MAIN_LOG)).toEqual([]);
    expect(await app.AsyncStorage.getItem('@ProductivityPet:mood')).toBe('Happy'); // the old value is left exactly as it was
  });

  test('pick shows and saves it for today; another replaces it; the same again returns to the empty square', async () => {
    const { app } = await boot();
    await home(app);
    await RNTL.fireEvent.press(happy());
    await settle();
    expect(RNTL.screen.queryByTestId('today-mood-empty')).toBeNull();
    expect(words()).toContain(en('moodExclaim', { name: 'Happy' }));
    expect(happy().props.accessibilityState.selected).toBe(true);
    expect((await saved(app, MAIN_LOG)).map((e) => [e.dateISO, e.mood])).toEqual([[TODAY, 'Happy']]);
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: 'Tired' }));
    await settle();
    expect(happy().props.accessibilityState.selected).toBe(false);
    expect(RNTL.screen.getByRole('button', { name: 'Tired' }).props.accessibilityState.selected).toBe(true);
    expect((await saved(app, MAIN_LOG)).map((e) => e.mood)).toEqual(['Tired']);
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: 'Tired' }));
    await settle();
    expect(RNTL.screen.getByTestId('today-mood-empty')).toBeTruthy();
    expect(await saved(app, MAIN_LOG)).toEqual([]);
  });

  test('earlier days\' moods stay when today is picked or cleared; a mood already recorded for today shows on opening', async () => {
    const { app } = await boot();
    await app.AsyncStorage.setItem(
      MAIN_LOG,
      JSON.stringify([
        { id: 'p1', mood: 'Calm', at: '2026-03-09T10:00:00.000Z', dateISO: '2026-03-09' },
        { id: 'p2', mood: 'Focused', at: '2026-03-10T10:00:00.000Z', dateISO: TODAY },
      ])
    );
    await home(app);
    expect(RNTL.screen.queryByTestId('today-mood-empty')).toBeNull();
    expect(words()).toContain(en('moodExclaim', { name: 'Focused' }));
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: 'Focused' })); // clear today
    await settle();
    expect((await saved(app, MAIN_LOG)).map((e) => e.id)).toEqual(['p1']);
  });

  test('a child profile has its own empty Today\'s Mood', async () => {
    const { app, billy } = await boot();
    await log().toggleMoodForDate(TODAY, 'Happy'); // Main's
    await home(app, billy);
    expect(RNTL.screen.getByTestId('today-mood-empty')).toBeTruthy();
  });

  test('Spanish: the empty prompt', async () => {
    const { app } = await boot('es');
    await home(app);
    expect(words()).toContain(es('moodNotRecorded'));
  });
});

describe('Tasks calendar: the mood of the selected day', () => {
  async function tasks(app: App, profile = 'main') {
    await app.profiles.switchProfile(profile);
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
  }
  const dayMood = () => RNTL.within(RNTL.screen.getByTestId('day-mood'));
  const pickDay = async (day: number) => {
    // the calendar's day cells are the only buttons whose label is exactly the day number text; press the text of that day
    const cells = RNTL.screen.getAllByText(String(day));
    await RNTL.fireEvent.press(cells[0]);
    await settle();
  };

  test('shows an empty unchecked square for a day with no mood; pick / change / clear on that day', async () => {
    const { app } = await boot();
    await tasks(app);
    expect(RNTL.screen.getByTestId('day-mood-state').props.accessibilityLabel).toBe(en('dayMoodNone'));
    await RNTL.fireEvent.press(dayMood().getByRole('button', { name: 'Calm' }));
    await settle();
    expect(RNTL.screen.getByTestId('day-mood-state').props.accessibilityLabel).toBe(en('dayMoodSelected', { name: 'Calm' }));
    expect(dayMood().getByRole('button', { name: 'Calm' }).props.accessibilityState.selected).toBe(true);
    await RNTL.fireEvent.press(dayMood().getByRole('button', { name: 'Sick' }));
    await settle();
    expect((await saved(app, MAIN_LOG)).map((e) => [e.dateISO, e.mood])).toEqual([[TODAY, 'Sick']]);
    await RNTL.fireEvent.press(dayMood().getByRole('button', { name: 'Sick' }));
    await settle();
    expect(RNTL.screen.getByTestId('day-mood-state').props.accessibilityLabel).toBe(en('dayMoodNone'));
    expect(await saved(app, MAIN_LOG)).toEqual([]);
  });

  test('selecting a past date shows ITS mood (or empty); a missed day can be filled in without touching other days', async () => {
    const { app } = await boot();
    await app.AsyncStorage.setItem(MAIN_LOG, JSON.stringify([{ id: 'm5', mood: 'Stressed', at: '2026-03-05T09:00:00.000Z', dateISO: '2026-03-05' }]));
    await tasks(app);
    await pickDay(5);
    expect(RNTL.screen.getByTestId('day-mood-state').props.accessibilityLabel).toBe(en('dayMoodSelected', { name: 'Stressed' }));
    await pickDay(4); // nothing recorded on the 4th
    expect(RNTL.screen.getByTestId('day-mood-state').props.accessibilityLabel).toBe(en('dayMoodNone'));
    await RNTL.fireEvent.press(dayMood().getByRole('button', { name: 'Happy' }));
    await settle();
    const rows = await saved(app, MAIN_LOG);
    expect(rows.map((e) => [e.dateISO, e.mood]).sort()).toEqual([['2026-03-04', 'Happy'], ['2026-03-05', 'Stressed']]);
    await pickDay(5);
    expect(RNTL.screen.getByTestId('day-mood-state').props.accessibilityLabel).toBe(en('dayMoodSelected', { name: 'Stressed' })); // the 5th is as it was
  });

  test('a future day offers no mood selector', async () => {
    const { app } = await boot();
    await tasks(app);
    expect(RNTL.screen.queryByTestId('day-mood')).not.toBeNull();
    await pickDay(11);
    expect(RNTL.screen.queryByTestId('day-mood')).toBeNull();
    await pickDay(10);
    expect(RNTL.screen.queryByTestId('day-mood')).not.toBeNull();
  });

  test('the calendar and Home agree on today in both directions (one record)', async () => {
    const { app } = await boot();
    await app.profiles.switchProfile('main');
    const Home = HomeScreen();
    const Screen = TasksScreen();
    await RNTL.render(
      <>
        <Home />
        <Screen />
      </>
    );
    await settle();
    expect(RNTL.screen.getByTestId('today-mood-empty')).toBeTruthy();
    // pick in the calendar -> Home shows it
    await RNTL.fireEvent.press(dayMood().getByRole('button', { name: 'Focused' }));
    await settle();
    expect(RNTL.screen.queryByTestId('today-mood-empty')).toBeNull();
    expect(words()).toContain(en('moodExclaim', { name: 'Focused' }));
    // clear on Home -> the calendar's square is empty again
    const homeFocused = RNTL.screen.getAllByRole('button', { name: 'Focused' }).find((b) => !RNTL.within(RNTL.screen.getByTestId('day-mood')).queryAllByRole('button', { name: 'Focused' }).includes(b))!;
    await RNTL.fireEvent.press(homeFocused);
    await settle();
    expect(RNTL.screen.getByTestId('day-mood-state').props.accessibilityLabel).toBe(en('dayMoodNone'));
    expect(await saved(app, MAIN_LOG)).toEqual([]);
  });

  test('a child\'s calendar shows the child\'s own moods, not Main\'s', async () => {
    const { app, billy } = await boot();
    await log().toggleMoodForDate(TODAY, 'Happy'); // Main
    await tasks(app, billy);
    expect(RNTL.screen.getByTestId('day-mood-state').props.accessibilityLabel).toBe(en('dayMoodNone'));
    await RNTL.fireEvent.press(dayMood().getByRole('button', { name: 'Tired' }));
    await settle();
    expect((await saved(app, childLog(billy))).map((e) => e.mood)).toEqual(['Tired']);
    expect((await saved(app, MAIN_LOG)).map((e) => e.mood)).toEqual(['Happy']);
  });

  test('Spanish labels', async () => {
    const { app } = await boot('es');
    await tasks(app);
    expect(RNTL.screen.getByTestId('day-mood-state').props.accessibilityLabel).toBe(es('dayMoodNone'));
    expect(words()).toContain(es('dayMoodLabel'));
  });
});

describe('holiday icons', () => {
  test('every holiday has its own vector icon, none is the old party emoji, names and dates are unchanged', () => {
    const { getHolidayForDate, getHolidayIconForDate } = require('@/utils/holidays') as typeof import('@/utils/holidays');
    const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json') as Record<string, number>;
    const dates = ['2026-01-01', '2026-01-19', '2026-02-14', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-04', '2026-09-07', '2026-10-31', '2026-11-11', '2026-11-26', '2026-12-24', '2026-12-25', '2026-12-31'];
    const names = ["New Year's Day", 'Martin Luther King Jr. Day', "Valentine's Day", "Presidents' Day", 'Memorial Day', 'Juneteenth', 'Independence Day', 'Labor Day', 'Halloween', 'Veterans Day', 'Thanksgiving', 'Christmas Eve', 'Christmas Day', "New Year's Eve"];
    const icons = dates.map((date, i) => {
      expect(getHolidayForDate(date)?.name).toBeTruthy();
      expect(getHolidayForDate(date)).toEqual({ date, name: getHolidayForDate(date)!.name }); // the holiday record keeps its exact shape
      const icon = getHolidayIconForDate(date);
      expect([names[i], icon]).not.toEqual([names[i], undefined]);
      expect(glyphs[icon as string]).toBeDefined(); // a real glyph in the icon set we already ship: nothing new to install
      return icon;
    });
    expect(new Set(icons).size).toBe(icons.length); // recognisable, different icons
    expect(getHolidayIconForDate('2026-03-10')).toBeUndefined();
  });

  test('the Tasks screen draws the icon beside the holiday name (and no emoji); a normal day has none', async () => {
    unfreezeClock();
    freezeClock(new Date(2026, 11, 25, 12, 0, 0).getTime());
    const { app } = await boot();
    await app.profiles.switchProfile('main');
    const Screen = TasksScreen();
    await RNTL.render(<Screen />);
    await settle();
    expect(words()).toContain('Christmas Day');
    expect(words()).not.toContain('🎉');
    expect(words()).not.toMatch(/🎉|🎄|🎃|🎆|❤️/u);
    const icon = RNTL.screen.getByTestId('holiday-icon');
    expect(icon.props.accessibilityElementsHidden ?? icon.props.accessibilityElementsHidden).not.toBe(false);
    await RNTL.cleanup();
    unfreezeClock();
    freezeClock(T0);
  });

  test('wiring (source check): icons come from the icon set already in use', () => {
    expect(read('src/app/tasks.tsx')).toMatch(/from '@expo\/vector-icons'/);
    expect(read('src/utils/holidays.ts')).not.toMatch(/🎉|🎄|🎃|🎆/u);
  });
});
