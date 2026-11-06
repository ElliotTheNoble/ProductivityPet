import { DAY, T0, TEST_PIN, configurePin, flush, freezeClock, iso, loadApp, resetSecure, secureTest, setClock, unfreezeClock, type App } from './helpers';

// Stage 3.0: every parent-only action asks "is a verified parent session open RIGHT NOW?" at the moment it runs (the data layer, not only
// the screen), and a household that has children but no completed Parent PIN fails closed. Real PIN module, real parent gate.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
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

const P = '@ProductivityPet:';
const HOUSEHOLD = `${P}household`;
const REGISTRY = `${P}profiles`;
const MARKER = `${P}parentAuth`;

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const task = (id: string, status: string) => ({ id, text: id, createdBy: 'parent', status, createdAt: iso(T0) });
const child = (id: string, extra: object = {}) => ({
  id,
  nickname: id,
  createdAt: iso(T0),
  settings: { canCreateTasks: true, requireApproval: true, petSafety: 'gentle' },
  tasks: [task('t-pending', 'pending'), task('t-pending2', 'pending'), task('t-assigned', 'assigned')],
  ...extra,
});
const household = (children: object[]) => JSON.stringify({ version: 1, parent: null, children, selectedChildId: null });
const H = () => require('@/utils/household') as typeof import('@/utils/household');
const S = () => require('@/utils/parent-session') as typeof import('@/utils/parent-session');

type PinState = 'none' | 'pending' | 'ready' | 'unconfirmed' | 'missing' | 'unavailable' | 'unavailable-after-setup';

async function boot(options: { family?: boolean; seed?: Record<string, string>; pin?: PinState; unlocked?: boolean } = {}): Promise<App> {
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  resetSecure();
  if (options.pin === 'unavailable') secureTest().available = false;
  const app = await loadApp(options.seed);
  await app.profiles.ensureProfilesReady();
  if (options.family === false) return app;
  app.pin.startParentAuth({ enabled: true, platformOS: 'ios' });
  switch (options.pin) {
    case 'ready':
    case 'unconfirmed':
    case 'missing':
    case 'unavailable-after-setup':
      await configurePin(app, { unlocked: options.unlocked, unconfirmed: options.pin === 'unconfirmed' });
      if (options.pin === 'missing') secureTest().map.clear(); // the marker stays, the secret is gone (a restore, a new device)
      if (options.pin === 'unavailable-after-setup') secureTest().available = false;
      break;
    case 'pending': {
      const claim = require('@/utils/family-claim') as typeof import('@/utils/family-claim');
      await claim.grantSetupClaim();
      await app.pin.beginPinSetup(TEST_PIN); // an unfinished setup: nothing is protected
      claim.clearSetupClaim();
      break;
    }
    default:
      break;
  }
  return app;
}

// Every parent-only household action, with what it would change.
function actions(id: string) {
  return {
    saveParentProfile: () => H().saveParentProfile('Dad', 'Smith'),
    updateChildSettings: () => H().updateChildSettings(id, { canCreateTasks: false }),
    addTask: () => H().addTask(id, 'new task', 'parent'),
    approveTask: () => H().approveTask(id, 't-pending'),
    sendTaskBack: () => H().sendTaskBack(id, 't-pending2'),
    deleteTask: () => H().deleteTask(id, 't-assigned'),
    addChild: () => H().addChild('Newbie'),
    renameChild: () => H().renameChild(id, 'Renamed'),
    setChildArchived: () => H().setChildArchived(id, true),
  } as const;
}
const NAMES = Object.keys(actions('x')) as (keyof ReturnType<typeof actions>)[];
const seeded = () => ({ [HOUSEHOLD]: household([child('kid-a')]) });
const stored = async (app: App, key: string) => app.AsyncStorage.getItem(key);

// ---------------------------------------------------------------------------------------------------------
describe('a household with children and no completed Parent PIN fails closed', () => {
  const closed: [PinState, string][] = [
    ['none', 'pin-required'],
    ['pending', 'pin-required'],
    ['unavailable', 'pin-required'],
    ['missing', 'locked'],
    ['unavailable-after-setup', 'locked'],
    ['unconfirmed', 'locked'],
    ['ready', 'locked'],
  ];

  test.each(closed)('PIN state "%s": every parent-only action is refused ("%s"), changes nothing and creates nothing', async (pin, reason) => {
    const app = await boot({ seed: seeded(), pin });
    const before = await stored(app, HOUSEHOLD);
    const registryBefore = await stored(app, REGISTRY);
    const markerBefore = await stored(app, MARKER);
    const secureBefore = secureTest().sets.length;
    for (const name of NAMES) {
      const result = await actions('kid-a')[name]();
      expect([name, result]).toEqual([name, { ok: false, reason }]);
    }
    await H().selectChild('kid-a'); // returns nothing; must not write either
    expect(await stored(app, HOUSEHOLD)).toBe(before);
    expect(await stored(app, REGISTRY)).toBe(registryBefore); // no profile was registered for the refused "add a child"
    expect(await stored(app, MARKER)).toBe(markerBefore);
    expect(secureTest().sets.length).toBe(secureBefore); // nothing credential-related was written
  });

  test('an open session whose recovery code was never confirmed is refused too ("unconfirmed")', async () => {
    const app = await boot({ seed: seeded(), pin: 'unconfirmed' });
    expect(await app.gate.unlockParentArea(TEST_PIN)).toEqual({ ok: true }); // the PIN itself is right
    const before = await stored(app, HOUSEHOLD);
    for (const name of NAMES) expect([name, await actions('kid-a')[name]()]).toEqual([name, { ok: false, reason: 'unconfirmed' }]);
    expect(await stored(app, HOUSEHOLD)).toBe(before);
  });

  test('with a verified, confirmed PIN session every one of them works', async () => {
    const app = await boot({ seed: seeded(), pin: 'ready', unlocked: true });
    for (const name of ['saveParentProfile', 'updateChildSettings', 'addTask', 'approveTask', 'sendTaskBack', 'deleteTask', 'renameChild'] as const) {
      expect([name, (await actions('kid-a')[name]()).ok]).toEqual([name, true]);
    }
    const added = await actions('kid-a').addChild();
    expect(added.ok).toBe(true);
    expect((await actions('kid-a').setChildArchived()).ok).toBe(true);
    void app;
  });

  test('child-side actions are not parent-only: a child still marks a task done, and adds one when allowed', async () => {
    await boot({ seed: seeded(), pin: 'ready' });
    expect((await H().markTaskDone('kid-a', 't-assigned')).ok).toBe(true);
    expect((await H().addTask('kid-a', 'my own', 'child')).ok).toBe(true);
  });

  test('a household with no child record at all keeps the first set-up open (parent profile), but a child can only be added with a PIN', async () => {
    const app = await boot({ pin: 'none' });
    expect((await H().saveParentProfile('Dad', 'Smith')).ok).toBe(true);
    expect(await H().addChild('Mia')).toEqual({ ok: false, reason: 'pin-required' });
    expect(JSON.parse((await stored(app, HOUSEHOLD))!).children).toEqual([]);
  });

  test('an unreadable family list counts as "has children": nothing parent-only is allowed without a PIN', async () => {
    const app = await boot({ seed: seeded(), pin: 'none' });
    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === HOUSEHOLD) throw new Error('read failed');
      return original(key);
    });
    expect(await S().checkParentAction('parent')).toEqual({ ok: false, reason: 'pin-required' });
    const spy = jest.spyOn(app.AsyncStorage, 'setItem');
    spy.mockClear();
    expect((await H().saveParentProfile('Dad', 'Smith')).ok).toBe(false);
    expect(spy.mock.calls.some((c) => c[0] === HOUSEHOLD)).toBe(false); // nothing was written over the household
    app.AsyncStorage.getItem = original;
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('stale, locked and backgrounded sessions cannot manage anything', () => {
  test('a session that ended (idle) is refused: the screen cannot keep a form alive past it', async () => {
    const app = await boot({ seed: seeded(), pin: 'ready', unlocked: true });
    expect((await H().renameChild('kid-a', 'Mia')).ok).toBe(true);
    setClock(T0 + 6 * 60 * 1000); // five minutes of idle is the limit
    expect(await H().renameChild('kid-a', 'Zoe')).toEqual({ ok: false, reason: 'locked' });
    expect(JSON.parse((await stored(app, HOUSEHOLD))!).children[0].nickname).toBe('Mia');
  });

  test('activity keeps it open, but never past the longest session', async () => {
    const app = await boot({ seed: seeded(), pin: 'ready', unlocked: true });
    for (let minute = 4; minute <= 28; minute += 4) {
      setClock(T0 + minute * 60 * 1000);
      app.gate.touchParentSession();
      expect((await H().updateChildSettings('kid-a', { requireApproval: minute % 8 === 0 })).ok).toBe(true);
    }
    setClock(T0 + 31 * 60 * 1000);
    app.gate.touchParentSession();
    expect(await H().updateChildSettings('kid-a', { requireApproval: false })).toEqual({ ok: false, reason: 'locked' });
  });

  test('locking the parent area, switching profile or going back to the picker refuses the next action', async () => {
    const app = await boot({ seed: seeded(), pin: 'ready', unlocked: true });
    app.gate.lockParentArea();
    expect(await H().approveTask('kid-a', 't-pending')).toEqual({ ok: false, reason: 'locked' });
    await app.gate.unlockParentArea(TEST_PIN);
    expect((await H().approveTask('kid-a', 't-pending')).ok).toBe(true);
  });

  test('the app going to the background locks it, and the next action is refused', async () => {
    const app = await boot({ seed: seeded(), pin: 'ready', unlocked: true });
    const spy = jest.spyOn(require('react-native').AppState, 'addEventListener');
    app.gate.startParentGateAutoLock();
    const handler = spy.mock.calls.filter((c) => c[0] === 'change').at(-1)![1] as (s: string) => void; // the one just registered
    expect((await H().renameChild('kid-a', 'One')).ok).toBe(true);
    handler('background');
    expect(await H().renameChild('kid-a', 'Two')).toEqual({ ok: false, reason: 'locked' });
    spy.mockRestore();
  });

  test('a profile change locks it, and the next action is refused', async () => {
    const app = await boot({ seed: seeded(), pin: 'ready', unlocked: true });
    app.gate.startParentGateAutoLock();
    await app.profiles.registerChildProfile('kid-a');
    expect(await app.profiles.switchProfile('kid-a')).toMatchObject({ ok: true });
    expect(await H().deleteTask('kid-a', 't-assigned')).toEqual({ ok: false, reason: 'locked' });
  });

  test('a session that ends WHILE the action is being prepared is refused at the last look, and nothing is saved', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: household([]) }, pin: 'ready', unlocked: true });
    // the profile registry is slow to answer; the session ends in the meantime
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === REGISTRY) {
        app.gate.lockParentArea();
        await flush();
      }
      return original(key, value);
    });
    const result = await H().addChild('Mia');
    app.AsyncStorage.setItem = original;
    expect(result).toEqual({ ok: false, reason: 'locked' });
    expect(JSON.parse((await stored(app, HOUSEHOLD))!).children).toEqual([]); // no child record
  });

  test('restarting the family set-up needs the same: a verified session, or an empty household with no PIN', async () => {
    const closed = await boot({ seed: seeded(), pin: 'none' });
    await closed.onboarding.ensureOnboardingLoaded();
    await closed.onboarding.skipOnboarding();
    await closed.onboarding.restartOnboarding();
    expect((await closed.onboarding.ensureOnboardingLoaded()).status).toBe('skipped'); // refused

    const open = await boot({ pin: 'none' });
    await open.onboarding.ensureOnboardingLoaded();
    await open.onboarding.skipOnboarding();
    await open.onboarding.restartOnboarding();
    expect((await open.onboarding.ensureOnboardingLoaded()).status).toBe('pending'); // the first set-up still works

    const ready = await boot({ seed: seeded(), pin: 'ready', unlocked: true });
    await ready.onboarding.ensureOnboardingLoaded();
    await ready.onboarding.skipOnboarding();
    await ready.onboarding.restartOnboarding();
    expect((await ready.onboarding.ensureOnboardingLoaded()).status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the original single-user app (family mode off) is unchanged', () => {
  test('nothing is checked and nothing PIN-related is even loaded', async () => {
    const app = await boot({ family: false, seed: seeded() });
    expect(await S().checkParentAction('children')).toEqual({ ok: true });
    for (const name of NAMES) expect([name, (await actions('kid-a')[name]()).ok]).toEqual([name, true]);
    expect(secureTest().loaded).toBe(0); // the secure store module was never loaded
    expect(app.gate.hasPinVerifier()).toBe(false);
    expect(await stored(app, REGISTRY)).toBeDefined();
  });

  test('restarting the set-up works with no PIN, as always', async () => {
    const app = await boot({ family: false, seed: seeded() });
    await app.onboarding.ensureOnboardingLoaded();
    await app.onboarding.skipOnboarding();
    await app.onboarding.restartOnboarding();
    expect((await app.onboarding.ensureOnboardingLoaded()).status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('a missing, unconfirmed, damaged or unavailable PIN is never replaced automatically', () => {
  const states: PinState[] = ['missing', 'unconfirmed', 'unavailable-after-setup', 'ready'];

  test.each(states)('PIN state "%s": the setup cannot be started, and the existing PIN records are untouched', async (pin) => {
    const app = await boot({ seed: seeded(), pin });
    const claim = require('@/utils/family-claim') as typeof import('@/utils/family-claim');
    expect(await claim.grantSetupClaim()).toBe(false); // a claim is only ever granted while no PIN exists
    const marker = await stored(app, MARKER);
    const secure = new Map(secureTest().map);
    const result = await app.pin.beginPinSetup('135792');
    expect(result.ok).toBe(false);
    expect(await stored(app, MARKER)).toBe(marker);
    expect([...secureTest().map]).toEqual([...secure]);
  });

  test('a damaged marker with a valid secret is repaired from that secret (the PIN is never replaced)', async () => {
    const app = await boot({ seed: seeded(), pin: 'ready' });
    const secure = new Map(secureTest().map);
    await app.AsyncStorage.setItem(MARKER, '{broken');
    const state = await app.pin.getAuthState();
    expect(state.kind).toBe('ready');
    expect(secureTest().map.get([...secure.keys()].find((k) => /record/i.test(k)) ?? '')).toBe(secure.get([...secure.keys()].find((k) => /record/i.test(k)) ?? ''));
  });

  test('a restore that lost the PIN secret keeps Main and parent management locked and offers no setup', async () => {
    const app = await boot({ seed: seeded(), pin: 'missing' });
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    expect(await app.gate.unlockParentArea(TEST_PIN)).toMatchObject({ ok: false, reason: 'verifier-missing' });
    expect(await S().checkParentAction('parent')).toEqual({ ok: false, reason: 'locked' });
    void DAY;
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('a session revoked DURING the operation stops the write (final-review cases)', () => {
  test.each(NAMES)('%s: the session ends while the storage is being read, so nothing is written', async (name) => {
    const app = await boot({ seed: seeded(), pin: 'ready', unlocked: true });
    await H().ensureHouseholdLoaded(); // the household is in memory; the next read is the one inside the save
    const before = await stored(app, HOUSEHOLD);
    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      const value = await original(key);
      if (key === HOUSEHOLD) app.gate.lockParentArea(); // revoked right after the read, before the write
      return value;
    });
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    setItem.mockClear();
    const result = await actions('kid-a')[name]();
    app.AsyncStorage.getItem = original;
    expect([name, result]).toEqual([name, { ok: false, reason: 'locked' }]);
    expect(setItem.mock.calls.some((c) => c[0] === HOUSEHOLD || String(c[0]).startsWith(`${HOUSEHOLD}.corrupt`))).toBe(false);
    expect(await stored(app, HOUSEHOLD)).toBe(before);
  });

  test('a session revoked by an expiry (not only an explicit lock) stops the write too', async () => {
    const app = await boot({ seed: seeded(), pin: 'ready', unlocked: true });
    await H().ensureHouseholdLoaded();
    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      const value = await original(key);
      if (key === HOUSEHOLD) setClock(T0 + 6 * 60 * 1000); // five idle minutes pass while the storage answers
      return value;
    });
    expect(await H().renameChild('kid-a', 'Late')).toEqual({ ok: false, reason: 'locked' });
    app.AsyncStorage.getItem = original;
  });
});

describe('the setup claim authorizes nothing else (final-review cases)', () => {
  test('with a valid claim and no PIN, no parent management action and no parent check passes', async () => {
    const app = await boot({ seed: seeded(), pin: 'none' });
    const claim = require('@/utils/family-claim') as typeof import('@/utils/family-claim');
    expect(await claim.grantSetupClaim()).toBe(true);
    const before = await stored(app, HOUSEHOLD);
    for (const name of NAMES) expect([name, await actions('kid-a')[name]()]).toEqual([name, { ok: false, reason: 'pin-required' }]);
    expect(await S().checkParentAction('parent')).toEqual({ ok: false, reason: 'pin-required' });
    expect((await app.gate.getParentAccess()).state).toBe('unprotected'); // nothing was opened
    expect(await stored(app, HOUSEHOLD)).toBe(before);
  });

  test('the claim is single-use: starting the setup spends it, and a second attempt needs the device check again', async () => {
    const app = await boot({ seed: seeded(), pin: 'none' });
    const claim = require('@/utils/family-claim') as typeof import('@/utils/family-claim');
    await claim.grantSetupClaim();
    expect((await app.pin.beginPinSetup('135792')).ok).toBe(true);
    expect(claim.hasSetupClaim()).toBe(false);
    expect(await app.pin.beginPinSetup('135792')).toEqual({ ok: false, reason: 'claim-required' });
  });

  test('finishing the PIN setup clears a claim granted meanwhile, and a PIN that exists is never replaced even with a claim', async () => {
    const app = await boot({ seed: seeded(), pin: 'none' });
    const claim = require('@/utils/family-claim') as typeof import('@/utils/family-claim');
    await claim.grantSetupClaim();
    const begun = await app.pin.beginPinSetup('135792');
    if (!begun.ok) throw new Error('setup failed');
    await claim.grantSetupClaim(); // a second device check while the setup is open
    expect(claim.hasSetupClaim()).toBe(true);
    expect(await app.pin.confirmPinSetup('135792', begun.recoveryCode)).toEqual({ ok: true });
    expect(claim.hasSetupClaim()).toBe(false); // the PIN exists: no claim is valid any more
    expect(await claim.grantSetupClaim()).toBe(false);
    expect(await app.pin.beginPinSetup('864209')).toMatchObject({ ok: false }); // never replaced
  });

  test('no claim can be granted with family mode off', async () => {
    await boot({ family: false, seed: seeded() });
    const claim = require('@/utils/family-claim') as typeof import('@/utils/family-claim');
    expect(await claim.grantSetupClaim()).toBe(false);
  });
});
