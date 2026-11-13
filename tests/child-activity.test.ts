import { T0, configurePin, flush, freezeClock, iso, loadApp, pet, unfreezeClock, type App } from './helpers';

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

// The reader behind the Parent Dashboard's Tasks, Accomplishments and Activity History: real saved records in, real numbers out, nothing
// invented, nothing private read, nothing changed. "Today" is 2026-03-10 (the frozen test clock).

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
const FP = () => require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');
const A = () => require('@/utils/child-activity') as typeof import('@/utils/child-activity');

async function bootFamily(options: { unlocked?: boolean } = {}): Promise<{ app: App; ids: Record<string, string> }> {
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const ids: Record<string, string> = {};
  for (const name of ['Billy', 'Sarah']) {
    const added = await H().addChild(name);
    if (!added.ok || !added.id) throw new Error('child not added');
    ids[name] = added.id;
  }
  await FP().reconcileFamilyProfiles();
  if (options.unlocked === false) app.gate.lockParentArea();
  return { app, ids };
}

const task = (over: Record<string, unknown>) => ({ id: `t${Math.random()}`, text: 'x', category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: false, ...over });
const tokenEvent = (id: string, dateISO: string, amount: number, source = 'task') => ({ id, at: `${dateISO}T15:00:00.000Z`, dateISO, amount, source });
const family = (pets: object[], pawTokens = 0) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens } });

const BILLY_TASKS = [
  task({ id: 'a', text: 'Homework', date: '2026-03-10' }),
  task({ id: 'b', text: 'Tidy room', date: '2026-03-09' }),
  task({ id: 'c', text: 'Library book', date: '2026-03-15' }),
  task({ id: 'd', text: 'Read', date: '2026-03-02', completed: true, completedAt: '2026-03-02T16:00:00.000Z', important: true }),
  task({ id: 'e', text: 'Old chore', date: '2026-01-01', completed: true }), // done before completion dates were recorded
  task({ id: 'f', text: 'Brush teeth', date: '2026-03-01', repeat: { kind: 'daily' }, completedDates: ['2026-03-05', '2026-03-09', '2026-03-10'] }),
  task({ id: 'g', text: 'Dentist', kind: 'event', date: '2026-03-12' }),
];

async function seedBilly(app: App, ids: Record<string, string>) {
  await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify(BILLY_TASKS));
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

describe('a child with saved data', () => {
  test('tasks today, the repeating estimate, completed totals, tokens, milestones, streak and items all come from the saved records', async () => {
    const { app, ids } = await bootFamily();
    await seedBilly(app, ids);
    const result = await A().readChildActivity(ids.Billy);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok' || result.tasks.state !== 'ok') throw new Error('expected data');
    expect(result.nickname).toBe('Billy');
    expect(result.today).toBe('2026-03-10');
    const s = result.tasks.value.status;
    expect(s.dueToday.map((l) => l.text)).toEqual(['Homework']);
    expect(s.doneTodayCount).toBe(1); // Brush teeth, marked done today
    expect(s.upcoming.map((l) => l.text)).toEqual(['Library book']);
    expect(s.pastDueNotDone.map((l) => l.text)).toEqual(['Tidy room']);
    expect(s.repeatingEstimate.items[0].text).toBe('Brush teeth');
    expect(s.repeatingEstimate.items[0].dates).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-06', '2026-03-07', '2026-03-08']);
    expect(s.completed).toEqual({ total: 5, important: 1, undated: 1 }); // Read, Old chore, three repeating completions; the appointment is not a task
    expect(result.streak).toEqual({ current: 2, longest: 2, undated: 1 });
    if (result.tokens.state !== 'ok') throw new Error('expected tokens');
    expect(result.tokens.value).toMatchObject({ total: 10, startedISO: '2026-03-05', balance: 17 });
    expect(result.itemsOwned).toEqual({ state: 'ok', value: 2 });
    expect(result.activityInput.firstPetISO).toBe('2026-02-08'); // the first pet was created 30 days before today: that is when this child started
    if (result.milestones.state !== 'ok') throw new Error('expected milestones');
    expect(result.milestones.value.map((m) => m.kind)).toEqual(['hatched', 'adopted']);
  });

  test('the numbers equal what the child\'s own game computes from the same records (task count, token total)', async () => {
    const { app, ids } = await bootFamily();
    await seedBilly(app, ids);
    const result = await A().readChildActivity(ids.Billy);
    if (result.status !== 'ok' || result.tasks.state !== 'ok' || result.tokens.state !== 'ok') throw new Error('expected data');
    // now open Billy the way the game does and ask the game's own functions
    expect(await app.profiles.switchProfile(ids.Billy)).toMatchObject({ ok: true });
    const gameTasks = await app.taskStorage.getCachedTasks();
    expect(result.tasks.value.status.completed.total).toBe(app.tasks.getCompletedTaskCount(gameTasks));
    const history = await app.history.getTokenHistory();
    expect(result.tokens.value.total).toBe(history.events.reduce((sum, e) => sum + e.amount, 0));
    const { getStreakSummary } = require('@/utils/streaks') as typeof import('@/utils/streaks');
    expect(result.streak?.current).toBe(getStreakSummary(gameTasks, '2026-03-10').current);
  });

  test('tasks assigned by the parent are a separate list, never mixed into the child\'s own numbers', async () => {
    const { app, ids } = await bootFamily();
    await seedBilly(app, ids);
    for (const text of ['Wash the car', 'Water plants']) expect(await H().addTask(ids.Billy, text, 'parent')).toMatchObject({ ok: true });
    const before = await A().readChildActivity(ids.Billy);
    if (before.status !== 'ok' || before.tasks.state !== 'ok') throw new Error('expected data');
    expect(before.assigned.total).toBe(2);
    expect(before.assigned.byStatus.assigned.map((t) => t.text).sort()).toEqual(['Wash the car', 'Water plants']);
    expect(before.tasks.value.status.completed.total).toBe(5); // unchanged by the assigned ones
    expect(JSON.stringify(before.tasks.value.status)).not.toMatch(/Wash the car|Water plants/);
    const other = await A().readChildActivity(ids.Sarah);
    expect(other.status === 'ok' && other.assigned.total).toBe(0);
  });
});

describe('what is not saved is reported as not saved', () => {
  test('a child who has never played: no tasks, no tokens, no pets, no items; nothing invented', async () => {
    const { ids } = await bootFamily();
    const result = await A().readChildActivity(ids.Sarah);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.tasks).toEqual({ state: 'none' });
    expect(result.tokens).toEqual({ state: 'none' });
    expect(result.milestones).toEqual({ state: 'none' });
    expect(result.itemsOwned).toEqual({ state: 'none' });
    expect(result.streak).toEqual({ current: 0, longest: 0, undated: 0 }); // no tasks at all really is a streak of 0 days
    expect(result.assigned.total).toBe(0);
    expect(result.activityInput).toEqual({ tasks: [], tokens: null, milestones: [], firstPetISO: null, householdDone: [] });
  });

  test('damaged records are "unreadable", a list with unusable entries skips and counts them, nothing is guessed', async () => {
    const { app, ids } = await bootFamily();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), '{ not json');
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tokenEarnings'), JSON.stringify({ events: [] })); // no start date
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'ownedShopItems'), JSON.stringify({ not: 'a list' }));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), '{ nope');
    const result = await A().readChildActivity(ids.Billy);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.tasks).toEqual({ state: 'unreadable' });
    expect(result.tokens).toEqual({ state: 'unreadable' });
    expect(result.itemsOwned).toEqual({ state: 'unreadable' });
    expect(result.milestones).toEqual({ state: 'unreadable' });
    expect(result.streak).toBeNull(); // an unreadable task list says nothing: never a made-up 0

    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify([5, null, { text: 'no id' }, task({ id: 'ok', text: 'Fine' })]));
    const partial = await A().readChildActivity(ids.Billy);
    if (partial.status !== 'ok' || partial.tasks.state !== 'ok') throw new Error('expected tasks');
    expect(partial.tasks.value.skippedEntries).toBe(3);
    expect(partial.tasks.value.status.dueToday.map((l) => l.text)).toEqual(['Fine']);
  });

  test('a task saved without a date is "no due date", never past due', async () => {
    const { app, ids } = await bootFamily();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify([{ id: 'n', text: 'No date', category: 'Personal', completed: false }]));
    const result = await A().readChildActivity(ids.Billy);
    if (result.status !== 'ok' || result.tasks.state !== 'ok') throw new Error('expected data');
    expect(result.tasks.value.status.noDueDate.map((l) => l.text)).toEqual(['No date']);
    expect(result.tasks.value.status.pastDueNotDone).toEqual([]);
  });

  test('Paw Token history that started today covers only today: earlier days are "not tracked", never zero', async () => {
    const { app, ids } = await bootFamily();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tokenEarnings'), JSON.stringify({ startedAt: '2026-03-10T15:00:00.000Z', events: [] }));
    // the child's first pet was made earlier, so the history begins earlier than the token tracking does
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), family([pet({ id: 'p1', name: 'Biscuit' })]));
    const result = await A().readChildActivity(ids.Billy);
    if (result.status !== 'ok') throw new Error('expected ok');
    const { buildActivity } = require('@/utils/child-activity-model') as typeof import('@/utils/child-activity-model');
    const days = buildActivity('day', result.today, result.activityInput);
    expect(days[0]).toMatchObject({ tokens: 0, tokenCoverage: 'tracked' });
    expect(days[1]).toMatchObject({ tokens: null, tokenCoverage: 'before-tracking' });
  });
});

describe('access', () => {
  test('active children only: Main, unknown ids, and archived children are refused, and their records are not even read', async () => {
    const { app, ids } = await bootFamily();
    await seedBilly(app, ids);
    await app.AsyncStorage.setItem(`${P}tasks`, JSON.stringify([task({ id: 'm', text: 'MAIN-TASK' })]));
    await app.AsyncStorage.setItem(scoped(ids.Sarah, 'tasks'), JSON.stringify([task({ id: 's', text: 'SARAH-TASK' })]));
    expect(await H().setChildArchived(ids.Sarah, true)).toMatchObject({ ok: true });
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    getItem.mockClear();
    for (const id of ['main', 'nobody', '', '../x', ids.Sarah]) expect(await A().readChildActivity(id)).toEqual({ status: 'not-a-child' });
    expect(getItem.mock.calls.filter(([key]) => /tasks|tokenEarnings|ownedShopItems|petFamily/.test(String(key)))).toEqual([]);
    // restored: readable again
    expect(await H().setChildArchived(ids.Sarah, false)).toMatchObject({ ok: true });
    const back = await A().readChildActivity(ids.Sarah);
    expect(back.status === 'ok' && back.tasks.state === 'ok' && back.tasks.value.status.dueToday.map((l) => l.text)).toEqual(['SARAH-TASK']);
  });

  test('with the parent area locked nothing is read', async () => {
    const { app, ids } = await bootFamily({ unlocked: false });
    await seedBilly(app, ids);
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    getItem.mockClear();
    expect(await A().readChildActivity(ids.Billy)).toEqual({ status: 'not-allowed' });
    expect(getItem.mock.calls.filter(([key]) => /tasks|tokenEarnings|ownedShopItems|petFamily/.test(String(key)))).toEqual([]);
  });
});

describe('looking changes nothing and reads nothing private', () => {
  test('no write, storage identical afterwards, and only the four records of the child (plus the household) are read: never a journal, a mood record, or anything of Main', async () => {
    const { app, ids } = await bootFamily();
    await seedBilly(app, ids);
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'journal'), JSON.stringify([{ id: 'j', dateISO: '2026-03-01', text: 'PRIVATE-WORDS', createdAt: iso(T0), updatedAt: iso(T0) }]));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'moodLog'), JSON.stringify([{ id: 'm', mood: 'Happy', at: iso(T0), dateISO: '2026-03-10' }]));
    await app.AsyncStorage.setItem(`${P}journal`, JSON.stringify([{ id: 'mj', dateISO: '2026-03-01', text: 'MAIN-WORDS' }]));
    await app.AsyncStorage.setItem(`${P}tasks`, JSON.stringify([task({ id: 'mt', text: 'MAIN-TASK' })]));
    await flush();
    const before = await app.dump();
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    const removeItem = jest.spyOn(app.AsyncStorage, 'removeItem');
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    for (const spy of [setItem, removeItem, getItem]) spy.mockClear();

    const result = await A().readChildActivity(ids.Billy);
    await flush();
    const read = getItem.mock.calls.map(([key]) => String(key)); // before this test's own dump reads everything

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(await app.dump()).toEqual(before);
    expect(read.filter((key) => key.startsWith(`${P}p:${ids.Billy}:`)).map((key) => key.split(':').pop()).sort()).toEqual(['ownedShopItems', 'petFamily', 'tasks', 'tokenEarnings']);
    expect(read.filter((key) => /:journal$|moodLog|:mood$/.test(key))).toEqual([]);
    expect(read.filter((key) => !key.startsWith(`${P}p:`) && /journal|tasks|petFamily|moodLog|ownedShopItems|tokenEarnings/.test(key))).toEqual([]); // nothing of Main
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE-WORDS|MAIN-WORDS|MAIN-TASK/);
  });

  test('source check: it only reads (getItem), imports no game store, journal or mood module, and writes nothing', () => {
    const fs = require('fs');
    const path = require('path');
    for (const file of ['src/utils/child-activity.ts', 'src/utils/child-activity-model.ts']) {
      const code = (fs.readFileSync(path.resolve(file), 'utf8') as string).replace(/\/\/.*$/gm, '');
      expect([file, /setItem|removeItem|mergeItem|writeScoped|switchProfile|registerProfileStore/.test(code)]).toEqual([file, false]);
      // value imports only (type-only imports are erased and load nothing)
      const imports = code.split(String.fromCharCode(10)).filter((l) => /^import (?!type)/.test(l) || /^} from /.test(l));
      expect([file, imports.filter((l) => /@\/utils\/(journal|journal-sharing|task-storage|paw-tokens|shop-inventory|mood-log|token-history|pet-profile|pet-alerts)'/.test(l))]).toEqual([file, []]);
      expect([file, /JOURNAL_KEY_NAME|'journal'|moodLog/.test(code)]).toEqual([file, false]);
    }
  });
});
