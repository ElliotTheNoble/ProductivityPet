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
const mockState = { params: {} as Record<string, string> };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/dashboard', useLocalSearchParams: () => mockState.params, Link: 'Link' }));

// "Tasks assigned by you" is a compact summary: the heading and ONE button, "Needs approval (N)", where N counts only tasks the child handed in
// and the parent has not looked at. The outer card still opens the child's whole task list.
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => {
  freezeClock(T0);
  mockRouter.push.mockClear();
  mockState.params = {};
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
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const flat = (el: { props: { style?: unknown } }) => (ReactNative.StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;
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
const task = (childId: string, id: string) => H().peekHousehold()!.children.find((c) => c.id === childId)!.tasks.find((t) => t.id === id)!;

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
const assign = async (childId: string, text: string, reward = 5) => {
  const r = await H().addTask(childId, text, 'parent', undefined, { reward });
  if (!r.ok || !r.id) throw new Error('not assigned');
  return r.id;
};
async function overview(childId: string) {
  const { readChildActivity } = require('@/utils/child-activity') as typeof import('@/utils/child-activity');
  const result = await readChildActivity(childId, new Date());
  if (result.status !== 'ok') throw new Error(`overview: ${result.status}`);
  const { ChildTasksSection } = require('@/components/child-activity-sections') as typeof import('@/components/child-activity-sections');
  await RNTL.render(<ChildTasksSection activity={result} />);
  await settle();
}
// Billy: 2 handed in (waiting), 1 to do, 1 sent back, 1 approved. Sarah: 1 waiting.
async function seed(app: App, ids: Record<string, string>) {
  const w1 = await assign(ids.Billy, 'Waiting one');
  const w2 = await assign(ids.Billy, 'Waiting two');
  const todo = await assign(ids.Billy, 'Still to do');
  const back = await assign(ids.Billy, 'Sent back one');
  const done = await assign(ids.Billy, 'Approved one');
  const sw = await assign(ids.Sarah, 'Sarah waiting');
  await enter(app, ids.Billy);
  for (const id of [w1, w2, back, done]) await A().submitAssignedTask(id);
  await enter(app, ids.Sarah);
  await A().submitAssignedTask(sw);
  await enter(app, 'main');
  await app.gate.unlockParentArea(TEST_PIN);
  await H().sendTaskBack(ids.Billy, back);
  await H().approveTask(ids.Billy, done);
  return { w1, w2, todo, back, done, sw };
}

describe('the compact card', () => {
  test('the heading and ONE button, "Needs approval (N)": no task names, no To do or Approved lists', async () => {
    const { app, ids } = await boot();
    await seed(app, ids);
    await overview(ids.Billy);
    const text = words();
    expect(text).toContain(en('paAssignedTitle'));
    expect(text).toContain('Needs approval (2)');
    for (const hidden of ['Waiting one', 'Waiting two', 'Still to do', 'Sent back one', 'Approved one']) expect(text).not.toContain(hidden);
    expect(text).not.toMatch(/To do \(|Approved \(|Done \(/);
    expect(RNTL.screen.queryByTestId('assigned-open-assigned')).toBeNull();
    // exactly two controls: the whole card, and Needs approval
    expect(RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel))).toEqual([en('paOpenTasks', { name: 'Billy' }), en('paOpenPending', { name: 'Billy', count: 2 })]);
  });

  test('N counts ONLY what the child handed in: not to do, not approved, not sent back; it follows each change', async () => {
    const { app, ids } = await boot();
    const ctx = await seed(app, ids);
    const count = async () => {
      await RNTL.cleanup();
      await overview(ids.Billy);
      return words().match(/Needs approval \((\d+)\)/)![1];
    };
    expect(await count()).toBe('2'); // to do (1), sent back (1) and approved (1) are not in it
    await H().approveTask(ids.Billy, ctx.w1);
    expect(await count()).toBe('1');
    await H().sendTaskBack(ids.Billy, ctx.w2);
    expect(await count()).toBe('0');
    await enter(app, ids.Billy);
    await A().submitAssignedTask(ctx.todo); // a new hand-in counts
    await A().submitAssignedTask(ctx.back); // a resubmission after "sent back" counts again
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    expect(await count()).toBe('2');
    await enter(app, ids.Billy);
    await A().undoAssignedTask(ctx.todo); // an Undo takes it out again
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    expect(await count()).toBe('1');
  });

  test('another child has its own count; none waiting shows "Needs approval (0)" and no task list', async () => {
    const { app, ids } = await boot();
    await seed(app, ids);
    await overview(ids.Sarah);
    expect(words()).toContain('Needs approval (1)');
    expect(words()).not.toContain('Sarah waiting');
    await RNTL.cleanup();
    const { app: app2, ids: ids2 } = await boot();
    await assign(ids2.Sarah, 'Only to do');
    await enter(app2, 'main');
    await app2.gate.unlockParentArea(TEST_PIN);
    await overview(ids2.Sarah);
    expect(words()).toContain('Needs approval (0)');
    expect(words()).not.toContain('Only to do');
    expect(RNTL.screen.getByTestId('assigned-open-pending')).toBeTruthy(); // the button is there even at zero
  });

  test('Spanish', async () => {
    const { app, ids } = await boot('es');
    await seed(app, ids);
    await overview(ids.Billy);
    expect(words()).toContain('Necesita aprobación (2)');
    expect(RNTL.screen.getByTestId('assigned-open-pending').props.accessibilityLabel).toBe(es('paOpenPending', { name: 'Billy', count: 2 }));
    expect(es('paAssignedTitle')).toBe('Tareas asignadas por ti');
  });
});

describe('navigation from the card', () => {
  test('"Needs approval" opens Family Settings on THAT child, at the pending approvals; the outer card opens the complete list', async () => {
    const { app, ids } = await boot();
    await seed(app, ids);
    await overview(ids.Billy);
    const button = RNTL.screen.getByTestId('assigned-open-pending');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe(en('paOpenPending', { name: 'Billy', count: 2 }));
    await RNTL.fireEvent.press(button);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/parent', params: { child: ids.Billy, section: 'pending', focus: expect.any(String) } });
    mockRouter.push.mockClear();
    const card = RNTL.screen.getByTestId('assigned-open-tasks');
    expect(card.props.accessibilityLabel).toBe(en('paOpenTasks', { name: 'Billy' }));
    await RNTL.fireEvent.press(card);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/parent', params: { child: ids.Billy, section: 'tasks', focus: expect.any(String) } });
    expect(JSON.stringify(mockRouter.push.mock.calls)).not.toContain(ids.Sarah);
  });

  test('no nested touch targets: the button is a sibling of the whole-card control, not inside it', async () => {
    const { app, ids } = await boot();
    await seed(app, ids);
    await overview(ids.Billy);
    const card = RNTL.screen.getByTestId('assigned-open-tasks');
    expect(RNTL.within(card).queryAllByRole('button')).toEqual([]);
    const inside = (node: { parent: unknown }, target: unknown): boolean => {
      for (let n = node as { parent: unknown } | null; n; n = n.parent as { parent: unknown } | null) if (n === target) return true;
      return false;
    };
    expect(inside(RNTL.screen.getByTestId('assigned-open-pending') as never, card)).toBe(false);
  });

  test('the card changes nothing by itself and starts nobody playing', async () => {
    const { app, ids } = await boot();
    await seed(app, ids);
    const before = JSON.stringify(H().peekHousehold());
    const active = app.profiles.getActiveProfileId();
    await overview(ids.Billy);
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('assigned-open-pending'));
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('assigned-open-tasks'));
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
    expect(app.profiles.getActiveProfileId()).toBe(active);
  });
});

describe('arriving at the pending approvals in Family Settings', () => {
  async function dashboard(params: Record<string, string>) {
    mockState.params = params;
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
  }

  test('the child is selected, the pending approvals are shown in full at the top, with Approve and Send back, and that section (only) is lit for a moment', async () => {
    const { app, ids } = await boot();
    const ctx = await seed(app, ids);
    await H().selectChild(ids.Sarah); // someone else was selected
    await dashboard({ child: ids.Billy, section: 'pending', focus: '5' });
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Billy);
    const text = words();
    expect(text).toContain("Billy's Tasks");
    expect(text.indexOf('Waiting one')).toBeLessThan(text.indexOf('Still to do')); // pending first
    // full task information is there (status line and reward), and both actions
    expect(RNTL.screen.getByTestId(`reward-line-${ctx.w1}`)).toBeTruthy();
    expect(text).toContain(en('waitingForApproval'));
    const names = RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
    for (const name of ['Waiting one', 'Waiting two']) {
      expect(names).toContain(`${en('approve')}: ${name}`);
      expect(names).toContain(`${en('sendBack')}: ${name}`);
    }
    // the pending block is lit, the rest of the list is not
    expect(flat(RNTL.screen.getByTestId('pending-approvals')).borderColor).toBeTruthy();
    expect(flat(RNTL.screen.getByTestId('child-tasks-list')).borderColor).toBeUndefined();
    await RNTL.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2700));
    });
    expect(flat(RNTL.screen.getByTestId('pending-approvals')).borderColor).toBeUndefined();
  });

  test('the outer card\'s link lights the whole list (To do included); opened any other way nothing is lit', async () => {
    const { app, ids } = await boot();
    await seed(app, ids);
    await dashboard({ child: ids.Billy, section: 'tasks', focus: '6' });
    expect(flat(RNTL.screen.getByTestId('child-tasks-list')).borderColor).toBeTruthy();
    expect(words()).toContain('Still to do');
    await RNTL.cleanup();
    await dashboard({});
    expect(flat(RNTL.screen.getByTestId('child-tasks-list')).borderColor).toBeUndefined();
    expect(flat(RNTL.screen.getByTestId('pending-approvals')).borderColor).toBeUndefined();
  });

  test('with nothing waiting, "Needs approval (0)" still leads to the list (lit as a whole, since there is no pending part)', async () => {
    const { app, ids } = await boot();
    await assign(ids.Sarah, 'Only to do');
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await dashboard({ child: ids.Sarah, section: 'pending', focus: '7' });
    expect(RNTL.screen.queryByTestId('pending-approvals')).toBeNull();
    expect(flat(RNTL.screen.getByTestId('child-tasks-list')).borderColor).toBeTruthy();
  });

  test('Approve and Send back work right there, rewards are paid as before, and the count follows', async () => {
    const { app, ids } = await boot();
    const ctx = await seed(app, ids);
    await H().selectChild(ids.Billy);
    await dashboard({ child: ids.Billy, section: 'pending', focus: '8' });
    await press(`${en('sendBack')}: Waiting two`);
    expect(task(ids.Billy, ctx.w2).status).toBe('assigned');
    await enter(app, ids.Billy);
    await app.family.ensureFamilyLoaded();
    const start = app.family.getWalletBalance();
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await RNTL.cleanup();
    await dashboard({ child: ids.Billy, section: 'pending', focus: '9' });
    await press(`${en('approve')}: Waiting one`);
    expect(task(ids.Billy, ctx.w1).status).toBe('approved');
    await enter(app, ids.Billy);
    expect(await R().collectHouseholdRewards()).toBe(10); // Waiting one (5) and the earlier approved task (5): the payout is unchanged
    expect(app.family.getWalletBalance()).toBe(start + 10);
  });

  test('parent PIN protection: with the parent area locked the link changes no selection and nothing can be approved', async () => {
    const { app, ids } = await boot();
    const ctx = await seed(app, ids);
    await H().selectChild(ids.Sarah);
    app.gate.lockParentArea();
    await dashboard({ child: ids.Billy, section: 'pending', focus: '10' });
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Sarah);
    expect((await H().approveTask(ids.Billy, ctx.w1)).ok).toBe(false);
    expect(task(ids.Billy, ctx.w1).status).toBe('pending');
    expect(code('src/app/parent.tsx')).toMatch(/ParentGate|ParentShell|parent-shell/);
  });

  test('existing statuses and saved data are untouched, and the source shows the summary is only a count (source check)', async () => {
    const { app, ids } = await boot();
    await seed(app, ids);
    const before = JSON.stringify(H().peekHousehold()!.children.map((c) => c.tasks));
    await overview(ids.Billy);
    expect(JSON.stringify(H().peekHousehold()!.children.map((c) => c.tasks))).toBe(before);
    const source = code('src/components/child-activity-sections.tsx');
    expect(source).toMatch(/activity\.assigned\.byStatus\.pending\.length/);
    expect(source).not.toMatch(/byStatus\.(assigned|approved|completed)/);
    expect(source).not.toMatch(/approveTask|sendTaskBack|markTaskDone/);
  });
});
