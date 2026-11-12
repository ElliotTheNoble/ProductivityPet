import { T0, configurePin, flush, freezeClock, loadApp, unfreezeClock, type App } from './helpers';

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

// Step 4A: the tasks a parent assigns, as the child they belong to sees them. Ownership, rooms, statuses, counts and data preservation.
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

async function bootFamily(): Promise<{ app: App; ids: Record<string, string> }> {
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
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  return { app, ids };
}
const assign = async (childId: string, text: string, room?: string) => {
  const result = await H().addTask(childId, text, 'parent', room as never);
  if (!result.ok || !result.id) throw new Error(`not assigned: ${text}`);
  return result.id;
};
const enter = async (app: App, id: string) => expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
const tasksOf = (childId: string) => H().peekHousehold()!.children.find((c) => c.id === childId)!.tasks;

describe('the household task record, extended compatibly', () => {
  test('a task can be assigned to a room; an invalid room is refused; no room means "anywhere"', async () => {
    const { ids } = await bootFamily();
    await assign(ids.Billy, 'Make the bed', 'bedroom');
    await assign(ids.Billy, 'Anywhere task');
    expect(await H().addTask(ids.Billy, 'Bad room', 'parent', 'living-room' as never)).toEqual({ ok: false, reason: 'invalid' });
    expect(await H().addTask(ids.Billy, 'Bad room', 'parent', 'attic' as never)).toEqual({ ok: false, reason: 'invalid' });
    expect(tasksOf(ids.Billy).map((t) => [t.text, t.room ?? null])).toEqual([['Make the bed', 'bedroom'], ['Anywhere task', null]]);
  });

  test('tasks saved before rooms existed load unchanged (no room, no return mark); an unknown saved room is dropped, never guessed', async () => {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const old = {
      version: 1,
      parent: null,
      selectedChildId: null,
      revision: 1,
      children: [
        {
          id: 'kid-a',
          nickname: 'Old',
          createdAt: '2026-01-01T00:00:00.000Z',
          settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' },
          tasks: [
            { id: 't1', text: 'Old task', createdBy: 'parent', status: 'assigned', createdAt: '2026-01-02T00:00:00.000Z' },
            { id: 't2', text: 'Weird room', createdBy: 'parent', status: 'assigned', createdAt: '2026-01-02T00:00:00.000Z', room: 'attic', returnedAt: 5 },
          ],
        },
      ],
    };
    await loadApp({ [`${P}household`]: old });
    const household = await H().ensureHouseholdLoaded();
    expect(household.children[0].tasks.map((t) => [t.id, t.room, t.returnedAt])).toEqual([['t1', undefined, undefined], ['t2', undefined, undefined]]);
  });

  test('the status flow is unchanged: assigned -> pending -> approved; sent back -> assigned again (marked as sent back) -> pending', async () => {
    const { ids } = await bootFamily();
    const a = await assign(ids.Billy, 'First', 'gym');
    const b = await assign(ids.Billy, 'Second', 'gym');
    expect(await H().markTaskDone(ids.Billy, a)).toMatchObject({ ok: true });
    expect(tasksOf(ids.Billy).find((t) => t.id === a)!.status).toBe('pending');
    expect(await H().approveTask(ids.Billy, a)).toMatchObject({ ok: true });
    expect(tasksOf(ids.Billy).find((t) => t.id === a)!.status).toBe('approved');
    await H().markTaskDone(ids.Billy, b);
    expect(await H().sendTaskBack(ids.Billy, b)).toMatchObject({ ok: true });
    const sentBack = tasksOf(ids.Billy).find((t) => t.id === b)!;
    expect([sentBack.status, typeof sentBack.returnedAt, sentBack.room]).toEqual(['assigned', 'string', 'gym']);
    await H().markTaskDone(ids.Billy, b);
    const again = tasksOf(ids.Billy).find((t) => t.id === b)!;
    expect([again.status, typeof again.returnedAt]).toEqual(['pending', 'string']); // handed in again: still marked as a resubmission (so an undo goes back to "sent back")
    expect(await H().approveTask(ids.Billy, a)).toEqual({ ok: false, reason: 'wrong-state' }); // approving twice changes nothing
  });
});

describe('who sees which assigned tasks', () => {
  test('only the active child\'s own tasks; Main, another child, an archived child and a duplicated id get none', async () => {
    const { ids } = await bootFamily();
    await assign(ids.Billy, 'Billy gym', 'gym');
    await assign(ids.Sarah, 'Sarah study', 'study-room');
    const household = H().peekHousehold()!;
    const view = (id: string, dups: string[] = []) => A().assignedTasksFor(household, id, dups).map((v) => v.text);
    expect(view(ids.Billy)).toEqual(['Billy gym']);
    expect(view(ids.Sarah)).toEqual(['Sarah study']);
    expect(view('main')).toEqual([]);
    expect(view('nobody')).toEqual([]);
    expect(view(ids.Billy, [ids.Billy])).toEqual([]);
    expect(A().assignedTasksFor(null, ids.Billy)).toEqual([]);
    expect(await H().setChildArchived(ids.Billy, true)).toMatchObject({ ok: true });
    expect(A().assignedTasksFor(H().peekHousehold(), ids.Billy)).toEqual([]);
    expect(await H().setChildArchived(ids.Billy, false)).toMatchObject({ ok: true });
    expect(A().assignedTasksFor(H().peekHousehold(), ids.Billy).map((v) => v.text)).toEqual(['Billy gym']); // restored: back, nothing lost
  });

  test('only tasks a PARENT assigned count, and finished ones (approved or completed) are not outstanding', async () => {
    const { ids } = await bootFamily();
    await H().updateChildSettings(ids.Billy, { canCreateTasks: true });
    await assign(ids.Billy, 'Parent task', 'bedroom');
    expect(await H().addTask(ids.Billy, 'Child made this', 'child')).toMatchObject({ ok: true });
    const done = await assign(ids.Billy, 'Will be approved', 'bedroom');
    await H().markTaskDone(ids.Billy, done);
    await H().approveTask(ids.Billy, done);
    expect(A().assignedTasksFor(H().peekHousehold(), ids.Billy).map((v) => v.text)).toEqual(['Parent task']);
  });

  test('the three states are told apart: to do, sent back, waiting for the parent', async () => {
    const { ids } = await bootFamily();
    const todo = await assign(ids.Billy, 'To do', 'kitchen');
    const back = await assign(ids.Billy, 'Sent back', 'kitchen');
    const wait = await assign(ids.Billy, 'Waiting', 'kitchen');
    await H().markTaskDone(ids.Billy, back);
    await H().sendTaskBack(ids.Billy, back);
    await H().markTaskDone(ids.Billy, wait);
    const states = Object.fromEntries(A().assignedTasksFor(H().peekHousehold(), ids.Billy).map((v) => [v.id, v.state]));
    expect(states).toEqual({ [todo]: 'to-do', [back]: 'sent-back', [wait]: 'waiting' });
  });

  test('a task id listed twice in a record is one task', async () => {
    const { ids } = await bootFamily();
    const id = await assign(ids.Billy, 'Only once', 'gym');
    const household = H().peekHousehold()!;
    const doubled = { ...household, children: household.children.map((c) => (c.id === ids.Billy ? { ...c, tasks: [...c.tasks, ...c.tasks] } : c)) };
    expect(A().assignedTasksFor(doubled, ids.Billy).map((v) => v.id)).toEqual([id]);
  });
});

describe('room counts', () => {
  test('exact counts per room: to do and sent back count, waiting does not; "anywhere" is its own; the total is their sum', async () => {
    const { ids } = await bootFamily();
    await assign(ids.Billy, 'g1', 'gym');
    await assign(ids.Billy, 'g2', 'gym');
    const sent = await assign(ids.Billy, 'g3', 'gym');
    const wait = await assign(ids.Billy, 'b1', 'bedroom');
    await assign(ids.Billy, 'any');
    await H().markTaskDone(ids.Billy, sent);
    await H().sendTaskBack(ids.Billy, sent);
    await H().markTaskDone(ids.Billy, wait);
    const views = A().assignedTasksFor(H().peekHousehold(), ids.Billy);
    expect(A().outstandingByRoom(views)).toEqual({ 'study-room': 0, gym: 3, bedroom: 0, kitchen: 0, bathroom: 0, anywhere: 1 });
    expect(A().outstandingTotal(views)).toBe(4);
    expect(A().viewsForRoom(views, 'bedroom').map((v) => v.state)).toEqual(['waiting']);
    expect(A().viewsForRoom(views, 'gym')).toHaveLength(3);
    expect(A().viewsForRoom(views, 'anywhere')).toHaveLength(1);
  });

  test('another child\'s tasks never change this child\'s counts', async () => {
    const { ids } = await bootFamily();
    await assign(ids.Billy, 'mine', 'gym');
    for (let i = 0; i < 5; i += 1) await assign(ids.Sarah, `hers ${i}`, 'gym');
    expect(A().outstandingTotal(A().assignedTasksFor(H().peekHousehold(), ids.Billy))).toBe(1);
  });
});

describe('handing a task in', () => {
  test('the child hands in their own task: it becomes pending (the existing flow); handing in again does nothing', async () => {
    const { app, ids } = await bootFamily();
    const id = await assign(ids.Billy, 'Tidy up', 'bedroom');
    await enter(app, ids.Billy);
    expect(await A().submitAssignedTask(id)).toBe('sent');
    expect(tasksOf(ids.Billy).find((t) => t.id === id)).toMatchObject({ status: 'pending' });
    const before = JSON.stringify(H().peekHousehold());
    expect(await A().submitAssignedTask(id)).toBe('not-yours'); // already handed in: refused, no second record, nothing changed
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
    expect(tasksOf(ids.Billy)).toHaveLength(1);
  });

  test('when the child\'s setting does not need approval, handing in completes it', async () => {
    const { app, ids } = await bootFamily();
    await H().updateChildSettings(ids.Billy, { requireApproval: false });
    const id = await assign(ids.Billy, 'Quick one', 'kitchen');
    await enter(app, ids.Billy);
    expect(await A().submitAssignedTask(id)).toBe('sent');
    expect(tasksOf(ids.Billy).find((t) => t.id === id)).toMatchObject({ status: 'completed' });
  });

  test('a child can never hand in another child\'s task, an unknown task, or anything as Main; nothing changes', async () => {
    const { app, ids } = await bootFamily();
    const hers = await assign(ids.Sarah, 'Sarah only', 'gym');
    await assign(ids.Billy, 'Billy only', 'gym');
    await enter(app, ids.Billy);
    const before = JSON.stringify(H().peekHousehold());
    expect(await A().submitAssignedTask(hers)).toBe('not-yours');
    expect(await A().submitAssignedTask('no-such-task')).toBe('not-yours');
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
    await enter(app, 'main');
    expect(await A().submitAssignedTask(hers)).toBe('not-yours');
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
  });

  test('a sent-back task can be handed in again', async () => {
    const { app, ids } = await bootFamily();
    const id = await assign(ids.Billy, 'Try twice', 'gym');
    await H().markTaskDone(ids.Billy, id);
    await H().sendTaskBack(ids.Billy, id);
    await enter(app, ids.Billy);
    expect(await A().submitAssignedTask(id)).toBe('sent');
    expect(tasksOf(ids.Billy).find((t) => t.id === id)).toMatchObject({ status: 'pending' });
  });
});

describe('the child\'s own tasks, streaks, tokens and every saved record are untouched', () => {
  test('assigning and handing in change no personal task, token, pet or journal record, and the personal counts do not move', async () => {
    const { app, ids } = await bootFamily();
    const personal = [{ id: 'p1', text: 'My own', category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: true, completedAt: '2026-03-10T16:00:00.000Z' }];
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify(personal));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tokenEarnings'), JSON.stringify({ startedAt: '2026-03-01T00:00:00.000Z', events: [] }));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'journal'), JSON.stringify([]));
    await app.AsyncStorage.setItem(`${P}tasks`, JSON.stringify([{ id: 'm1', text: 'Main task' }]));
    await flush();
    const keysBefore = new Map((await app.dump()).entries());
    const id = await assign(ids.Billy, 'Assigned one', 'gym');
    await enter(app, ids.Billy);
    expect(await A().submitAssignedTask(id)).toBe('sent');
    await flush();
    const after = await app.dump();
    for (const key of [scoped(ids.Billy, 'tasks'), scoped(ids.Billy, 'tokenEarnings'), scoped(ids.Billy, 'journal'), `${P}tasks`, scoped(ids.Sarah, 'tasks')]) {
      expect([key, after.get(key)]).toEqual([key, keysBefore.get(key)]);
    }
    expect([...after.keys()].filter((key) => /awardedTaskTokens|tokenEarnings/.test(key) && !keysBefore.has(key))).toEqual([]); // nothing was paid or logged
    // the child's own task list and its completed count: still exactly the one personal task
    const tasks = await app.taskStorage.getCachedTasks();
    expect(app.tasks.getCompletedTaskCount(tasks)).toBe(1);
    expect(tasks.map((t) => t.text)).toEqual(['My own']);
    expect(await app.history.getTokenHistory()).toMatchObject({ events: [] });
  });

  test('the Parent Dashboard\'s "Assigned by you" numbers (Step 2) are unchanged: assigned tasks stay a separate list', async () => {
    const { ids } = await bootFamily();
    await assign(ids.Billy, 'Wash the car', 'kitchen');
    const { readChildActivity } = require('@/utils/child-activity') as typeof import('@/utils/child-activity');
    const result = await readChildActivity(ids.Billy);
    expect(result.status === 'ok' && result.assigned.total).toBe(1);
    expect(result.status === 'ok' && result.tasks).toEqual({ state: 'none' }); // no personal task was created
  });
});

describe('where the code may reach', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8').replace(/\/\/.*$/gm, '');

  test('the child-side screens read assignments only through the per-child reader, never the household itself', () => {
    for (const file of ['src/components/assigned-task-views.tsx', 'src/components/room-task-panel.tsx', 'src/components/room-detail-screen.tsx', 'src/app/index.tsx']) {
      expect([file, /@\/utils\/household'/.test(read(file))]).toEqual([file, false]);
    }
    const reader = read('src/utils/assigned-tasks.ts');
    expect(reader).toMatch(/profileId === MAIN_PROFILE_ID/);
    expect(reader).not.toMatch(/approveTask|sendTaskBack|deleteTask|addTask|updateChildSettings|setChildArchived|saveParentProfile/); // no parent-side action
    expect(reader).not.toMatch(/AsyncStorage|task-storage|paw-tokens|addToWallet|recordTokenEarning/); // no personal tasks, no payout
  });

  test('assigned tasks are not copied into the personal task list or the reward code (rewards are a later step)', () => {
    for (const file of ['src/utils/assigned-tasks.ts', 'src/components/assigned-task-views.tsx']) {
      expect([file, /persistCachedTasks|getCachedTasks|reconcilePawTokenEarnings|toggleTaskOccurrence|createTask/.test(read(file))]).toEqual([file, false]);
    }
  });
});
