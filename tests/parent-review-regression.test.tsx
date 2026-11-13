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
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/parent', useLocalSearchParams: () => ({}), Link: 'Link' }));

// Samsung bugs: (1) the Approve / Send back buttons were missing in Family Settings; (2) "Needs approval" said 0 with tasks waiting.
// Both mean the screen did not see a task that is saved as waiting. These tests follow a hand-in all the way (the child's own button, a profile
// switch, the parent's screens opened again) and cover what could keep a screen from seeing it.
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
const R = () => require('@/utils/household-rewards') as typeof import('@/utils/household-rewards');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const labels = () => RNTL.screen.queryAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
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
const press = async (name: string | RegExp) => {
  await RNTL.fireEvent.press(RNTL.screen.getAllByRole('button', { name })[0]);
  await settle();
};
const enter = async (app: App, id: string) => expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
const child = (id: string) => H().peekHousehold()!.children.find((c) => c.id === id)!;
const task = (childId: string, id: string) => child(childId).tasks.find((t) => t.id === id)!;

async function boot() {
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
  return { app, ids };
}
const assign = async (childId: string, text: string, reward = 5) => {
  const r = await H().addTask(childId, text, 'parent', undefined, { reward });
  if (!r.ok || !r.id) throw new Error('not assigned');
  return r.id;
};
const Dashboard = () => (require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard')).ParentDashboard;
async function openDashboard(childId: string) {
  await H().selectChild(childId);
  const D = Dashboard();
  await RNTL.render(<D />);
  await settle();
}
// The summary card as the Parent Dashboard draws it, from a snapshot read when the overview was opened.
async function openSummary(childId: string) {
  const { readChildActivity } = require('@/utils/child-activity') as typeof import('@/utils/child-activity');
  const activity = await readChildActivity(childId, new Date());
  if (activity.status !== 'ok') throw new Error(`overview: ${activity.status}`);
  const { ChildTasksSection } = require('@/components/child-activity-sections') as typeof import('@/components/child-activity-sections');
  await RNTL.render(<ChildTasksSection activity={activity} />);
  await settle();
}
const needsApproval = () => Number(words().match(/Needs approval \((\d+)\)/)![1]);

describe('bug 1 and 2 end to end: the child\'s own button, a profile switch, the parent\'s screens (and again)', () => {
  test('Billy taps "I did it!" (approval required): Waiting, then in Family Settings Approve and Send back are there, and the summary says 1', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Task X');
    await enter(app, ids.Billy);
    const { AssignedAllTasks } = require('@/components/assigned-task-views') as typeof import('@/components/assigned-task-views');
    await RNTL.render(<AssignedAllTasks />);
    await settle();
    await press(en('atDoneFor', { task: 'Task X' })); // the child's own button
    expect(task(ids.Billy, id).status).toBe('pending'); // saved as waiting
    expect(child(ids.Billy).settings.requireApproval).toBe(true);
    expect(A().assignedTasksFor(H().peekHousehold(), ids.Billy)[0].state).toBe('waiting');
    await RNTL.cleanup();
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await openDashboard(ids.Billy);
    expect(labels()).toContain(`${en('approve')}: Task X`);
    expect(labels()).toContain(`${en('sendBack')}: Task X`);
    expect(words()).toContain(en('waitingForApproval'));
    await RNTL.cleanup();
    await openSummary(ids.Billy);
    expect(needsApproval()).toBe(1);
  });

  test('profile switching and reopening the dashboard: Billy\'s count is Billy\'s, Sarah\'s is Sarah\'s, the buttons stay, nothing is lost', async () => {
    const { app, ids } = await boot();
    const b1 = await assign(ids.Billy, 'Billy one');
    const b2 = await assign(ids.Billy, 'Billy two');
    const s1 = await assign(ids.Sarah, 'Sarah one');
    await enter(app, ids.Billy);
    await A().submitAssignedTask(b1);
    await A().submitAssignedTask(b2);
    await enter(app, ids.Sarah);
    await A().submitAssignedTask(s1);
    for (let round = 0; round < 3; round += 1) {
      await enter(app, round % 2 === 0 ? ids.Billy : 'main'); // back and forth between profiles
      await enter(app, 'main');
      await app.gate.unlockParentArea(TEST_PIN);
      await openSummary(ids.Billy);
      expect(needsApproval()).toBe(2);
      await RNTL.cleanup();
      await openSummary(ids.Sarah);
      expect(needsApproval()).toBe(1);
      await RNTL.cleanup();
      await openDashboard(ids.Billy); // reopened every round
      expect(words()).toContain("Billy's Tasks");
      expect(labels()).toContain(`${en('approve')}: Billy one`);
      expect(labels()).not.toContain(`${en('approve')}: Sarah one`);
      await RNTL.cleanup();
    }
    await openDashboard(ids.Sarah);
    expect(labels()).toContain(`${en('approve')}: Sarah one`);
    expect(labels()).not.toContain(`${en('approve')}: Billy one`);
  });

  test('To do tasks show no approval controls; Approve pays once; Send back pays nothing; only the parent area (PIN) can do either', async () => {
    const { app, ids } = await boot();
    const waiting = await assign(ids.Billy, 'Waiting');
    const back = await assign(ids.Billy, 'Back');
    await assign(ids.Billy, 'Still to do');
    await enter(app, ids.Billy);
    await A().submitAssignedTask(waiting);
    await A().submitAssignedTask(back);
    await app.family.ensureFamilyLoaded();
    const start = app.family.getWalletBalance();
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await openDashboard(ids.Billy);
    expect(labels()).not.toContain(`${en('approve')}: Still to do`);
    expect(labels()).not.toContain(`${en('sendBack')}: Still to do`);
    await press(`${en('sendBack')}: Back`);
    expect(task(ids.Billy, back).status).toBe('assigned');
    await press(`${en('approve')}: Waiting`);
    expect(task(ids.Billy, waiting).status).toBe('approved');
    await enter(app, ids.Billy);
    expect(await R().collectHouseholdRewards()).toBe(5); // once, only for the approved one
    expect(await R().collectHouseholdRewards()).toBe(0); // never twice
    expect(app.family.getWalletBalance()).toBe(start + 5);
    // locked: no review at all
    await enter(app, ids.Billy);
    await A().submitAssignedTask(back);
    await enter(app, 'main');
    app.gate.lockParentArea();
    expect((await H().approveTask(ids.Billy, back)).ok).toBe(false);
    expect((await H().sendTaskBack(ids.Billy, back)).ok).toBe(false);
    expect(task(ids.Billy, back).status).toBe('pending');
  });
});

describe('what could keep a screen from seeing a task that IS saved as waiting', () => {
  // Another copy of the app (a second browser tab, or an older copy of this module in a development build) saves a hand-in; this copy's memory
  // does not hear about it. Simulated by writing the saved record directly, one revision newer than the copy in memory.
  async function saveBehindItsBack(app: App, childId: string, taskId: string) {
    const raw = JSON.parse((await app.AsyncStorage.getItem('@ProductivityPet:household'))!);
    for (const c of raw.children) {
      if (c.id !== childId) continue;
      c.tasks = c.tasks.map((t: { id: string; status: string }) => (t.id === taskId ? { ...t, status: 'pending', submittedAt: new Date().toISOString() } : t));
    }
    await app.AsyncStorage.setItem('@ProductivityPet:household', JSON.stringify({ ...raw, revision: (raw.revision ?? 0) + 1 }));
  }

  test('Family Settings opened with an older copy in memory shows the saved waiting task, with Approve and Send back (bug 1)', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Handed in elsewhere');
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    expect(task(ids.Billy, id).status).toBe('assigned'); // memory: still to do
    await saveBehindItsBack(app, ids.Billy, id); // storage: waiting
    expect(task(ids.Billy, id).status).toBe('assigned');
    await openDashboard(ids.Billy);
    await settle();
    expect(task(ids.Billy, id).status).toBe('pending'); // the screen looked at what is saved
    expect(labels()).toContain(`${en('approve')}: Handed in elsewhere`);
    expect(labels()).toContain(`${en('sendBack')}: Handed in elsewhere`);
    // and the review then works on the saved record without a conflict
    await press(`${en('approve')}: Handed in elsewhere`);
    expect(task(ids.Billy, id).status).toBe('approved');
  });

  test('the "Needs approval" summary opened before the hand-in says 0, then follows the saved record to 1 without being reopened (bug 2)', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Late hand-in');
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await openSummary(ids.Billy); // a snapshot with nothing waiting
    expect(needsApproval()).toBe(0);
    await saveBehindItsBack(app, ids.Billy, id);
    await RNTL.act(async () => {
      expect(await H().refreshHousehold()).toBe(true); // what the screens do when they open or the app returns
    });
    await settle();
    expect(needsApproval()).toBe(1); // the live record, not the snapshot
  });

  test('refreshing is serialized with changes and reads only: it never loses or invents a task, and a record that cannot be read leaves memory as it was', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Safe');
    await enter(app, 'main');
    const before = JSON.stringify(H().peekHousehold());
    const results = await Promise.all([H().refreshHousehold(), H().refreshHousehold(), H().refreshHousehold()]);
    expect(results).toEqual([true, true, true]);
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
    const realGet = app.AsyncStorage.getItem.bind(app.AsyncStorage);
    jest.spyOn(app.AsyncStorage, 'getItem').mockImplementation((async (key: string) => {
      if (key === '@ProductivityPet:household') throw new Error('unreadable');
      return realGet(key);
    }) as never);
    expect(await H().refreshHousehold()).toBe(false);
    expect(task(ids.Billy, id).text).toBe('Safe');
  });

  test('the dashboard and the overview open by looking at the saved record, and again when the app returns (source check)', () => {
    expect(code('src/components/parent-dashboard.tsx')).toMatch(/useFreshHousehold\(\)/);
    expect(code('src/components/parent-home.tsx')).toMatch(/useFreshHousehold\(\)/);
    const hook = code('src/hooks/use-fresh-household.ts');
    expect(hook).toMatch(/refreshHousehold\(\)/);
    expect(hook).toMatch(/AppState\.addEventListener\('change'/);
  });
});

describe('the summary count follows every change at once, from the same data as Family Settings', () => {
  test('hand-in, Undo, resubmission, approval, send back: N changes immediately, for the selected child only', async () => {
    const { app, ids } = await boot();
    const a = await assign(ids.Billy, 'A');
    const b = await assign(ids.Billy, 'B');
    const s = await assign(ids.Sarah, 'S');
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await openSummary(ids.Billy);
    expect(needsApproval()).toBe(0);
    await RNTL.act(async () => {
      await enter(app, ids.Billy);
    });
    await RNTL.act(async () => {
      await A().submitAssignedTask(a);
    });
    expect(needsApproval()).toBe(1); // handed in
    await RNTL.act(async () => {
      await A().submitAssignedTask(b);
    });
    expect(needsApproval()).toBe(2);
    await RNTL.act(async () => {
      await A().undoAssignedTask(b);
    });
    expect(needsApproval()).toBe(1); // Undo
    await RNTL.act(async () => {
      await A().submitAssignedTask(b); // resubmitted
    });
    expect(needsApproval()).toBe(2);
    await RNTL.act(async () => {
      await enter(app, 'main');
      await app.gate.unlockParentArea(TEST_PIN);
      await H().approveTask(ids.Billy, a);
    });
    expect(needsApproval()).toBe(1); // approved: out of the count
    await RNTL.act(async () => {
      await H().sendTaskBack(ids.Billy, b);
    });
    expect(needsApproval()).toBe(0); // sent back: back with the child as to do
    expect(task(ids.Billy, b).status).toBe('assigned');
    // Sarah's hand-in never counts for Billy
    await RNTL.act(async () => {
      await enter(app, ids.Sarah);
      await A().submitAssignedTask(s);
      await enter(app, 'main');
      await app.gate.unlockParentArea(TEST_PIN);
    });
    expect(needsApproval()).toBe(0);
  });

  test('ONE definition: Family Settings\' waiting list and the summary both use tasksWaitingForApproval (source check) and always agree', async () => {
    const { app, ids } = await boot();
    const ids2: string[] = [];
    for (const name of ['One', 'Two', 'Three', 'Four']) ids2.push(await assign(ids.Billy, name));
    await enter(app, ids.Billy);
    await A().submitAssignedTask(ids2[0]);
    await A().submitAssignedTask(ids2[1]);
    await A().submitAssignedTask(ids2[2]);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await H().approveTask(ids.Billy, ids2[0]);
    await H().sendTaskBack(ids.Billy, ids2[1]);
    const billy = child(ids.Billy);
    expect(H().tasksWaitingForApproval(billy).map((t) => t.id)).toEqual([ids2[2]]);
    expect(H().tasksByStatus(billy).pending).toEqual(H().tasksWaitingForApproval(billy));
    expect(H().tasksWaitingForApproval(null)).toEqual([]);
    expect(code('src/components/child-activity-sections.tsx')).toMatch(/tasksWaitingForApproval\(live\)\.length/);
  });
});

describe('the other way a hand-in is not "waiting": the approval setting is Off', () => {
  test('with "Completion needs my approval" Off a hand-in finishes at once: it is never waiting, so no buttons and a count of 0; turning it On makes new hand-ins wait', async () => {
    const { app, ids } = await boot();
    await H().updateChildSettings(ids.Billy, { requireApproval: false });
    const id = await assign(ids.Billy, 'No review needed');
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    expect(task(ids.Billy, id).status).toBe('completed'); // not 'pending'
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await openDashboard(ids.Billy);
    expect(labels()).not.toContain(`${en('approve')}: No review needed`);
    await RNTL.cleanup();
    await openSummary(ids.Billy);
    expect(needsApproval()).toBe(0);
    await RNTL.cleanup();
    await H().updateChildSettings(ids.Billy, { requireApproval: true });
    const next = await assign(ids.Billy, 'Needs review');
    await enter(app, ids.Billy);
    await A().submitAssignedTask(next);
    expect(task(ids.Billy, next).status).toBe('pending');
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await openSummary(ids.Billy);
    expect(needsApproval()).toBe(1);
  });

  test('a development line says what Family Settings found for the child (counts and the approval setting, never a task title)', async () => {
    const { app, ids } = await boot();
    const logs: string[] = [];
    jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    const id = await assign(ids.Billy, 'Secret chore title');
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await openDashboard(ids.Billy);
    const line = logs.find((l) => l.startsWith('[reward-trace] review:read'));
    expect(line).toContain('"pending":1');
    expect(line).toContain('"requireApproval":true');
    expect(logs.join('\n')).not.toContain('Secret chore title');
  });
});
