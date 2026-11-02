import { setCurrentLanguage } from '@/i18n';
import { getTaskIconCell } from '@/components/task-icon';
import { categoryLabel, displayCategory, isTaskCategory } from '@/utils/categorize-task';
import { getCompletedEntries } from '@/utils/category-accomplishments';
import { getTaskRoom } from '@/utils/room-tasks';
import { ALL_CATEGORIES, getCategoryCompletionCounts } from '@/utils/stats';
import { getCompletedTaskCount, normalizeTask, toggleTaskOccurrence, type Task } from '@/utils/tasks';
import { T0, flush, freezeClock, loadApp, unfreezeClock } from './helpers';

// A task saved by an older or damaged version can carry a category this version does not know.
const UNKNOWN = 'Home';
function task(id: string, category: string, over: Partial<Task> = {}): Task {
  return { id, text: id, category: category as Task['category'], important: false, kind: 'task', date: '2026-03-10', completed: false, ...over };
}

afterEach(() => setCurrentLanguage('en'));

describe('displayCategory (display only)', () => {
  test('known categories are unchanged', () => {
    for (const c of ALL_CATEGORIES) {
      expect(isTaskCategory(c)).toBe(true);
      expect(displayCategory(c)).toBe(c);
    }
  });
  test('unknown, outdated or missing values show as Personal', () => {
    for (const bad of [UNKNOWN, 'study', 'STUDY', '', undefined, null, 7, {}, 'Pets']) {
      expect(isTaskCategory(bad)).toBe(false);
      expect(displayCategory(bad)).toBe('Personal');
    }
  });
});

describe('label and icon in English and Spanish', () => {
  test('the label of an unknown category is the Personal label of the CURRENT language, never a raw key', () => {
    setCurrentLanguage('en');
    expect(categoryLabel('Study')).toBe('Study');
    expect(categoryLabel(UNKNOWN)).toBe(categoryLabel('Personal'));
    expect(categoryLabel(UNKNOWN)).not.toMatch(/cat|Home/);
    setCurrentLanguage('es');
    expect(categoryLabel('Study')).toBe('Estudio');
    expect(categoryLabel(UNKNOWN)).toBe(categoryLabel('Personal'));
    expect(categoryLabel(UNKNOWN)).toBe('Personal');
    expect(categoryLabel(UNKNOWN)).not.toMatch(/cat|Home/);
  });

  test('the icon of an unknown category is the Personal icon; the others keep theirs', () => {
    expect(getTaskIconCell(UNKNOWN)).toEqual({ col: 1, row: 1 });
    expect(getTaskIconCell('Personal')).toEqual({ col: 1, row: 1 });
    expect(getTaskIconCell('Study')).toEqual({ col: 0, row: 0 });
    expect(getTaskIconCell('Exercise')).toEqual({ col: 1, row: 0 });
    expect(getTaskIconCell('Clean')).toEqual({ col: 0, row: 1 });
    expect(getTaskIconCell('Health')).toBe('health');
  });
});

describe('stats, accomplishments and rooms with an unknown category', () => {
  const tasks = [
    task('a', 'Study', { completed: true }),
    task('b', UNKNOWN, { completed: true }),
    task('c', UNKNOWN, { repeat: { kind: 'daily' }, completedDates: ['2026-03-01', '2026-03-02'] }),
    task('d', 'Health', { completed: false }),
  ];

  test('the unknown task counts as Personal and the numbers still add up (no NaN)', () => {
    const counts = getCategoryCompletionCounts(tasks);
    expect(counts).toEqual({ Study: 1, Exercise: 0, Clean: 0, Health: 0, Personal: 3 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(getCompletedTaskCount(tasks));
    expect(Object.keys(counts).sort()).toEqual([...ALL_CATEGORIES].sort());
  });

  test('the Personal accomplishments page lists it; its entries carry a known category', () => {
    const entries = getCompletedEntries(tasks, 'Personal');
    expect(entries.map((e) => e.key).sort()).toEqual(['b', 'c:2026-03-01', 'c:2026-03-02']);
    expect(entries.every((e) => e.category === 'Personal')).toBe(true);
    expect(getCompletedEntries(tasks, 'Study').map((e) => e.key)).toEqual(['a']);
  });

  test('a legacy task with an unknown category and no room is treated as Personal (Living Room)', () => {
    expect(getTaskRoom(task('x', UNKNOWN))).toBe('living-room');
  });

  test('the saved task itself is never changed by any of this', () => {
    const before = JSON.stringify(tasks);
    getCategoryCompletionCounts(tasks);
    getCompletedEntries(tasks, 'Personal');
    getTaskRoom(tasks[1]);
    expect(JSON.stringify(tasks)).toBe(before);
    expect(normalizeTask(JSON.parse(JSON.stringify(tasks[1])), '2026-03-10').category).toBe(UNKNOWN);
  });
});

describe('storage and rewards keep the saved category', () => {
  beforeEach(() => freezeClock(T0));
  afterEach(() => unfreezeClock());

  test('loading, completing and saving never rewrites the category; the reward and growth are the normal ones', async () => {
    const stored = [task('odd', UNKNOWN), task('plain', 'Study')];
    const app = await loadApp({ '@ProductivityPet:tasks': stored, '@ProductivityPet:awardedTaskTokens': [] });
    await app.profiles.ensureProfilesReady();
    await app.family.ensureFamilyLoaded();
    const rawBefore = await app.AsyncStorage.getItem('@ProductivityPet:tasks');

    const loaded = await app.taskStorage.getCachedTasks();
    expect(loaded.find((t) => t.id === 'odd')!.category).toBe(UNKNOWN);
    expect(await app.AsyncStorage.getItem('@ProductivityPet:tasks')).toBe(rawBefore); // loading rewrote nothing

    const walletBefore = app.family.getWalletBalance();
    const done = toggleTaskOccurrence(loaded, 'odd', '2026-03-10');
    expect(done.find((t) => t.id === 'odd')).toMatchObject({ category: UNKNOWN, completed: true });
    app.taskStorage.persistCachedTasks(done);
    await flush();
    expect(app.family.getWalletBalance()).toBe(walletBefore + 10); // the normal regular-task reward
    const saved = JSON.parse((await app.AsyncStorage.getItem('@ProductivityPet:tasks'))!);
    expect(saved.find((t: Task) => t.id === 'odd').category).toBe(UNKNOWN); // still exactly what was saved
    expect(saved.find((t: Task) => t.id === 'plain').category).toBe('Study');

    // un-check and re-check: still no second reward
    app.taskStorage.persistCachedTasks(toggleTaskOccurrence(done, 'odd', '2026-03-10'));
    app.taskStorage.persistCachedTasks(toggleTaskOccurrence(toggleTaskOccurrence(done, 'odd', '2026-03-10'), 'odd', '2026-03-10'));
    await flush();
    expect(app.family.getWalletBalance()).toBe(walletBefore + 10);
  });
});
