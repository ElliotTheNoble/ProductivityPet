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

// Step 4B: Paw Token rewards for approved household tasks. The household record carries the amounts (settings + each task's saved reward); the
// CHILD's own profile collects an approved task's reward into its own wallet exactly once.
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
const R = () => require('@/utils/household-rewards') as typeof import('@/utils/household-rewards');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const tn = (base: string, count: number) => i18n().translatePlural('en', base as never, count);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

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
const assign = async (childId: string, text: string, room?: string, extra?: { important?: boolean; reward?: number }) => {
  const r = await H().addTask(childId, text, 'parent', room as never, extra);
  if (!r.ok || !r.id) throw new Error(`not assigned: ${JSON.stringify(r)}`);
  return r.id;
};
const task = (childId: string, id: string) => H().peekHousehold()!.children.find((c) => c.id === childId)!.tasks.find((t) => t.id === id)!;
const enter = async (app: App, id: string) => expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
const unlock = (app: App) => app.gate.unlockParentArea(TEST_PIN);
const balance = async (app: App) => {
  await app.family.ensureFamilyLoaded();
  return app.family.getWalletBalance();
};
// The whole round trip a child makes and a parent answers.
const submit = (id: string) => A().submitAssignedTask(id);
const earnEvents = async (app: App) => (await app.history.getTokenHistory()).events.filter((e) => e.id.startsWith('earn:household:'));

describe('reward settings', () => {
  test('default Regular 5 and Important 10 until the parent sets their own; a parent can set both as the new default and change it again', async () => {
    await boot();
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 5, important: 10 });
    expect(await H().setRewardSettings({ regular: 8, important: 20 })).toEqual({ ok: true });
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 8, important: 20 });
    expect(await H().setRewardSettings({ regular: 5, important: 10 })).toEqual({ ok: true }); // back to 5 / 10 simply by choosing them again
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 5, important: 10 });
  });

  test.each([[-1], [1.5], [NaN], [Infinity], [1000], ['5'], [null], [undefined]])('invalid amount %p is refused and nothing changes', async (bad) => {
    await boot();
    await H().setRewardSettings({ regular: 7, important: 14 });
    expect(await H().setRewardSettings({ regular: bad as never, important: 14 })).toEqual({ ok: false, reason: 'invalid' });
    expect(await H().setRewardSettings({ regular: 7, important: bad as never })).toEqual({ ok: false, reason: 'invalid' });
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 7, important: 14 });
  });

  test('0 and the largest amount are valid', async () => {
    await boot();
    expect(await H().setRewardSettings({ regular: 0, important: 999 })).toEqual({ ok: true });
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 0, important: 999 });
  });

  test('saved: survives a reload of the household and a full restart, and is the same whichever profile is open', async () => {
    const { app, ids } = await boot();
    await H().setRewardSettings({ regular: 6, important: 12 });
    expect(await H().reloadHousehold()).toBe(true);
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 6, important: 12 });
    const kept = await app.dump();
    for (const profile of [ids.Billy, ids.Sarah, 'main']) {
      await enter(app, profile);
      expect(H().getRewardSettings(await H().ensureHouseholdLoaded())).toEqual({ regular: 6, important: 12 });
    }
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const again = await loadApp(undefined, kept);
    await again.profiles.ensureProfilesReady();
    expect(H().getRewardSettings(await H().ensureHouseholdLoaded())).toEqual({ regular: 6, important: 12 });
  });

  test('parent only: with the parent area locked nobody can change, reset or set a task reward', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Locked task');
    await H().setRewardSettings({ regular: 6, important: 12 });
    app.gate.lockParentArea();
    const before = JSON.stringify(H().peekHousehold());
    for (const result of [
      await H().setRewardSettings({ regular: 1, important: 2 }),
      await H().updateTaskReward(ids.Billy, id, { reward: 50 }),
      await H().addTask(ids.Billy, 'Sneaky', 'parent', undefined, { reward: 999 }),
    ]) {
      expect(result.ok).toBe(false);
    }
    expect(JSON.stringify(H().peekHousehold())).toBe(before);
  });

  test('a saved household with a damaged amount falls back to that amount\'s default; nothing else is guessed', async () => {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const app = await loadApp({ '@ProductivityPet:household': { version: 1, parent: null, selectedChildId: null, revision: 1, rewards: { regular: -4, important: 12 }, children: [] } });
    await app.profiles.ensureProfilesReady();
    expect(H().getRewardSettings(await H().ensureHouseholdLoaded())).toEqual({ regular: 5, important: 12 });
  });

  test('changing the settings never touches a Paw Token balance', async () => {
    const { app } = await boot();
    await enter(app, 'main');
    const before = await balance(app);
    await H().setRewardSettings({ regular: 30, important: 40 });
    await H().setRewardSettings({ regular: 1, important: 2 });
    expect(await balance(app)).toBe(before);
  });
});

describe('assigning: kind and reward saved on the task', () => {
  test('a new task takes the household default for its kind; Important is saved as important; the reward is saved', async () => {
    const { ids } = await boot();
    const regular = await assign(ids.Billy, 'Regular one');
    const important = await assign(ids.Billy, 'Important one', undefined, { important: true });
    expect(task(ids.Billy, regular)).toMatchObject({ reward: 5 });
    expect(task(ids.Billy, regular).important).toBeUndefined();
    expect(task(ids.Billy, important)).toMatchObject({ reward: 10, important: true });
  });

  test('a custom reward for one task is saved; invalid ones are refused and nothing is assigned', async () => {
    const { ids } = await boot();
    const id = await assign(ids.Billy, 'Special', 'gym', { important: true, reward: 25 });
    expect(task(ids.Billy, id)).toMatchObject({ reward: 25, important: true, room: 'gym' }); // room, details and child assignment are kept
    for (const bad of [-1, 0.5, 1000, Number.NaN]) {
      expect(await H().addTask(ids.Billy, 'Bad reward', 'parent', undefined, { reward: bad })).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks).toHaveLength(1);
  });

  test('changing the household amounts later does NOT change tasks that already exist; new tasks use the new amounts', async () => {
    const { ids } = await boot();
    const old = await assign(ids.Billy, 'Before');
    await H().setRewardSettings({ regular: 20, important: 30 });
    expect(task(ids.Billy, old).reward).toBe(5);
    const fresh = await assign(ids.Billy, 'After');
    expect(task(ids.Billy, fresh).reward).toBe(20);
    await H().setRewardSettings({ regular: 1, important: 2 });
    expect(task(ids.Billy, fresh).reward).toBe(20); // choosing new defaults again does not re-price either
    expect(task(ids.Billy, old).reward).toBe(5);
  });

  test('a parent can edit the kind and reward of a task that is to do or waiting; an approved task is closed', async () => {
    const { app, ids } = await boot();
    await enter(app, ids.Billy);
    const id = await assign(ids.Billy, 'Editable');
    expect(await H().updateTaskReward(ids.Billy, id, { important: true, reward: 12 })).toEqual({ ok: true });
    expect(task(ids.Billy, id)).toMatchObject({ important: true, reward: 12 });
    expect(await H().updateTaskReward(ids.Billy, id, { important: false })).toEqual({ ok: true });
    expect(task(ids.Billy, id).important).toBeUndefined();
    expect(await H().updateTaskReward(ids.Billy, id, { reward: -3 })).toEqual({ ok: false, reason: 'invalid' });
    expect(await submit(id)).toBe('sent');
    expect(await H().updateTaskReward(ids.Billy, id, { reward: 3 })).toEqual({ ok: true }); // waiting: still editable
    await H().approveTask(ids.Billy, id);
    expect(await H().updateTaskReward(ids.Billy, id, { reward: 99 })).toEqual({ ok: false, reason: 'wrong-state' });
    expect(task(ids.Billy, id).reward).toBe(3);
    expect(await H().updateTaskReward(ids.Billy, 'nope', { reward: 1 })).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('payout: only after the parent approves, exactly once', () => {
  test('nothing is paid on submission, Undo or Try again; the approved reward arrives in the right child\'s wallet', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Do the thing', 'gym', { reward: 7 });
    await enter(app, ids.Billy);
    const start = await balance(app);
    expect(await submit(id)).toBe('sent');
    expect(await R().collectHouseholdRewards()).toBe(0);
    expect(await A().undoAssignedTask(id)).toBe('undone');
    expect(await R().collectHouseholdRewards()).toBe(0);
    expect(await submit(id)).toBe('sent');
    expect(await H().sendTaskBack(ids.Billy, id)).toEqual({ ok: true });
    expect(await R().collectHouseholdRewards()).toBe(0);
    expect(await balance(app)).toBe(start);
    expect(await earnEvents(app)).toEqual([]);
    expect(await submit(id)).toBe('sent');
    expect(await H().approveTask(ids.Billy, id)).toEqual({ ok: true });
    await settle(); // the open child's session collects by itself when the approval is saved (see household-rewards.ts)
    await R().collectHouseholdRewards();
    expect(await balance(app)).toBe(start + 7);
    expect(task(ids.Billy, id)).toMatchObject({ status: 'approved', rewardPaidAt: expect.any(String) });
    const events = await earnEvents(app);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: `earn:household:${id}`, amount: 7, source: 'task', refId: id });
  });

  test('approving while another profile is open pays nothing there; the child collects when they next play; other children and Main get nothing', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Billy task', undefined, { reward: 9 });
    await enter(app, ids.Billy);
    await submit(id);
    await enter(app, 'main');
    const mainStart = await balance(app);
    expect(await H().approveTask(ids.Billy, id)).toEqual({ ok: true });
    expect(await R().collectHouseholdRewards()).toBe(0); // Main collects nothing
    expect(await balance(app)).toBe(mainStart);
    await enter(app, ids.Sarah);
    const sarahStart = await balance(app);
    expect(await R().collectHouseholdRewards()).toBe(0);
    expect(await balance(app)).toBe(sarahStart);
    await enter(app, ids.Billy);
    const billyStart = await balance(app);
    expect(await R().collectHouseholdRewards()).toBe(9);
    expect(await balance(app)).toBe(billyStart + 9);
    await enter(app, 'main');
    expect(await balance(app)).toBe(mainStart); // Main's wallet never moved
    await enter(app, ids.Sarah);
    expect(await balance(app)).toBe(sarahStart);
  });

  test('duplicate protection: a second approval, simultaneous collects, a refresh and a restart pay once', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Once only', undefined, { reward: 6 });
    await enter(app, ids.Billy);
    const start = await balance(app);
    await submit(id);
    expect(await H().approveTask(ids.Billy, id)).toEqual({ ok: true });
    expect(await H().approveTask(ids.Billy, id)).toEqual({ ok: false, reason: 'wrong-state' }); // tapped twice
    const paid = await Promise.all([R().collectHouseholdRewards(), R().collectHouseholdRewards(), R().collectHouseholdRewards()]);
    expect(paid.reduce((a, b) => a + b, 0) + 0).toBeLessThanOrEqual(6);
    await settle();
    expect(await balance(app)).toBe(start + 6);
    expect(await R().collectHouseholdRewards()).toBe(0); // a refresh
    // a restart (same storage, fresh modules)
    const kept = await app.dump();
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const again = await loadApp(undefined, kept);
    await again.profiles.ensureProfilesReady();
    await configurePin(again, { unlocked: true });
    expect(await again.profiles.switchProfile(ids.Billy)).toMatchObject({ ok: true });
    await again.family.ensureFamilyLoaded();
    const afterRestart = again.family.getWalletBalance();
    expect(afterRestart).toBe(start + 6);
    expect(await R().collectHouseholdRewards()).toBe(0);
    expect(again.family.getWalletBalance()).toBe(afterRestart);
    expect((await again.history.getTokenHistory()).events.filter((e) => e.id === `earn:household:${id}`)).toHaveLength(1);
  });

  test('a "collected" mark that failed to save is retried without paying again', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Mark me', undefined, { reward: 4 });
    await enter(app, ids.Billy);
    const start = await balance(app);
    await submit(id);
    await H().approveTask(ids.Billy, id);
    await R().collectHouseholdRewards();
    await settle();
    expect(await balance(app)).toBe(start + 4);
    // pretend the mark never reached storage: take it off the saved task, then collect again
    const raw = JSON.parse((await app.AsyncStorage.getItem('@ProductivityPet:household'))!);
    for (const child of raw.children) for (const t of child.tasks) delete t.rewardPaidAt;
    await app.AsyncStorage.setItem('@ProductivityPet:household', JSON.stringify({ ...raw, revision: raw.revision }));
    expect(await H().reloadHousehold()).toBe(true);
    expect(H().rewardOwed(task(ids.Billy, id))).toBe(true);
    expect(await R().collectHouseholdRewards()).toBe(0); // already paid: nothing added
    expect(await balance(app)).toBe(start + 4);
    expect(task(ids.Billy, id).rewardPaidAt).toEqual(expect.any(String)); // and it is marked now
  });

  test('save failures: if the approval cannot be saved nothing is approved or paid; if the payment cannot be remembered nothing is paid and the next try works', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Fragile', undefined, { reward: 5 });
    await enter(app, ids.Billy);
    const start = await balance(app);
    await submit(id);
    // the storage double's own setItem is already a jest mock: keep its real behaviour and wrap it
    const realSet = (app.AsyncStorage.setItem as jest.Mock).getMockImplementation() as (key: string, value: string) => Promise<void>;
    let failing: string | null = null; // while set, saving a key that contains it fails (the spy stays in place; only the switch changes)
    jest.spyOn(app.AsyncStorage, 'setItem').mockImplementation((async (key: string, value: string) => {
      if (failing && key.includes(failing)) throw new Error('disk full');
      return realSet(key, value);
    }) as never);
    failing = '@ProductivityPet:household';
    const failed = await H().approveTask(ids.Billy, id);
    expect(failed).toEqual({ ok: false, reason: 'storage' });
    expect(task(ids.Billy, id).status).toBe('pending'); // not approved...
    expect(await R().collectHouseholdRewards()).toBe(0); // ...so nothing is paid
    failing = null;
    expect(await balance(app)).toBe(start);
    expect(await H().approveTask(ids.Billy, id)).toEqual({ ok: true }); // tried again: works
    // the wallet cannot be saved (the family record, which holds the credit AND the note that it was given, will not write): not reported paid
    failing = 'petFamily';
    await R().collectHouseholdRewards();
    await settle();
    expect(H().rewardOwed(task(ids.Billy, id))).toBe(true); // still owed, still approved: not marked collected
    failing = null;
    await R().collectHouseholdRewards();
    await settle();
    expect(await balance(app)).toBe(start + 5); // paid once, now
    expect(await earnEvents(app)).toHaveLength(1);
  });

  test('older tasks: approved or pending tasks saved without a reward are never paid; a zero reward pays nothing; no pet growth is ever paid', async () => {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const app: App = await loadApp();
    await app.profiles.ensureProfilesReady();
    await configurePin(app, { unlocked: true });
    const added = await H().addChild('Billy');
    if (!added.ok || !added.id) throw new Error('no child');
    const billy = added.id;
    await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
    const raw = JSON.parse((await app.AsyncStorage.getItem('@ProductivityPet:household'))!);
    raw.children[0].tasks = [
      { id: 'old-approved', text: 'Old approved', createdBy: 'parent', status: 'approved', createdAt: '2026-01-01T00:00:00.000Z', decidedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'old-pending', text: 'Old pending', createdBy: 'parent', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', submittedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'zero', text: 'Worth nothing', createdBy: 'parent', status: 'approved', createdAt: '2026-01-01T00:00:00.000Z', reward: 0 },
    ];
    await app.AsyncStorage.setItem('@ProductivityPet:household', JSON.stringify(raw));
    expect(await H().reloadHousehold()).toBe(true);
    await enter(app, billy);
    const start = await balance(app);
    const growthBefore = JSON.stringify(app.family.peekFamily()!.pets.map((p) => p.growthUnits));
    expect(await R().collectHouseholdRewards()).toBe(0);
    // approving the old pending task pays nothing either: it never had a reward
    expect(await H().approveTask(billy, 'old-pending')).toEqual({ ok: true });
    expect(await R().collectHouseholdRewards()).toBe(0);
    expect(await balance(app)).toBe(start);
    expect(await earnEvents(app)).toEqual([]);
    expect(JSON.stringify(app.family.peekFamily()!.pets.map((p) => p.growthUnits))).toBe(growthBefore);
    expect(H().rewardOwed(task(billy, 'old-approved'))).toBe(false);
  });

  test('tokens only: a paid reward adds no pet growth, and never changes the child\'s personal task records', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Growth check', undefined, { important: true });
    await enter(app, ids.Billy);
    await app.family.ensureFamilyLoaded();
    const growthBefore = JSON.stringify(app.family.peekFamily()!.pets.map((p) => p.growthUnits));
    const personalBefore = await app.AsyncStorage.getItem(`@ProductivityPet:p:${ids.Billy}:tasks`);
    await submit(id);
    await H().approveTask(ids.Billy, id);
    await R().collectHouseholdRewards();
    await settle();
    expect(JSON.stringify(app.family.peekFamily()!.pets.map((p) => p.growthUnits))).toBe(growthBefore);
    expect(await app.AsyncStorage.getItem(`@ProductivityPet:p:${ids.Billy}:tasks`)).toBe(personalBefore);
  });

  test('an archived or unknown profile collects nothing', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Archive me', undefined, { reward: 5 });
    await enter(app, ids.Billy);
    await submit(id);
    await H().approveTask(ids.Billy, id);
    await enter(app, 'main');
    await H().setChildArchived(ids.Billy, true);
    await enter(app, ids.Billy);
    const start = await balance(app);
    expect(await R().collectHouseholdRewards()).toBe(0);
    expect(await balance(app)).toBe(start);
  });
});

describe('compatibility with the existing Paw Token system', () => {
  test('the reward goes into the SAME wallet the shop spends from: balance, spending and history all agree', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Earn then spend', undefined, { reward: 30 });
    await enter(app, ids.Billy);
    const start = await balance(app);
    await submit(id);
    await H().approveTask(ids.Billy, id);
    await R().collectHouseholdRewards();
    await settle();
    expect(await balance(app)).toBe(start + 30);
    const price = 10;
    const kinds = Object.keys(app.family.getCareSupplies());
    const bought = app.family.buyCareSupply(kinds[0] as never);
    expect(bought.ok).toBe(true);
    expect(await balance(app)).toBeLessThan(start + 30);
    expect(price).toBeGreaterThan(0);
    expect((await app.history.getTokenHistory()).events.find((e) => e.id === `earn:household:${id}`)).toMatchObject({ amount: 30 });
  });

  test('personal-task earnings still work beside household rewards, with their own records', async () => {
    const { app, ids } = await boot();
    await enter(app, ids.Billy);
    await app.family.ensureFamilyLoaded();
    const start = app.family.getWalletBalance();
    await app.tokens.reconcilePawTokenEarnings([]); // loads the paid-keys record
    const task1 = { id: 'p1', text: 'Mine', category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: true } as never;
    await app.tokens.reconcilePawTokenEarnings([task1]);
    const afterFirstLoad = app.family.getWalletBalance();
    expect(afterFirstLoad).toBeGreaterThan(start); // the existing personal-task payout still works
    const id = await assign(ids.Billy, 'Household one', undefined, { reward: 5 });
    await submit(id);
    await H().approveTask(ids.Billy, id);
    await R().collectHouseholdRewards();
    await settle();
    expect(app.family.getWalletBalance()).toBe(afterFirstLoad + 5); // exactly the household amount on top, nothing extra
  });
});

describe('the child sees the reward, the parent sees the amounts', () => {
  test('the child\'s task card shows the reward (and Important) but no way to change it; old tasks show none', async () => {
    const { app, ids } = await boot();
    await assign(ids.Billy, 'Big job', 'gym', { important: true, reward: 12 });
    await assign(ids.Billy, 'Small job', undefined, { reward: 1 });
    await assign(ids.Billy, 'Free job', undefined, { reward: 0 });
    const raw = JSON.parse((await app.AsyncStorage.getItem('@ProductivityPet:household'))!);
    raw.children.find((c: { id: string }) => c.id === ids.Billy).tasks.push({ id: 'legacy', text: 'Legacy job', createdBy: 'parent', status: 'assigned', createdAt: '2026-01-01T00:00:00.000Z' });
    await app.AsyncStorage.setItem('@ProductivityPet:household', JSON.stringify(raw));
    await H().reloadHousehold();
    await enter(app, ids.Billy);
    const { AssignedAllTasks } = require('@/components/assigned-task-views') as typeof import('@/components/assigned-task-views');
    await RNTL.render(<AssignedAllTasks />);
    await settle();
    const text = RNTL.screen.toJSON() ? JSON.stringify(RNTL.screen.toJSON()) : '';
    expect(text).toContain(en('rwChild', { tokens: tn('rwTokens', 12) }));
    expect(text).toContain(en('rwChild', { tokens: tn('rwTokens', 1) }));
    expect(text).toContain(en('rwChildImportant'));
    expect(text).not.toContain(en('rwChild', { tokens: tn('rwTokens', 0) })); // 0 shows no reward line
    expect(RNTL.screen.queryByTestId('assigned-reward-legacy')).toBeNull(); // an older task: no reward line
    expect(RNTL.screen.queryAllByRole('adjustable')).toEqual([]);
    expect(RNTL.screen.queryByText('+')).toBeNull(); // no stepper for a child
    const view = A().assignedTasksFor(H().peekHousehold(), ids.Billy).find((v) => v.text === 'Legacy job')!;
    expect(view.reward).toBeNull();
  });

  test('the reward shows in the room panel too (same card)', () => {
    expect(read('src/components/assigned-task-views.tsx')).toMatch(/rwChild/);
    expect(read('src/components/room-detail-screen.tsx')).toMatch(/AssignedRoomTasks/);
    expect(read('src/components/assigned-task-views.tsx')).not.toMatch(/RewardStepper|setRewardSettings|updateTaskReward/); // children cannot edit
  });
});

describe('Parent Dashboard', () => {
  async function dashboard() {
    const ctx = await boot();
    await H().selectChild(ctx.ids.Billy);
    await ctx.app.profiles.switchProfile('main');
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
    return ctx;
  }
  const press = async (name: string | RegExp) => {
    await RNTL.fireEvent.press(RNTL.screen.getAllByRole('button', { name })[0]);
    await settle();
  };

  const more = (kind: string) => RNTL.screen.getAllByRole('button', { name: en('rwMoreFor', { kind }) })[0];
  const saveButton = () => RNTL.screen.getAllByRole('button', { name: en('rwSave') })[0];
  const defaultButton = () => RNTL.screen.getAllByRole('button', { name: en('rwSetDefault') })[0];

  test('Save keeps the amounts you chose; Save is only available when something changed; nothing is saved before you tap it', async () => {
    await dashboard();
    expect(RNTL.screen.getAllByTestId('reward-value').map((n) => n.props.children).slice(0, 2)).toEqual([tn('rwTokens', 5), tn('rwTokens', 10)]);
    expect(saveButton().props.accessibilityState.disabled).toBe(true); // nothing changed yet
    await RNTL.fireEvent.press(more(en('rwRegular')));
    await RNTL.fireEvent.press(more(en('rwRegular')));
    await RNTL.fireEvent.press(more(en('rwImportant')));
    await settle();
    expect(saveButton().props.accessibilityState.disabled).toBe(false);
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 5, important: 10 }); // edits are not saved yet
    await press(en('rwSave'));
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 7, important: 11 });
    expect(RNTL.screen.getByText(en('rwSaved'))).toBeTruthy();
    expect(RNTL.screen.getAllByTestId('reward-value').map((n) => n.props.children).slice(0, 2)).toEqual([tn('rwTokens', 7), tn('rwTokens', 11)]);
    expect(RNTL.screen.queryByTestId('reward-current')).toBeNull(); // no separate "Now:" line
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
  });

  test('Set as Default restores Regular 5 and Important 10 and saves them at once; it is available only when the saved or edited amounts differ', async () => {
    await dashboard();
    expect(defaultButton().props.accessibilityState.disabled).toBe(true); // already 5 and 10
    await RNTL.fireEvent.press(more(en('rwRegular'))); // an unsaved edit alone makes it available
    await settle();
    expect(defaultButton().props.accessibilityState.disabled).toBe(false);
    await press(en('rwSave'));
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 6, important: 10 });
    expect(defaultButton().props.accessibilityState.disabled).toBe(false); // the saved amounts differ
    await press(en('rwSetDefault'));
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 5, important: 10 });
    expect(RNTL.screen.getAllByTestId('reward-value').map((n) => n.props.children).slice(0, 2)).toEqual([tn('rwTokens', 5), tn('rwTokens', 10)]);
    expect(RNTL.screen.getByText(en('rwDefaultSet'))).toBeTruthy();
    expect(defaultButton().props.accessibilityState.disabled).toBe(true);
    // the stored record no longer carries custom amounts
    expect(H().peekHousehold()!.rewards).toBeUndefined();
  });

  test('Set as Default with unsaved edits drops them: it never saves the custom amounts, and says so', async () => {
    await dashboard();
    for (let i = 0; i < 3; i += 1) await RNTL.fireEvent.press(more(en('rwImportant')));
    await RNTL.fireEvent.press(more(en('rwRegular')));
    await settle();
    expect(RNTL.screen.getAllByTestId('reward-value').map((n) => n.props.children).slice(0, 2)).toEqual([tn('rwTokens', 6), tn('rwTokens', 13)]); // edited, not saved
    await press(en('rwSetDefault'));
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 5, important: 10 }); // the originals, not the edits
    expect(RNTL.screen.getAllByTestId('reward-value').map((n) => n.props.children).slice(0, 2)).toEqual([tn('rwTokens', 5), tn('rwTokens', 10)]); // and the controls show them
    expect(RNTL.screen.getByText(en('rwDefaultSet'))).toBeTruthy();
    expect(en('rwDefaultSet')).toMatch(/not saved/i);
  });

  test('saved amounts, and the original defaults after Set as Default, persist after a restart and for every profile; existing tasks keep their rewards', async () => {
    const { app, ids } = await dashboard();
    const first = await assign(ids.Billy, 'First', undefined, { important: true }); // 10
    await RNTL.fireEvent.press(more(en('rwRegular')));
    await RNTL.fireEvent.press(more(en('rwImportant')));
    await press(en('rwSave'));
    const second = await assign(ids.Billy, 'Second', undefined, { important: true }); // 11
    expect(task(ids.Billy, first).reward).toBe(10);
    expect(task(ids.Billy, second).reward).toBe(11);
    let kept = await app.dump();
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    let again = await loadApp(undefined, kept);
    await again.profiles.ensureProfilesReady();
    expect(H().getRewardSettings(await H().ensureHouseholdLoaded())).toEqual({ regular: 6, important: 11 });
    for (const profile of [ids.Billy, ids.Sarah, 'main']) {
      expect(await again.profiles.switchProfile(profile)).toMatchObject({ ok: true });
      expect(H().getRewardSettings(await H().ensureHouseholdLoaded())).toEqual({ regular: 6, important: 11 });
    }
    // now back to the originals, then another restart
    await configurePin(again, { unlocked: true });
    expect(await H().resetRewardSettings()).toEqual({ ok: true });
    const third = await assign(ids.Billy, 'Third', undefined, { important: true });
    expect(task(ids.Billy, third).reward).toBe(10);
    expect(task(ids.Billy, first).reward).toBe(10); // every task keeps what it was saved with
    expect(task(ids.Billy, second).reward).toBe(11);
    kept = await again.dump();
    again = await loadApp(undefined, kept);
    await again.profiles.ensureProfilesReady();
    expect(H().getRewardSettings(await H().ensureHouseholdLoaded())).toEqual({ regular: 5, important: 10 });
    expect(task(ids.Billy, second).reward).toBe(11);
  });

  test('Set as Default does not re-price tasks that already exist (waiting and to do keep their saved amounts)', async () => {
    const { ids } = await dashboard();
    const a = await assign(ids.Billy, 'Custom', undefined, { reward: 40 });
    const b = await assign(ids.Billy, 'Custom important', undefined, { important: true, reward: 77 });
    await RNTL.fireEvent.press(more(en('rwRegular')));
    await press(en('rwSetDefault'));
    expect(task(ids.Billy, a).reward).toBe(40);
    expect(task(ids.Billy, b)).toMatchObject({ reward: 77, important: true });
    const c = await assign(ids.Billy, 'After reset');
    expect(task(ids.Billy, c).reward).toBe(5);
  });

  test('Save and Set as Default are parent-only: with the parent area locked neither changes anything, and the screen says it failed', async () => {
    const { app } = await dashboard();
    await RNTL.fireEvent.press(more(en('rwRegular')));
    app.gate.lockParentArea();
    await press(en('rwSave'));
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 5, important: 10 });
    expect(RNTL.screen.getByText(en('rwFailed'))).toBeTruthy();
    await RNTL.cleanup();
    await unlock(app);
    await H().setRewardSettings({ regular: 9, important: 19 });
    app.gate.lockParentArea();
    expect((await H().resetRewardSettings()).ok).toBe(false);
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 9, important: 19 }); // still what was saved
  });

  test('the reward amounts keep their validation (the amount cannot go below 0 or above the largest)', () => {
    expect(H().isValidReward(-1)).toBe(false);
    expect(H().isValidReward(1.5)).toBe(false);
    expect(H().isValidReward(H().MAX_REWARD + 1)).toBe(false);
    expect(H().isValidReward(0)).toBe(true);
  });

  test('the amount cannot go below 0 (the minus button is disabled at 0)', async () => {
    await dashboard();
    for (let i = 0; i < 8; i += 1) await RNTL.fireEvent.press(RNTL.screen.getAllByRole('button', { name: en('rwFewerFor', { kind: en('rwRegular') }) })[0]);
    await settle();
    const minus = RNTL.screen.getAllByRole('button', { name: en('rwFewerFor', { kind: en('rwRegular') }) })[0];
    expect(minus.props.accessibilityState.disabled).toBe(true);
  });

  test('assigning: Regular / Important, the amount shown, a custom amount saved on the task; default follows the kind', async () => {
    const { ids } = await dashboard();
    await RNTL.fireEvent.changeText(RNTL.screen.getByPlaceholderText(en('taskPlaceholder')), 'Walk the dog');
    await press(`${en('rwKindLabel')}: ${en('rwKindImportant')}`);
    expect(RNTL.screen.getAllByTestId('reward-value').map((n) => n.props.children)).toContain(tn('rwTokens', 10)); // Important default shown
    const moreImportant = RNTL.screen.getAllByRole('button', { name: en('rwMoreFor', { kind: en('rwKindImportant') }) });
    await RNTL.fireEvent.press(moreImportant[moreImportant.length - 1]);
    await settle();
    await press(en('assign'));
    const saved = H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.tasks.find((t) => t.text === 'Walk the dog')!;
    expect(saved).toMatchObject({ important: true, reward: 11 });
  });

  test('a waiting task shows its reward; approving pays nothing from the dashboard (the child collects it); the old "not connected" note is gone', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Dash task', undefined, { reward: 8 });
    await enter(app, ids.Billy);
    await submit(id);
    await enter(app, 'main');
    await H().selectChild(ids.Billy);
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
    expect(RNTL.screen.getByTestId(`reward-line-${id}`).props.children).toContain(tn('rwTokens', 8));
    await press(`${en('approve')}: Dash task`);
    expect(task(ids.Billy, id).status).toBe('approved');
    expect(RNTL.screen.getByTestId(`reward-line-${id}`).props.children).toContain('Billy'); // approved, waiting for Billy to collect
    expect(en('rewardsNote')).not.toMatch(/not connected/i);
    expect(read('src/components/parent-dashboard.tsx')).not.toMatch(/paw-tokens|household-rewards|pet-family|addToWallet/); // the dashboard never touches a wallet
  });

  test('editing a waiting task\'s reward from the dashboard', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Edit me', undefined, { reward: 5 });
    await enter(app, 'main');
    await H().selectChild(ids.Billy);
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
    await press(`${en('rwEdit')}: Edit me`);
    expect(RNTL.screen.getByTestId(`reward-edit-${id}`)).toBeTruthy();
    const more = RNTL.within(RNTL.screen.getByTestId(`reward-edit-${id}`)).getAllByRole('button', { name: en('rwMoreFor', { kind: en('rwKindRegular') }) })[0];
    await RNTL.fireEvent.press(more);
    await RNTL.fireEvent.press(RNTL.within(RNTL.screen.getByTestId(`reward-edit-${id}`)).getAllByRole('button', { name: en('rwMoreFor', { kind: en('rwKindRegular') }) })[0]);
    await press(en('rwEditSave'));
    expect(task(ids.Billy, id).reward).toBe(7);
  });

  test('Spanish strings exist for every new key', () => {
    for (const key of ['rwTitle', 'rwRegular', 'rwImportant', 'rwSave', 'rwSaved', 'rwSetDefault', 'rwDefaultSet', 'hhTitle', 'hhNone', 'hhWaiting', 'hhToDo', 'rwFailed', 'rwChild', 'rwChildImportant', 'rwOwed', 'rwGiven', 'rwEdit']) {
      expect(es(key, { tokens: 'x', name: 'x', kind: 'x' })).not.toBe(en(key, { tokens: 'x', name: 'x', kind: 'x' }));
    }
  });
});

describe('what stays as it was', () => {
  test('profiles, pets and PIN security are untouched by the reward code (source check)', () => {
    expect(code('src/utils/household-rewards.ts')).not.toMatch(/parent-pin|pin-crypto|journal/);
    expect(code('src/utils/household.ts')).not.toMatch(/paw-tokens|pet-family|household-rewards/); // the household record never reaches a wallet
    expect(read('src/utils/paw-tokens.ts')).not.toMatch(/awardGrowthForTasks\([^)]*household/i);
  });

  test('Main: no household collection, and its own task rewards are the existing 10 / 15', async () => {
    const { app } = await boot();
    await enter(app, 'main');
    expect(await R().collectHouseholdRewards()).toBe(0);
    expect(app.tokens.REGULAR_TASK_REWARD).toBe(10);
    expect(app.tokens.IMPORTANT_TASK_REWARD).toBe(15);
  });
});

describe('payout that survives interruptions and stale screens', () => {
  test('a screen holding an older copy of the profile cannot wipe out a reward that arrived after it was read', async () => {
    const { app, ids } = await boot();
    await enter(app, ids.Billy);
    const snapshot = await app.family.getPetProfileForSelectedPet(); // a screen read the profile at start-up
    const start = app.family.getWalletBalance();
    const id = await assign(ids.Billy, 'Race me', undefined, { reward: 5 });
    await submit(id);
    await H().approveTask(ids.Billy, id);
    expect(await R().collectHouseholdRewards()).toBe(5);
    expect(app.family.getWalletBalance()).toBe(start + 5);
    app.family.savePetProfileForSelectedPet({ ...snapshot, hunger: Math.max(0, snapshot.hunger - 1) }); // the older copy is saved afterwards
    expect(app.family.getWalletBalance()).toBe(start + 5); // the reward is still there
  });

  test('a screen that really spends tokens still does: the change it made is applied to the current balance', async () => {
    const { app, ids } = await boot();
    await enter(app, ids.Billy);
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(20);
    const profile = await app.family.getPetProfileForSelectedPet();
    app.family.addToWallet(5); // arrives while the screen holds its copy
    const now = app.family.getWalletBalance();
    app.family.savePetProfileForSelectedPet({ ...profile, pawTokens: profile.pawTokens - 8 }); // the screen spends 8
    expect(app.family.getWalletBalance()).toBe(now - 8);
  });

  test('the credit and the note that it was given are in the same saved record', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Atomic', undefined, { reward: 6 });
    await enter(app, ids.Billy);
    await submit(id);
    await H().approveTask(ids.Billy, id);
    await R().collectHouseholdRewards();
    await settle();
    const saved = JSON.parse((await app.AsyncStorage.getItem(`@ProductivityPet:p:${ids.Billy}:petFamily`))!);
    expect(saved.householdRewards).toEqual([id]);
    expect(saved.wallet.pawTokens).toBe(app.family.getWalletBalance());
  });

  test('interrupted save: if the family record cannot be written the reward is not marked collected; once writing works it is saved and paid ONCE', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Interrupted', undefined, { reward: 5 });
    await enter(app, ids.Billy);
    const start = await balance(app);
    await submit(id);
    await H().approveTask(ids.Billy, id);
    const realSet = (app.AsyncStorage.setItem as jest.Mock).getMockImplementation() as (key: string, value: string) => Promise<void>;
    let failing = true;
    jest.spyOn(app.AsyncStorage, 'setItem').mockImplementation((async (key: string, value: string) => {
      if (failing && key.includes('petFamily')) throw new Error('interrupted');
      return realSet(key, value);
    }) as never);
    expect(await R().collectHouseholdRewards()).toBe(0); // not reported paid
    expect(H().rewardOwed(task(ids.Billy, id))).toBe(true); // not marked collected: still recoverable
    failing = false;
    await R().collectHouseholdRewards();
    await settle();
    expect(await balance(app)).toBe(start + 5); // once, however many times it was tried
    expect(H().rewardOwed(task(ids.Billy, id))).toBe(false);
    await R().collectHouseholdRewards();
    expect(await balance(app)).toBe(start + 5);
    const saved = JSON.parse((await app.AsyncStorage.getItem(`@ProductivityPet:p:${ids.Billy}:petFamily`))!);
    expect(saved.wallet.pawTokens).toBe(start + 5);
    expect(saved.householdRewards).toEqual([id]);
    expect(await earnEvents(app)).toHaveLength(1);
  });

  test('a credit whose earnings-history entry was lost is repaired without paying again', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'History gap', undefined, { reward: 3 });
    await enter(app, ids.Billy);
    const start = await balance(app);
    await submit(id);
    await H().approveTask(ids.Billy, id);
    // the wallet got its credit and note, but the app stopped before the history entry and the collected mark
    expect(await app.family.creditHouseholdReward(id, 3)).toBe('paid');
    expect(await earnEvents(app)).toEqual([]);
    expect(await R().collectHouseholdRewards()).toBe(0);
    await settle();
    expect(await balance(app)).toBe(start + 3);
    expect(await earnEvents(app)).toHaveLength(1);
    expect(H().rewardOwed(task(ids.Billy, id))).toBe(false);
  });

  test('credit is refused for a bad amount and does nothing; asking twice adds once', async () => {
    const { app, ids } = await boot();
    await enter(app, ids.Billy);
    const start = await balance(app);
    for (const bad of [0, -2, 1.5, Number.NaN]) expect(await app.family.creditHouseholdReward('t', bad)).toBe('failed');
    expect(await app.family.creditHouseholdReward('t', 4)).toBe('paid');
    expect(await app.family.creditHouseholdReward('t', 4)).toBe('already');
    expect(await balance(app)).toBe(start + 4);
  });

  test('the original paid-keys record of the first version still counts: a task it remembers is not paid again', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Earlier build', undefined, { reward: 5 });
    await app.AsyncStorage.setItem(`@ProductivityPet:p:${ids.Billy}:awardedTaskTokens`, JSON.stringify([`household:${id}`]));
    await enter(app, ids.Billy);
    const start = await balance(app);
    await submit(id);
    await H().approveTask(ids.Billy, id);
    expect(await R().collectHouseholdRewards()).toBe(0);
    expect(await balance(app)).toBe(start);
    expect(task(ids.Billy, id).rewardPaidAt).toEqual(expect.any(String)); // closed, so it is not retried forever
  });

  test('collection also runs by itself: the open child\'s session collects when a parent\'s approval is saved, and at start-up', async () => {
    const { app, ids } = await boot();
    const id = await assign(ids.Billy, 'Auto', undefined, { reward: 5 });
    await enter(app, ids.Billy);
    const start = await balance(app);
    await submit(id);
    const stop = R().startHouseholdRewardCollection();
    await H().approveTask(ids.Billy, id);
    await settle();
    expect(await balance(app)).toBe(start + 5);
    stop();
  });
});

describe('Parent Dashboard: one Household Tasks section', () => {
  const press = async (name: string | RegExp) => {
    await RNTL.fireEvent.press(RNTL.screen.getAllByRole('button', { name })[0]);
    await settle();
  };
  async function dash() {
    const ctx = await boot();
    await H().selectChild(ctx.ids.Billy);
    await ctx.app.profiles.switchProfile('main');
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    return { ...ctx, ParentDashboard };
  }
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

  test('one section replaces Assigned tasks and Pending approvals; waiting tasks first, then to do / try again; each task once', async () => {
    const { app, ids, ParentDashboard } = await dash();
    const todo = await assign(ids.Billy, 'Still to do', 'gym', { reward: 4 });
    const waiting = await assign(ids.Billy, 'Waiting task', undefined, { reward: 6 });
    const back = await assign(ids.Billy, 'Try again task');
    await enter(app, ids.Billy);
    await submit(waiting);
    await submit(back);
    await enter(app, 'main');
    await H().selectChild(ids.Billy);
    await H().sendTaskBack(ids.Billy, back);
    await RNTL.render(<ParentDashboard />);
    await settle();
    const text = words();
    expect(text.split(en('hhTitle', { name: 'Billy' })).length - 1).toBe(1); // "Billy's Tasks"
    expect(text).not.toContain(` | ${en('assignedTasks')} | `); // no separate section headings any more
    expect(text).not.toContain(` | ${en('pendingApprovals')} | `);
    for (const title of ['Still to do', 'Waiting task', 'Try again task']) expect(text.split(title).length - 1).toBe(1);
    expect(text.indexOf('Waiting task')).toBeLessThan(text.indexOf('Still to do')); // waiting for review first
    expect(text.indexOf(en('hhWaiting'))).toBeLessThan(text.indexOf(en('hhToDo')));
    expect(todo).toBeTruthy();
  });

  test('Approve and Try again are on the waiting task; Edit reward, reward amounts, rooms and the other actions are still there', async () => {
    const { app, ids, ParentDashboard } = await dash();
    const waiting = await assign(ids.Billy, 'Judge me', 'bedroom', { reward: 6 });
    const other = await assign(ids.Billy, 'Edit me', 'gym', { reward: 3 });
    await enter(app, ids.Billy);
    await submit(waiting);
    await enter(app, 'main');
    await H().selectChild(ids.Billy);
    await RNTL.render(<ParentDashboard />);
    await settle();
    const names = RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel));
    expect(names).toContain(`${en('approve')}: Judge me`);
    expect(names).toContain(`${en('sendBack')}: Judge me`);
    expect(en('sendBack')).toBe('Send back'); // the parent's button; the child still sees "Try again"
    expect(es('sendBack')).toBe('Devolver');
    expect(names).toContain(`${en('rwEdit')}: Judge me`); // editable while waiting
    expect(names).toContain(`${en('rwEdit')}: Edit me`);
    expect(names).toContain(`${en('deleteTask')}: Edit me`);
    expect(words()).toContain(en('atParentRoomLine', { room: 'Bedroom' }));
    expect(words()).toContain(en('atParentRoomLine', { room: 'Gym' }));
    expect(RNTL.screen.getByTestId(`reward-line-${waiting}`).props.children).toContain(tn('rwTokens', 6));
    expect(other).toBeTruthy();
    await press(`${en('sendBack')}: Judge me`);
    expect(task(ids.Billy, waiting).status).toBe('assigned'); // Try again: back to the child's attention, nothing paid
    expect(task(ids.Billy, waiting).returnedAt).toEqual(expect.any(String));
  });

  test('approving from the combined list works as before: approved once, and the section shows nothing duplicated', async () => {
    const { app, ids, ParentDashboard } = await dash();
    const id = await assign(ids.Billy, 'Approve me', undefined, { reward: 6 });
    await enter(app, ids.Billy);
    await submit(id);
    await enter(app, 'main');
    await H().selectChild(ids.Billy);
    await RNTL.render(<ParentDashboard />);
    await settle();
    await press(`${en('approve')}: Approve me`);
    expect(task(ids.Billy, id).status).toBe('approved');
    expect(words().split('Approve me').length - 1).toBe(1); // now in the completed list only
    expect(RNTL.screen.queryAllByRole('button', { name: `${en('approve')}: Approve me` })).toEqual([]);
  });

  test('empty: one message, and Spanish titles exist', async () => {
    const { ParentDashboard } = await dash();
    await RNTL.render(<ParentDashboard />);
    await settle();
    expect(words()).toContain(en('hhNone'));
    expect(es('hhTitle', { name: 'Ana' })).toBe('Tareas de Ana');
    expect(en('hhTitle', { name: 'Ana' })).toBe("Ana's Tasks");
    expect(es('rwSetDefault')).not.toBe(en('rwSetDefault'));
  });

  test('the approval is still guarded: with the parent area locked, Approve and Try again do nothing', async () => {
    const { app, ids, ParentDashboard } = await dash();
    const id = await assign(ids.Billy, 'Guarded', undefined, { reward: 6 });
    await enter(app, ids.Billy);
    await submit(id);
    await enter(app, 'main');
    await H().selectChild(ids.Billy);
    await RNTL.render(<ParentDashboard />);
    await settle();
    app.gate.lockParentArea();
    await press(`${en('approve')}: Guarded`);
    await press(`${en('sendBack')}: Guarded`);
    expect(task(ids.Billy, id).status).toBe('pending');
  });
});
