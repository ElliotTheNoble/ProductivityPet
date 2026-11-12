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
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/', Link: 'Link' }));

// Undo: a child takes back a hand-in the parent has not looked at yet. Only while pending; never after an approval; never someone else's;
// never anything about rewards or Paw Tokens; counts and statuses follow at once.
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
const task = (childId: string, taskId: string) => H().peekHousehold()!.children.find((c) => c.id === childId)!.tasks.find((t) => t.id === taskId)!;
const stateOf = (childId: string, taskId: string) => A().assignedTasksFor(H().peekHousehold(), childId).find((v) => v.id === taskId)?.state;
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

describe('what undo restores', () => {
  test('an original hand-in goes back to "to do"; a hand-in after being sent back goes back to "sent back"', async () => {
    const { app, ids } = await boot();
    const first = await assign(ids.Billy, 'First', 'gym');
    const second = await assign(ids.Billy, 'Second', 'gym');
    await H().markTaskDone(ids.Billy, second);
    await H().sendTaskBack(ids.Billy, second);
    await app.profiles.switchProfile(ids.Billy);
    expect(await A().submitAssignedTask(first)).toBe('sent');
    expect(stateOf(ids.Billy, first)).toBe('waiting');
    expect(await A().undoAssignedTask(first)).toBe('undone');
    expect(stateOf(ids.Billy, first)).toBe('to-do');
    expect(await A().submitAssignedTask(second)).toBe('sent');
    expect(stateOf(ids.Billy, second)).toBe('waiting');
    expect(await A().undoAssignedTask(second)).toBe('undone');
    expect(stateOf(ids.Billy, second)).toBe('sent-back');
    // the task is the same single record, with its room, and nothing is left over from the hand-in
    expect(task(ids.Billy, first)).toMatchObject({ status: 'assigned', room: 'gym' });
    expect(task(ids.Billy, first).submittedAt).toBeUndefined();
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks).toHaveLength(2);
  });

  test('hand in, undo and hand in again works any number of times, and a sent-back task after that is still "sent back"', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Again and again', 'bedroom');
    await app.profiles.switchProfile(ids.Billy);
    for (let i = 0; i < 3; i += 1) {
      expect(await A().submitAssignedTask(id)).toBe('sent');
      expect(await A().undoAssignedTask(id)).toBe('undone');
      expect(stateOf(ids.Billy, id)).toBe('to-do');
    }
    expect(await A().submitAssignedTask(id)).toBe('sent');
    expect(stateOf(ids.Billy, id)).toBe('waiting');
  });
});

describe('when undo is refused, and nothing changes', () => {
  test('after the parent approved it: refused, still approved', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Approved one', 'kitchen');
    await app.profiles.switchProfile(ids.Billy);
    await A().submitAssignedTask(id);
    await app.gate.unlockParentArea(TEST_PIN);
    expect(await H().approveTask(ids.Billy, id)).toMatchObject({ ok: true });
    const before = JSON.stringify(H().peekHousehold());
    expect(await A().undoAssignedTask(id)).toBe('not-yours'); // an approved task is finished: no longer the child's to take back
    expect(await H().undoTaskSubmission(ids.Billy, id)).toEqual({ ok: false, reason: 'wrong-state' });
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
    expect(task(ids.Billy, id).status).toBe('approved');
  });

  test('when no approval is needed the hand-in completes at once, and there is nothing to undo', async () => {
    const { app, ids } = await boot();
    await H().updateChildSettings(ids.Billy, { requireApproval: false });
    const id = await assign(ids.Billy, 'Quick', 'kitchen');
    await app.profiles.switchProfile(ids.Billy);
    expect(await A().submitAssignedTask(id)).toBe('sent');
    expect(await A().undoAssignedTask(id)).toBe('not-yours');
    expect(task(ids.Billy, id).status).toBe('completed');
  });

  test('a task that was never handed in: nothing to undo', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Untouched', 'gym');
    await app.profiles.switchProfile(ids.Billy);
    expect(await A().undoAssignedTask(id)).toBe('too-late');
    expect(task(ids.Billy, id).status).toBe('assigned');
  });

  test('another child\'s task, an unknown task, Main and nobody-open: refused', async () => {
    const { app, ids } = await boot();
    const hers = await assign(ids.Sarah, 'Sarah\'s', 'gym');
    await H().markTaskDone(ids.Sarah, hers); // pending
    await app.profiles.switchProfile(ids.Billy);
    const before = JSON.stringify(H().peekHousehold());
    expect(await A().undoAssignedTask(hers)).toBe('not-yours');
    expect(await A().undoAssignedTask('no-such-task')).toBe('not-yours');
    await app.profiles.switchProfile('main');
    expect(await A().undoAssignedTask(hers)).toBe('not-yours');
    await app.profiles.releaseActiveProfile();
    expect(await A().undoAssignedTask(hers)).toBe('not-yours');
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
    expect(task(ids.Sarah, hers).status).toBe('pending');
  });

  test('undoing twice: the second does nothing', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Once', 'gym');
    await app.profiles.switchProfile(ids.Billy);
    await A().submitAssignedTask(id);
    const results = await Promise.all([A().undoAssignedTask(id), A().undoAssignedTask(id)]);
    expect(results.filter((r) => r === 'undone')).toHaveLength(1);
    expect(stateOf(ids.Billy, id)).toBe('to-do');
  });

  test('a hand-in twice at the same time: one hand-in', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Double tap', 'gym');
    await app.profiles.switchProfile(ids.Billy);
    const results = await Promise.all([A().submitAssignedTask(id), A().submitAssignedTask(id)]);
    expect(results.filter((r) => r === 'sent').length).toBeGreaterThanOrEqual(1);
    expect(stateOf(ids.Billy, id)).toBe('waiting');
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks).toHaveLength(1);
  });

  test('undo and the parent\'s approval at the same moment: exactly one wins, and the result is consistent', async () => {
    const { app, ids } = await boot();
    for (let round = 0; round < 6; round += 1) {
      const id = await assign(ids.Billy, `Race ${round}`, 'gym');
      await app.profiles.switchProfile(ids.Billy);
      await A().submitAssignedTask(id);
      await app.gate.unlockParentArea(TEST_PIN);
      const [undone, approved] = await Promise.all([A().undoAssignedTask(id), H().approveTask(ids.Billy, id)]);
      const undoWon = undone === 'undone';
      const approveWon = approved.ok;
      expect(undoWon !== approveWon).toBe(true); // never both, never neither
      expect(task(ids.Billy, id).status).toBe(approveWon ? 'approved' : 'assigned');
      await app.profiles.switchProfile('main');
    }
  });
});

describe('rewards and Paw Tokens are never touched', () => {
  test('hand in, undo, hand in and approval write no token, wallet, history or paid-tasks record', async () => {
    const { app, ids } = await boot();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tokenEarnings'), JSON.stringify({ startedAt: '2026-03-01T00:00:00.000Z', events: [] }));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'awardedTaskTokens'), JSON.stringify(['old']));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify([{ id: 'p1', text: 'mine', category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: false }]));
    const id = await assign(ids.Billy, 'Rewardless', 'gym');
    await flush();
    const before = new Map((await app.dump()).entries());
    await app.profiles.switchProfile(ids.Billy);
    await A().submitAssignedTask(id);
    await A().undoAssignedTask(id);
    await A().submitAssignedTask(id);
    await app.gate.unlockParentArea(TEST_PIN);
    await H().approveTask(ids.Billy, id);
    await flush();
    const after = await app.dump();
    for (const key of [scoped(ids.Billy, 'tokenEarnings'), scoped(ids.Billy, 'awardedTaskTokens'), scoped(ids.Billy, 'tasks'), scoped(ids.Sarah, 'tokenEarnings')]) {
      expect([key, after.get(key)]).toEqual([key, before.get(key)]);
    }
    expect([...after.keys()].filter((key) => /tokenEarnings|awardedTaskTokens|petFamily/.test(key) && !before.has(key))).toEqual([]);
    expect(await app.history.getTokenHistory()).toMatchObject({ events: [] });
  });

  test('the undo code cannot reach rewards or the personal task list (source check)', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8').replace(/\/\/.*$/gm, '');
    const reader = read('src/utils/assigned-tasks.ts');
    expect(reader).not.toMatch(/paw-tokens|token-history|addToWallet|recordTokenEarning|task-storage|pet-family|AsyncStorage/);
    const undo = read('src/utils/household.ts');
    const start = undo.indexOf('export async function undoTaskSubmission');
    const body = undo.slice(start, undo.indexOf('export async function approveTask', start));
    expect(body).toMatch(/task\.status !== 'pending'\) return \{ ok: false, reason: 'wrong-state' \}/);
    expect(body).not.toMatch(/approved|completed|Token|reward/i);
  });
});

describe('on screen: the button, the statuses and the counts follow at once', () => {
  test('the button stays in the same place: "I did it!" -> "Undo" -> "I did it!"; the state pill and the Home counts change with it', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Do some stretches', 'gym');
    await assign(ids.Billy, 'Other gym task', 'gym');
    await app.profiles.switchProfile(ids.Billy);
    const { AssignedRoomTasks, AssignedHomeRows } = views();
    await RNTL.render(
      <>
        <AssignedRoomTasks room="gym" />
        <AssignedHomeRows />
      </>
    );
    await settle();
    const labels = () => RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel)).filter((l) => /^(I did it|Undo): /.test(l));
    expect(labels().filter((l) => l.startsWith(en('atDoneFor', { task: '' }).split(':')[0]))).toHaveLength(2);
    expect(words()).toContain(en('atFromParentRoom', { room: 'Gym' })); // Home's rows
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atDoneFor', { task: 'Do some stretches' }) }));
    await settle();
    expect(labels()).toContain(en('atUndoFor', { task: 'Do some stretches' }));
    expect(labels()).not.toContain(en('atDoneFor', { task: 'Do some stretches' }));
    expect(words()).toContain(en('atWaiting'));
    expect(words()).toContain(en('atFromParentRoom', { room: 'Gym' })); // still listed
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atUndoFor', { task: 'Do some stretches' }) }));
    await settle();
    expect(labels()).toContain(en('atDoneFor', { task: 'Do some stretches' }));
    expect(labels().filter((l) => l.startsWith(en('atUndo'))).length).toBe(0);
    expect(task(ids.Billy, id).status).toBe('assigned');
  });

  test('a sent-back task shows "Try again" again after an undo', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Redo this', 'bedroom');
    await H().markTaskDone(ids.Billy, id);
    await H().sendTaskBack(ids.Billy, id);
    await app.profiles.switchProfile(ids.Billy);
    const { AssignedRoomTasks } = views();
    await RNTL.render(<AssignedRoomTasks room="bedroom" />);
    await settle();
    expect(words()).toContain(en('atSentBack'));
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atDoneFor', { task: 'Redo this' }) }));
    await settle();
    expect(words()).toContain(en('atWaiting'));
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: en('atUndoFor', { task: 'Redo this' }) }));
    await settle();
    expect(words()).toContain(en('atSentBack'));
    expect(words()).not.toContain(en('atWaiting'));
  });

  test('once the parent approved it, the task is gone from the child\'s list: no Undo to press', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Finished soon', 'kitchen');
    await app.profiles.switchProfile(ids.Billy);
    await A().submitAssignedTask(id);
    const { AssignedRoomTasks } = views();
    await RNTL.render(<AssignedRoomTasks room="kitchen" />);
    await settle();
    expect(RNTL.screen.getByRole('button', { name: en('atUndoFor', { task: 'Finished soon' }) })).toBeTruthy();
    await RNTL.act(async () => {
      await app.gate.unlockParentArea(TEST_PIN);
      await H().approveTask(ids.Billy, id);
    });
    await settle();
    expect(RNTL.screen.queryAllByRole('button')).toHaveLength(0);
    expect(words()).toBe('');
  });

  test('the same in Spanish', async () => {
    const { app, ids } = await boot('es');
    await assign(ids.Billy, 'Hacer la cama', 'bedroom');
    await app.profiles.switchProfile(ids.Billy);
    const { AssignedRoomTasks } = views();
    await RNTL.render(<AssignedRoomTasks room="bedroom" />);
    await settle();
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: es('atDoneFor', { task: 'Hacer la cama' }) }));
    await settle();
    expect(RNTL.screen.getByRole('button', { name: es('atUndoFor', { task: 'Hacer la cama' }) })).toBeTruthy();
    expect(words()).toContain(es('atUndo'));
    expect(es('atUndo')).not.toBe(en('atUndo'));
  });
});
