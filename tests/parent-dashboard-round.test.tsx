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

// Dashboard round: a vector icon, the whole "Tasks assigned by you" card opens the child's tasks, today-only approvals, shorter history wording,
// and the parent navigation stays Dashboard + Family Settings.
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
const enter = async (app: App, id: string) => expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });

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
// The child hands a task in; the parent approves it at `when` (local time).
const approveAt = async (app: App, childId: string, id: string, when: Date) => {
  await enter(app, childId);
  await A().submitAssignedTask(id);
  await enter(app, 'main');
  jest.setSystemTime(when);
  await app.gate.unlockParentArea(TEST_PIN);
  expect(await H().approveTask(childId, id)).toEqual({ ok: true });
};
async function overview(childId: string) {
  const { readChildActivity } = require('@/utils/child-activity') as typeof import('@/utils/child-activity');
  const result = await readChildActivity(childId, new Date());
  if (result.status !== 'ok') throw new Error(`overview: ${result.status}`);
  const { ChildTasksSection } = require('@/components/child-activity-sections') as typeof import('@/components/child-activity-sections');
  await RNTL.render(<ChildTasksSection activity={result} />);
  await settle();
  return result;
}

describe('a vector icon instead of the house emoji', () => {
  test('the Parent Dashboard header draws a shield-with-checkmark vector icon (the icon set the app already ships), hidden from screen readers; no emoji', async () => {
    const { app } = await boot();
    await enter(app, 'main');
    const { ParentHome } = require('@/components/parent-home') as typeof import('@/components/parent-home');
    await RNTL.render(<ParentHome />);
    await settle();
    const icon = RNTL.screen.getByTestId('parent-header-icon', { hidden: true });
    expect(icon.props.accessibilityElementsHidden).toBe(true);
    expect(icon.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(words()).not.toContain('🏡');
    const source = code('src/components/parent-home.tsx');
    expect(source).toMatch(/from '@expo\/vector-icons'/);
    expect(source).toMatch(/name="shield-checkmark"/);
    expect(source).not.toMatch(/🏡/);
    const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json') as Record<string, number>;
    expect(glyphs['shield-checkmark']).toBeDefined(); // a real glyph: draws the same on Android and the web
    expect(JSON.parse(read('package.json')).dependencies['@expo/vector-icons']).toBeDefined(); // nothing new was added
  });
});

describe('"Tasks assigned by you": the whole card opens the child\'s tasks', () => {
  test('the title is renamed in both languages', () => {
    expect(en('paAssignedTitle')).toBe('Tasks assigned by you');
    expect(es('paAssignedTitle')).toBe('Tareas asignadas por ti');
  });

  test('the target is the child\'s own task list on Family Settings, behind the parent PIN: the card changes nothing itself and starts nobody playing', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'A task');
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await overview(ids.Billy);
    const before = JSON.stringify(H().peekHousehold());
    const active = app.profiles.getActiveProfileId();
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('assigned-open-tasks'));
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
    expect(app.profiles.getActiveProfileId()).toBe(active);
    expect(code('src/app/parent.tsx')).toMatch(/ParentGate|ParentShell|parent-shell/); // the route the card opens is gated
    // arriving there selects the child, scrolls and highlights (covered in detail in parent-task-links.test.tsx)
    expect(code('src/components/parent-dashboard.tsx')).toMatch(/measureLayout/);
    expect(code('src/components/parent-dashboard.tsx')).toMatch(/useFocusPulse\(focusToken\)/);
  });
});

describe('only what was approved TODAY is listed', () => {
  test('the dashboard\'s own "Completed today" list still shows today\'s approvals only (unchanged)', () => {
    expect(code('src/components/parent-dashboard.tsx')).toMatch(/finishedDateISO\(task\) === today/);
    expect(en('completedToday')).toBe('Completed today');
  });
});

describe('Activity History wording', () => {
  test('"household tasks" becomes "tasks" in English and Spanish; the records and counts are untouched', () => {
    expect(en('paRowHousehold_one', { count: 1 })).toBe('1 task approved');
    expect(en('paRowHousehold_other', { count: 2 })).toBe('2 tasks approved');
    expect(es('paRowHousehold_one', { count: 1 })).toBe('1 tarea aprobada');
    expect(es('paRowHousehold_other', { count: 2 })).toBe('2 tareas aprobadas');
    for (const lang of ['en', 'es'] as const) {
      const values = Object.values(require(`@/i18n/parent-activity.${lang}`)[lang === 'en' ? 'parentActivityEn' : 'parentActivityEs'] as Record<string, string>).join(' ');
      expect(values).not.toMatch(/household|del hogar/i); // the words, not the key names
    }
    const model = require('@/utils/child-activity-model') as typeof import('@/utils/child-activity-model');
    const buckets = model.buildActivity('day', '2026-03-10', { tasks: [], tokens: null, milestones: [], householdDone: ['2026-03-10', '2026-03-10'] });
    expect(buckets.find((b) => b.key === '2026-03-10')!.householdDone).toBe(2); // the count itself is the same
  });
});

describe('the parent navigation', () => {
  test('there is no separate Tasks tab: the Parent Dashboard header offers Dashboard and Family Settings, and the card leads into the task list', () => {
    const shell = code('src/components/parent-shell.tsx');
    const items = shell.slice(shell.indexOf('const items = ['), shell.indexOf('];', shell.indexOf('const items = [')));
    expect(items).toMatch(/'\/dashboard'/);
    expect(items).toMatch(/'\/parent'/);
    expect(items).not.toMatch(/tasks/i);
    expect(code('src/app/dashboard.tsx')).not.toMatch(/tasks/i);
  });

  test('the child\'s own Tasks tab in the main app is untouched', () => {
    const header = code('src/components/app-header.tsx');
    expect(header).toMatch(/href: '\/tasks', labelKey: 'navTasks'/);
  });
});

describe('approval and the Paw Token payout still work', () => {
  test('Send back and Approve from the dashboard behave as before, and the approved reward still reaches the child', async () => {
    const { app, ids } = await boot();
    const a = await assign(ids.Billy, 'Pay me', 7);
    const b = await assign(ids.Billy, 'Send me back', 3);
    await enter(app, ids.Billy);
    await A().submitAssignedTask(a);
    await A().submitAssignedTask(b);
    await app.family.ensureFamilyLoaded();
    const start = app.family.getWalletBalance();
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    expect(await H().sendTaskBack(ids.Billy, b)).toEqual({ ok: true });
    expect(await H().approveTask(ids.Billy, a)).toEqual({ ok: true });
    await enter(app, ids.Billy);
    expect(await R().collectHouseholdRewards()).toBe(7); // only the approved task pays
    expect(app.family.getWalletBalance()).toBe(start + 7);
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks.find((t) => t.id === b)!.status).toBe('assigned');
  });

  test('with the parent area locked nothing can be approved or sent back', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Guarded');
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    await enter(app, 'main');
    app.gate.lockParentArea();
    expect((await H().approveTask(ids.Billy, id)).ok).toBe(false);
    expect((await H().sendTaskBack(ids.Billy, id)).ok).toBe(false);
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks[0].status).toBe('pending');
  });
});
