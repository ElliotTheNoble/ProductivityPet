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
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/parent', useLocalSearchParams: () => mockState.params, Link: 'Link' }));

// The overview's "Assigned by you" and "Waiting for your approval" lead to that child's task list on the dashboard (select the child, scroll,
// light the task up), where Approve and Send back are right there. "Send back" is the parent's word; the child still sees "Try again".
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
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
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
const flat = (el: { props: { style?: unknown } }) => ReactNative.StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
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
const assign = async (childId: string, text: string) => {
  const r = await H().addTask(childId, text, 'parent', undefined, { reward: 5 });
  if (!r.ok || !r.id) throw new Error('not assigned');
  return r.id;
};
// Billy: one to do, two waiting for approval. Sarah: one waiting.
async function seed(app: App, ids: Record<string, string>) {
  const todo = await assign(ids.Billy, 'Billy to do');
  const w1 = await assign(ids.Billy, 'Billy waiting one');
  const w2 = await assign(ids.Billy, 'Billy waiting two');
  const sw = await assign(ids.Sarah, 'Sarah waiting');
  await enter(app, ids.Billy);
  await A().submitAssignedTask(w1);
  await A().submitAssignedTask(w2);
  await enter(app, ids.Sarah);
  await A().submitAssignedTask(sw);
  await enter(app, 'main');
  await app.gate.unlockParentArea(TEST_PIN);
  return { todo, w1, w2, sw };
}

describe('the dashboard: arrives at the right child, the right task, with Approve and Send back right there', () => {
  async function dashboard(app: App, params: Record<string, string>) {
    mockState.params = params;
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
  }

  test('opened for Sarah while Billy was selected: Sarah becomes the selected child and her list is shown; nobody starts playing', async () => {
    const { app, ids } = await boot();
    const ctx = await seed(app, ids);
    await H().selectChild(ids.Billy);
    const active = app.profiles.getActiveProfileId();
    await dashboard(app, { child: ids.Sarah, section: 'pending', task: ctx.sw, focus: '1' });
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Sarah);
    expect(words()).toContain("Sarah's Tasks");
    expect(words()).toContain('Sarah waiting');
    expect(words()).not.toContain('Billy waiting one');
    expect(app.profiles.getActiveProfileId()).toBe(active); // the active playing profile did not change
  });

  test('pending tasks are at the top of the list, with Approve and Send back on each; the to-do ones are underneath', async () => {
    const { app, ids } = await boot();
    const ctx = await seed(app, ids);
    await H().selectChild(ids.Billy);
    await dashboard(app, { child: ids.Billy, section: 'pending', focus: '1' });
    const text = words();
    expect(text.indexOf('Billy waiting one')).toBeLessThan(text.indexOf('Billy to do'));
    expect(text.indexOf('Billy waiting two')).toBeLessThan(text.indexOf('Billy to do'));
    expect(text.indexOf(en('hhWaiting'))).toBeLessThan(text.indexOf(en('hhToDo')));
    const names = RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
    for (const name of ['Billy waiting one', 'Billy waiting two']) {
      expect(names).toContain(`${en('approve')}: ${name}`);
      expect(names).toContain(`${en('sendBack')}: ${name}`);
    }
    expect(RNTL.screen.getByTestId('child-tasks-list')).toBeTruthy(); // the section the page scrolls to
    expect(ctx.todo).toBeTruthy();
  });

  test('the task that was tapped is lit for a moment (and only that one), then goes back to normal', async () => {
    const { app, ids } = await boot();
    const ctx = await seed(app, ids);
    await H().selectChild(ids.Billy);
    await dashboard(app, { child: ids.Billy, section: 'pending', task: ctx.w2, focus: '7' });
    expect(flat(RNTL.screen.getByTestId(`task-row-${ctx.w2}`)).backgroundColor).toBeTruthy();
    expect(flat(RNTL.screen.getByTestId(`task-row-${ctx.w1}`)).backgroundColor).toBeUndefined();
    await RNTL.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2700));
    });
    expect(flat(RNTL.screen.getByTestId(`task-row-${ctx.w2}`)).backgroundColor).toBeUndefined();
  });

  test('without a task, the whole list is lit instead; with no focus value nothing is lit or selected', async () => {
    const { app, ids } = await boot();
    await seed(app, ids);
    await H().selectChild(ids.Sarah);
    await dashboard(app, { child: ids.Billy, section: 'tasks', focus: '3' });
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Billy);
    expect(flat(RNTL.screen.getByTestId('child-tasks-list')).borderColor).toBeTruthy();
    await RNTL.cleanup();
    await H().selectChild(ids.Sarah);
    await dashboard(app, {}); // opened the ordinary way
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Sarah);
    expect((flat(RNTL.screen.getByTestId('child-tasks-list')) ?? {}).borderColor).toBeUndefined();
  });

  test('Send back works right there and keeps its behaviour: back to the child as To do / Try again, nothing paid; Approve works too', async () => {
    const { app, ids } = await boot();
    const ctx = await seed(app, ids);
    await H().selectChild(ids.Billy);
    await dashboard(app, { child: ids.Billy, section: 'pending', task: ctx.w1, focus: '2' });
    expect(en('sendBack')).toBe('Send back');
    expect(es('sendBack')).toBe('Devolver');
    await press(`${en('sendBack')}: Billy waiting one`);
    expect(task(ids.Billy, ctx.w1).status).toBe('assigned');
    expect(task(ids.Billy, ctx.w1).returnedAt).toEqual(expect.any(String));
    expect(A().assignedTasksFor(H().peekHousehold(), ids.Billy).find((v) => v.id === ctx.w1)!.state).toBe('sent-back'); // the child sees "Try again"
    expect(en('atSentBack')).toBe('Try again'); // child-facing wording is unchanged
    await press(`${en('approve')}: Billy waiting two`);
    expect(task(ids.Billy, ctx.w2).status).toBe('approved');
    expect(words()).not.toContain(`${en('approve')}: Billy waiting two`);
  });

  test('parent PIN protection: with the parent area locked a link changes nothing (the selection stays, nothing is approved or sent back)', async () => {
    const { app, ids } = await boot();
    const ctx = await seed(app, ids);
    await H().selectChild(ids.Billy);
    app.gate.lockParentArea();
    await dashboard(app, { child: ids.Sarah, section: 'pending', task: ctx.sw, focus: '9' });
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Billy); // not changed without the unlocked parent area
    await press(`${en('sendBack')}: Billy waiting one`).catch(() => undefined);
    expect(task(ids.Billy, ctx.w1).status).toBe('pending');
    // and the route itself is still behind the gate (source check)
    expect(code('src/app/parent.tsx')).toMatch(/ParentGate|ParentShell|parent-shell/);
  });

  test('an archived or unknown child in the link is ignored: the selection does not move', async () => {
    const { app, ids } = await boot();
    await seed(app, ids);
    await H().selectChild(ids.Billy);
    await H().setChildArchived(ids.Sarah, true);
    await dashboard(app, { child: ids.Sarah, section: 'tasks', focus: '4' });
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Billy);
    await RNTL.cleanup();
    await dashboard(app, { child: 'nobody', section: 'tasks', focus: '5' });
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Billy);
  });

  test('no extra screen: the dashboard itself scrolls (source check), and the page hands its scroller over', () => {
    const dash = code('src/components/parent-dashboard.tsx');
    expect(dash).toMatch(/measureLayout/);
    expect(dash).toMatch(/scrollTo\(\{ y: Math\.max\(0, y - Spacing\.three\), animated: true \}\)/);
    expect(dash).toMatch(/scrollerRef=\{scrollerRef\}/);
    expect(code('src/components/family-ui.tsx')).toMatch(/scrollerRef\.current = scrollRef\.current/);
    expect(code('src/components/child-activity-sections.tsx')).not.toMatch(/approveTask|sendTaskBack|markTaskDone/); // the overview itself approves nothing
  });
});
