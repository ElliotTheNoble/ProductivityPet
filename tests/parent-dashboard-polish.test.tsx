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

// Parent Dashboard polish: PIN unlock at the fourth digit, shorter text, today-only completed tasks, tappable child cards, and the checks that
// tell a reward that arrived from one that did not (Billy's Stats).
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
const press = async (name: string | RegExp) => {
  await RNTL.fireEvent.press(RNTL.screen.getAllByRole('button', { name })[0]);
  await settle();
};

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
const assign = async (childId: string, text: string, extra?: { important?: boolean; reward?: number }) => {
  const r = await H().addTask(childId, text, 'parent', undefined, extra);
  if (!r.ok || !r.id) throw new Error('not assigned');
  return r.id;
};
const task = (childId: string, id: string) => H().peekHousehold()!.children.find((c) => c.id === childId)!.tasks.find((t) => t.id === id)!;
const enter = async (app: App, id: string) => expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
const approveAt = async (app: App, childId: string, id: string, when: Date) => {
  await enter(app, childId);
  await A().submitAssignedTask(id);
  await enter(app, 'main');
  jest.setSystemTime(when);
  await app.gate.unlockParentArea(TEST_PIN);
  expect(await H().approveTask(childId, id)).toEqual({ ok: true });
};

describe('PIN unlock: at the fourth digit, same security', () => {
  test('one look at the stored state and one check per unlock (not two looks before the check, as before)', async () => {
    const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
    const calls = { inspect: 0, isConfigured: 0, issue: 0, verify: 0 };
    gate.registerPinVerifier({
      isConfigured: async () => { calls.isConfigured += 1; return true; },
      issue: async () => { calls.issue += 1; return null; },
      inspect: async () => { calls.inspect += 1; return { configured: true, issue: null }; },
      verify: async (pin) => { calls.verify += 1; return pin === '2468'; },
    });
    expect(await gate.unlockParentArea('2468')).toEqual({ ok: true });
    expect(calls).toEqual({ inspect: 1, isConfigured: 0, issue: 0, verify: 1 });
  });

  test('a checker without inspect() is asked the two questions separately, as before; a missing PIN record still refuses without counting a try', async () => {
    const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
    gate.registerPinVerifier({ isConfigured: async () => true, verify: async () => false, issue: async () => 'verifier-missing' });
    expect(await gate.unlockParentArea('1234')).toEqual({ ok: false, reason: 'verifier-missing' });
    gate.registerPinVerifier({ isConfigured: async () => true, verify: async () => false, inspect: async () => ({ configured: true, issue: 'verifier-missing' }) });
    expect(await gate.unlockParentArea('1234')).toEqual({ ok: false, reason: 'verifier-missing' });
  });

  test('the real PIN: a wrong PIN counts one try, five need the phone\'s screen lock, the right PIN opens, and a bad format is refused without a try', async () => {
    const { app } = await boot();
    app.gate.lockParentArea();
    expect(await app.gate.unlockParentArea('12')).toMatchObject({ ok: false, reason: 'invalid-format' });
    for (let i = 4; i >= 1; i -= 1) expect(await app.gate.unlockParentArea('0000')).toEqual({ ok: false, reason: 'wrong', triesLeft: i });
    expect(await app.gate.unlockParentArea('0000')).toEqual({ ok: false, reason: 'wrong', triesLeft: 0 });
    expect(await app.gate.unlockParentArea(TEST_PIN)).toEqual({ ok: false, reason: 'device-check' }); // even the right PIN waits for the device check
    app.gate.lockParentArea();
  });

  test('the real PIN, right first time: opens', async () => {
    const { app } = await boot();
    app.gate.lockParentArea();
    expect(await app.gate.unlockParentArea(TEST_PIN)).toEqual({ ok: true });
    expect(await app.gate.getParentAccess()).toMatchObject({ state: 'unlocked' });
  });

  test('the lock screen has no Unlock button; the fourth digit checks the PIN once, three digits check nothing, a wrong PIN says so, and the right one opens', async () => {
    const { app } = await boot();
    app.gate.lockParentArea();
    const { ParentGate } = require('@/components/parent-gate') as typeof import('@/components/parent-gate');
    await RNTL.render(
      <ParentGate>
        <ReactNative.Text>SECRET</ReactNative.Text>
      </ParentGate>
    );
    await RNTL.screen.findByText(en('pgTitle'));
    expect(RNTL.screen.queryByRole('button', { name: en('pgUnlock') })).toBeNull();
    const digits = async (pin: string) => {
      for (const d of pin) await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: d }));
    };
    await digits('135');
    await settle();
    expect(RNTL.screen.getByText(/^3 digits entered$/)).toBeTruthy();
    expect(RNTL.screen.queryByText(new RegExp(en('pgWrong')))).toBeNull();
    expect(RNTL.screen.queryByText('SECRET')).toBeNull();
    await digits('8'); // 1358: the fourth digit, wrong
    expect(await RNTL.screen.findByText(new RegExp(`${en('pgWrong')} 4 tries left`))).toBeTruthy();
    expect(RNTL.screen.getByText(/^0 digits entered$/)).toBeTruthy(); // the digits were wiped at once
    await digits(TEST_PIN);
    expect(await RNTL.screen.findByText('SECRET')).toBeTruthy();
  });

  test('"Checking…" shows while the PIN is checked, and a second check cannot start meanwhile', async () => {
    const { app } = await boot();
    app.gate.lockParentArea();
    const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
    let finish!: () => void;
    const spy = jest.spyOn(gate, 'unlockParentArea').mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ ok: false, reason: 'wrong', triesLeft: 4 }); }));
    const { ParentLockScreen } = require('@/components/parent-gate') as typeof import('@/components/parent-gate');
    await RNTL.render(<ParentLockScreen access={{ state: 'locked', reason: 'locked' } as never} />);
    for (const d of '1111') await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: d }));
    expect(RNTL.screen.getByTestId('pin-checking')).toBeTruthy();
    for (const d of '2222') await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: d })); // pressed while checking: ignored
    expect(spy).toHaveBeenCalledTimes(1);
    await RNTL.act(async () => finish());
    expect(RNTL.screen.queryByTestId('pin-checking')).toBeNull();
  });

  test('security protections are untouched (source check): the PIN is never stored, the limit and device check stay in the gate, the verifier still reads fresh', () => {
    const lock = code('src/components/parent-gate.tsx');
    expect(lock).toMatch(/pin\.length === NEW_PIN_LENGTH && !busy && !needsDeviceCheck/); // auto-submit only when idle and not held back
    expect(lock).not.toMatch(/AsyncStorage|SecureStore|setItem/); // nothing stores the digits
    expect(lock).toMatch(/setPin\(''\)/); // wiped the moment a check starts
    const gate = code('src/utils/parent-gate.ts');
    expect(gate).toMatch(/limitedAttempt\(\(\) => verifier\.verify\(pin\)\)/);
    expect(gate).toMatch(/PIN_TRIES_BEFORE_DEVICE_CHECK = 5/);
    expect(code('src/utils/parent-pin.ts')).toMatch(/verify: \(pin\) => pinMatches\(pin\)/); // the check itself still starts from a fresh read
    const trace = code('src/utils/pin-trace.ts');
    expect(trace).toMatch(/'unlock:finished'/); // dev-only timing: milliseconds and true/false only
    expect(gate).toMatch(/pinTrace\('unlock:finished', \{ ms: Date\.now\(\) - startedAt, ok: outcome\.kind === 'ok' \}\)/);
  });
});

describe('Parent Dashboard text', () => {
  test('the explanations that only repeated their headings are gone (English and Spanish); warnings and privacy notes stay', () => {
    const removed = ['paTasksNowNote', 'paUpcomingNote', 'paPastDueNote', 'paCompletedNote', 'paAssignedNote', 'phSettingsHint', 'languageNote'];
    const all = (lang: 'en' | 'es') =>
      JSON.stringify([
        require(`@/i18n/parent-activity.${lang}`),
        require(`@/i18n/parent-home.${lang}`),
        require(`@/i18n/${lang}`),
      ]);
    for (const lang of ['en', 'es'] as const) for (const key of removed) expect(all(lang)).not.toContain(`"${key}"`);
    // kept on purpose
    expect(en('localProfileNote')).toMatch(/not secure/i);
    expect(en('gentleDesc')).toMatch(/cannot permanently die/); // Pet Safety is enforced now: the modes are described, with no "not enforced" warning
    expect(en('phJournalsText')).toMatch(/chose to share/i);
    expect(en('fmArchivedHelp')).toMatch(/Nothing is deleted/);
    for (const key of ['phSubtitle', 'pjEmpty', 'pjReadOnly', 'paActNote', 'paActNothing', 'fmHealthIntro', 'rewardsNote']) {
      expect(en(key).length).toBeLessThan(90);
      expect(es(key).length).toBeGreaterThan(0);
      expect(es(key)).not.toBe(en(key));
    }
  });

  test('Assigned by you: a short heading, the statuses and no explanation paragraph; Activity History keeps one short caveat', async () => {
    await boot();
    expect(en('paAssignedNote' as never)).toBe('paAssignedNote'); // the explanation line was removed (an unknown key just returns its own name)
    expect(en('paAssignedTitle')).toBe('Tasks assigned by you');
    expect(en('paActTitle')).toBe('Activity history');
    expect(en('paActNote').length).toBeLessThan(70);
  });

  test('the dashboard no longer shows the language note or the Family Settings hint, but keeps every button', async () => {
    const { app, ids } = await boot();
    await enter(app, 'main');
    await H().selectChild(ids.Billy);
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
    expect(words()).not.toContain('applies right away');
    expect(RNTL.screen.getAllByRole('button', { name: en('rwSave') })).toHaveLength(1);
    expect(RNTL.screen.getAllByRole('button', { name: en('back') })).toHaveLength(1);
  });
});

describe('Parent Dashboard: Completed today', () => {
  async function dash(ids: Record<string, string>) {
    await H().selectChild(ids.Billy);
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
  }

  test('only tasks approved TODAY (local date) are listed; older ones stay saved; waiting and Try again tasks are not "completed"', async () => {
    const { app, ids } = await boot();
    const old = await assign(ids.Billy, 'Approved long ago');
    const todayTask = await assign(ids.Billy, 'Approved today');
    const waiting = await assign(ids.Billy, 'Still waiting');
    const back = await assign(ids.Billy, 'Sent back');
    await approveAt(app, ids.Billy, old, new Date(2026, 2, 1, 12, 0, 0)); // March 1, long before "today" (March 10)
    await approveAt(app, ids.Billy, todayTask, new Date(2026, 2, 10, 15, 0, 0));
    await enter(app, ids.Billy);
    await A().submitAssignedTask(waiting);
    await A().submitAssignedTask(back);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await H().sendTaskBack(ids.Billy, back);
    await dash(ids);
    const text = words();
    expect(text).toContain(en('completedToday'));
    const completedPart = text.slice(text.indexOf(en('completedToday')), text.indexOf(en('addTask')));
    expect(completedPart).toContain('Approved today');
    expect(completedPart).not.toContain('Approved long ago');
    expect(completedPart).not.toContain('Still waiting');
    expect(completedPart).not.toContain('Sent back');
    // nothing was deleted or changed
    expect(task(ids.Billy, old)).toMatchObject({ status: 'approved' });
    expect(H().tasksByStatus(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!).completed.map((t) => t.id).sort()).toEqual([old, todayTask].sort());
  });

  test('the date used is the parent\'s approval time, not the child\'s submission: submitted yesterday, approved today = today', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Handed in yesterday');
    await enter(app, ids.Billy);
    jest.setSystemTime(new Date(2026, 2, 9, 20, 0, 0));
    await A().submitAssignedTask(id); // yesterday
    await enter(app, 'main');
    jest.setSystemTime(new Date(2026, 2, 10, 9, 0, 0));
    await app.gate.unlockParentArea(TEST_PIN);
    await H().approveTask(ids.Billy, id);
    expect(H().finishedDateISO(task(ids.Billy, id))).toBe('2026-03-10');
    const t = task(ids.Billy, id);
    expect(new Date(t.submittedAt as string).getDate()).toBe(9);
    await dash(ids);
    expect(words()).toContain('Handed in yesterday');
  });

  test('local calendar date: an approval just before local midnight belongs to that local day', () => {
    const base = { id: 'x', text: 'x', createdBy: 'parent' as const, createdAt: '2026-03-01T00:00:00.000Z' };
    const late = new Date(2026, 2, 10, 23, 59, 0).toISOString();
    const early = new Date(2026, 2, 11, 0, 1, 0).toISOString();
    expect(H().finishedDateISO({ ...base, status: 'approved', decidedAt: late })).toBe('2026-03-10');
    expect(H().finishedDateISO({ ...base, status: 'approved', decidedAt: early })).toBe('2026-03-11');
    expect(H().finishedDateISO({ ...base, status: 'pending', submittedAt: late })).toBeNull();
    expect(H().finishedDateISO({ ...base, status: 'assigned' })).toBeNull();
    expect(H().finishedDateISO({ ...base, status: 'approved' })).toBeNull(); // no usable time: not guessed
    expect(H().finishedDateISO({ ...base, status: 'approved', decidedAt: 'nonsense' })).toBeNull();
    expect(H().finishedDateISO({ ...base, status: 'completed', decidedAt: late })).toBe('2026-03-10');
  });

  test('a task approved while the screen is open appears at once; when the day changes the list empties itself', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Approve while open');
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await dash(ids);
    expect(words()).toContain(en('noCompleted'));
    await RNTL.act(async () => {
      await H().approveTask(ids.Billy, id);
    });
    await settle();
    const text = () => words().slice(words().indexOf(en('completedToday')));
    expect(text()).toContain('Approve while open');
    // midnight passes: the hook's timer fires and the list is for the new day (the task is now "yesterday's")
    jest.setSystemTime(new Date(2026, 2, 11, 0, 0, 30));
    await RNTL.act(async () => {
      const state = ReactNative.AppState as unknown as { currentState: string };
      state.currentState = 'active';
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const { useTodayISO } = require('@/hooks/use-today') as typeof import('@/hooks/use-today');
    function Probe() {
      return <ReactNative.Text>{useTodayISO()}</ReactNative.Text>;
    }
    await RNTL.cleanup();
    await RNTL.render(<Probe />);
    expect(RNTL.screen.getByText('2026-03-11')).toBeTruthy(); // the hook reads the local date
  });

  test('Activity History keeps the older approvals: counted on the day they were approved, apart from the child\'s own tasks', async () => {
    const { app, ids } = await boot();
    const old = await assign(ids.Billy, 'Old approval');
    await approveAt(app, ids.Billy, old, new Date(2026, 2, 5, 12, 0, 0));
    jest.setSystemTime(T0);
    const model = require('@/utils/child-activity-model') as typeof import('@/utils/child-activity-model');
    const input = { tasks: [], tokens: null, milestones: [], householdDone: [H().finishedDateISO(task(ids.Billy, old)) as string] };
    const buckets = model.buildActivity('day', '2026-03-10', input);
    const march5 = buckets.find((b) => b.key === '2026-03-05')!;
    expect(march5.householdDone).toBe(1);
    expect(march5.tasksCompleted).toBe(0); // the child's own tasks are counted separately
    expect(model.buildActivity('week', '2026-03-10', input).reduce((n, b) => n + b.householdDone, 0)).toBe(1);
    expect(en('paRowHousehold_one', { count: 1 })).toBe('1 task approved');
    expect(en('paRowHousehold_other', { count: 2 })).toBe('2 tasks approved');
    expect(es('paRowHousehold_other', { count: 2 })).toBe('2 tareas aprobadas');
  });
});

describe('Parent Dashboard: child cards', () => {
  async function dash() {
    const ctx = await boot();
    await enter(ctx.app, 'main');
    await H().selectChild(ctx.ids.Billy);
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
    return ctx;
  }

  test('the whole card selects the child; there is no Selected / Select button; the selected card shows a check', async () => {
    const { ids } = await dash();
    expect(RNTL.screen.queryByRole('button', { name: /^Selected$/ })).toBeNull();
    expect(RNTL.screen.queryByText(en('select'))).toBeNull();
    expect(RNTL.screen.queryByText(en('selected'))).toBeNull();
    expect(RNTL.screen.getByTestId(`child-selected-${ids.Billy}`, { hidden: true })).toBeTruthy();
    expect(RNTL.screen.queryByTestId(`child-selected-${ids.Sarah}`, { hidden: true })).toBeNull();
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`child-card-${ids.Sarah}`));
    await settle();
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Sarah);
    expect(RNTL.screen.getByTestId(`child-selected-${ids.Sarah}`, { hidden: true })).toBeTruthy();
    expect(RNTL.screen.queryByTestId(`child-selected-${ids.Billy}`, { hidden: true })).toBeNull();
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`child-card-${ids.Billy}`));
    await settle();
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Billy);
    expect(words()).toContain('Billy'); // the dashboard now shows Billy's tasks and settings
  });

  test('accessibility: each card is a radio named "Select <name>" with a selected state; Rename and Archive stay separate buttons', async () => {
    const { ids } = await dash();
    const billy = RNTL.screen.getByTestId(`child-card-${ids.Billy}`);
    const sarah = RNTL.screen.getByTestId(`child-card-${ids.Sarah}`);
    expect(billy.props.accessibilityRole).toBe('radio');
    expect(billy.props.accessibilityLabel).toBe(en('fmSelectLabel', { name: 'Billy' }));
    expect(billy.props.accessibilityState).toMatchObject({ selected: true, checked: true });
    expect(sarah.props.accessibilityState).toMatchObject({ selected: false, checked: false });
    expect(RNTL.screen.getByRole('button', { name: en('fmRenameLabel', { name: 'Billy' }) })).toBeTruthy();
    expect(RNTL.screen.getByRole('button', { name: en('fmArchiveLabel', { name: 'Sarah' }) })).toBeTruthy();
    expect(billy.props.focusable).not.toBe(false);
  });

  test('selecting a card never switches who is playing and needs no extra PIN step', async () => {
    const { app, ids } = await dash();
    const before = app.profiles.getActiveProfileId();
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`child-card-${ids.Sarah}`));
    await settle();
    expect(app.profiles.getActiveProfileId()).toBe(before);
    expect((await app.gate.getParentAccess()).state).toBe('unlocked');
    // with the parent area locked the selection is refused (it is a parent-only change), and nothing else moves
    app.gate.lockParentArea();
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`child-card-${ids.Billy}`));
    await settle();
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Sarah);
    expect(app.profiles.getActiveProfileId()).toBe(before);
  });

  test('the card behind the contents lets Rename and Archive work, and the old "Select" strings are not rendered', () => {
    const source = code('src/components/family-management-card.tsx');
    expect(source).toMatch(/accessibilityRole="radio"/);
    expect(source).toMatch(/pointerEvents="box-none"/);
    expect(source).not.toMatch(/t\('selected'\)|t\('select'\)/);
  });
});

describe('Billy\'s Paw Tokens: how the earnings (Stats) and the wallet follow an approval', () => {
  test('Stats "Paw Tokens Earned" is the earnings history, a different number from the wallet balance: a reward adds to BOTH, and the history shows it', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Earn', { reward: 7 });
    await enter(app, ids.Billy);
    const history = require('@/utils/token-history') as typeof import('@/utils/token-history');
    const startBalance = (await app.family.ensureFamilyLoaded(), app.family.getWalletBalance());
    const startEarned = history.sumTokens((await history.getTokenHistory()).events);
    await A().submitAssignedTask(id);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await H().approveTask(ids.Billy, id);
    await enter(app, ids.Billy);
    expect(await R().collectHouseholdRewards()).toBe(7);
    await settle();
    expect(app.family.getWalletBalance()).toBe(startBalance + 7);
    expect(history.sumTokens((await history.getTokenHistory()).events)).toBe(startEarned + 7);
    // the Stats screen draws exactly that earnings number
    const { StatsHubScreen } = require('@/components/stats-screen') as typeof import('@/components/stats-screen');
    await RNTL.render(<StatsHubScreen />);
    await settle();
    expect(words()).toContain(String(startEarned + 7));
    expect(words()).toContain(en('statsTokensEarned'));
  });

  test('a reward approved while the profile was closed is collected the next time the child is opened, once (what happens to an approved task that was never collected)', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Waiting for Billy', { reward: 5 });
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await H().approveTask(ids.Billy, id);
    expect(H().rewardOwed(task(ids.Billy, id))).toBe(true); // approved, not collected: the dashboard says "added when Billy next opens"
    await enter(app, ids.Billy);
    await app.family.ensureFamilyLoaded();
    const start = app.family.getWalletBalance();
    const stop = R().startHouseholdRewardCollection(); // what the app does when the child's session starts
    await settle();
    stop();
    expect(app.family.getWalletBalance()).toBe(start + 5);
    expect(H().rewardOwed(task(ids.Billy, id))).toBe(false);
  });

  test('the dashboard tells the two situations apart on the task itself: "added when Billy next opens" versus "Reward given"', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Status check', { reward: 5 });
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await H().approveTask(ids.Billy, id);
    await H().selectChild(ids.Billy);
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
    expect(words()).toContain(en('rwOwed', { tokens: '5 Paw Tokens', name: 'Billy' }));
    expect(words()).not.toContain(en('rwGiven', { tokens: '5 Paw Tokens' }));
    await RNTL.cleanup();
    await enter(app, ids.Billy);
    await R().collectHouseholdRewards();
    await settle();
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await RNTL.render(<ParentDashboard />);
    await settle();
    expect(words()).toContain(en('rwGiven', { tokens: '5 Paw Tokens' }));
  });

  test('the wallet-race fix is part of the running code: an older copy of the profile cannot undo a collected reward (and a normal spend still works)', async () => {
    const { app, ids } = await boot();
    await enter(app, ids.Billy);
    const old = await app.family.getPetProfileForSelectedPet();
    const id = await assign(ids.Billy, 'Race', { reward: 6 });
    await A().submitAssignedTask(id);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await H().approveTask(ids.Billy, id);
    await enter(app, ids.Billy);
    const fresh = await app.family.getPetProfileForSelectedPet();
    await R().collectHouseholdRewards();
    const afterReward = app.family.getWalletBalance();
    app.family.savePetProfileForSelectedPet({ ...fresh, hunger: Math.max(0, fresh.hunger - 1) });
    expect(app.family.getWalletBalance()).toBe(afterReward);
    expect(old).toBeDefined();
    expect(code('src/utils/pet-family.ts')).toMatch(/WALLET_BASE/);
    expect(code('src/utils/pet-family.ts')).toMatch(/householdRewards/);
  });

  test('collection writes a short, secret-free development trace (words and numbers only) so a missing reward can be diagnosed on the phone', async () => {
    const { app, ids } = await boot();
    const logs: string[] = [];
    jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')); });
    const id = await assign(ids.Billy, 'Trace me with a secret title', { reward: 3 });
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await H().approveTask(ids.Billy, id);
    await enter(app, 'main');
    await R().collectHouseholdRewards();
    await enter(app, ids.Billy);
    await R().collectHouseholdRewards();
    const trace = logs.filter((line) => line.startsWith('[reward-trace]'));
    expect(trace.some((line) => /collect:skipped \{"why":"main"\}/.test(line))).toBe(true);
    expect(trace.some((line) => /collect:start \{"owed":1,"approved":1\}/.test(line))).toBe(true);
    expect(trace.some((line) => /collect:task \{"result":"paid","marked":true\}/.test(line))).toBe(true);
    expect(trace.some((line) => /collect:end \{"added":3\}/.test(line))).toBe(true);
    expect(trace.join('\n')).not.toContain('secret title');
    expect(trace.join('\n')).not.toContain(ids.Billy);
  });
});
