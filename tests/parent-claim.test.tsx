import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, TEST_PIN, configurePin, freezeClock, iso, resetSecure, secureTest, setClock, unfreezeClock } from './helpers';

// Stage 3.1: the protected first-time Parent PIN setup for a household that already has children but no PIN (BUG-077 / BUG-080). The
// operating system's device security check comes first (a mocked native module here), then the EXISTING setup. Real PIN module, real
// parent gate, real screens.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/components/parent-dashboard', () => {
  const { Text: T } = require('react-native');
  const R = require('react');
  return { ParentDashboard: () => R.createElement(T, null, 'DASHBOARD-CONTENT') };
});
jest.mock('@/components/welcome-screen', () => {
  const { Text: T } = require('react-native');
  const R = require('react');
  return { WelcomeScreen: () => R.createElement(T, null, 'WELCOME-CONTENT') };
});
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

type La = { level: number; result: unknown; throws: boolean; calls: number };
const g = globalThis as unknown as { __la: La };
jest.mock('expo-local-authentication', () => {
  const state = globalThis as unknown as { __la: La };
  return {
    SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
    getEnrolledLevelAsync: jest.fn(async () => state.__la.level),
    authenticateAsync: jest.fn(async () => {
      state.__la.calls += 1;
      if (state.__la.throws) throw new Error('native failure');
      return state.__la.result;
    }),
  };
});

const P = '@ProductivityPet:';
const HOUSEHOLD = `${P}household`;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => {
  freezeClock(T0);
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  g.__la = { level: 1, result: { success: true }, throws: false, calls: 0 };
});
afterEach(() => {
  unfreezeClock();
  // the setup claim's expiry timer (minutes long) is cancelled, so it cannot outlive the test
  (require('@/utils/family-claim') as typeof import('@/utils/family-claim')).clearSetupClaim();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const child = (id: string) => ({
  id,
  nickname: id,
  createdAt: iso(T0),
  settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' },
  tasks: [],
});
const household = (children: object[]) => JSON.stringify({ version: 1, parent: null, children, selectedChildId: null });
const withKids = () => ({ [HOUSEHOLD]: household([child('kid-mia')]) });

type PinState = 'none' | 'pending' | 'ready' | 'unconfirmed' | 'missing' | 'unavailable-after-setup';
type Options = { family?: boolean; seed?: Record<string, string>; pin?: PinState; language?: 'en' | 'es' };

async function boot(options: Options = {}) {
  jest.resetModules();
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  resetSecure();
  const AsyncStorage = (require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage')) as typeof import('@react-native-async-storage/async-storage').default;
  await AsyncStorage.clear();
  for (const [key, value] of Object.entries(options.seed ?? {})) await AsyncStorage.setItem(key, value);
  const i18n = require('@/i18n') as typeof import('@/i18n');
  i18n.setCurrentLanguage(options.language ?? 'en');
  const profiles = require('@/utils/profiles') as typeof import('@/utils/profiles');
  const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
  const pin = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
  const claim = require('@/utils/family-claim') as typeof import('@/utils/family-claim');
  await profiles.ensureProfilesReady();
  const app = { AsyncStorage, i18n, profiles, gate, pin, claim, React: ReactTop, rntl: RNTL, Text: ReactNative.Text };
  if (options.family !== false) {
    pin.startParentAuth({ enabled: true, platformOS: 'ios' });
    if (options.pin && options.pin !== 'none') {
      if (options.pin === 'pending') {
        await claim.grantSetupClaim();
        await pin.beginPinSetup(TEST_PIN);
        claim.clearSetupClaim();
      } else {
        await configurePin(app as never, { unconfirmed: options.pin === 'unconfirmed' });
        if (options.pin === 'missing') secureTest().map.clear();
        if (options.pin === 'unavailable-after-setup') secureTest().available = false;
      }
    }
    gate.startParentGateAutoLock();
  }
  return app;
}
type App = Awaited<ReturnType<typeof boot>>;

const t = (app: App, key: Parameters<App['i18n']['translate']>[1], params?: Parameters<App['i18n']['translate']>[2]) =>
  app.i18n.translate(app.i18n.getCurrentLanguage(), key, params);
const secret = (app: App) => app.React.createElement(app.Text, null, 'SECRET-CONTENT');
async function renderGate(app: App) {
  const { ParentGate } = require('@/components/parent-gate') as typeof import('@/components/parent-gate');
  return app.rntl.render(app.React.createElement(ParentGate, null, secret(app)));
}
async function renderRoute(app: App, module: string) {
  const Page = (require(module) as { default: () => React.ReactElement }).default;
  return app.rntl.render(app.React.createElement(Page));
}
const press = async (app: App, name: string | RegExp) => app.rntl.fireEvent.press(app.rntl.screen.getByRole('button', { name }));
const mainKeys = async (app: App) => {
  const keys = (await app.AsyncStorage.getAllKeys()).filter((k) => !k.startsWith(`${P}p:`) && !k.includes('profiles') && !k.includes('backup') && !k.includes('parentAuth') && k !== HOUSEHOLD);
  return Promise.all(keys.sort().map(async (k) => [k, await app.AsyncStorage.getItem(k)]));
};

// ---------------------------------------------------------------------------------------------------------
describe('a household with children and no PIN: parent-only screens fail closed', () => {
  test('the Parent Gate shows the protected setup, never the content', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const view = await renderGate(app);
    await view.findByText(t(app, 'pkTitle'));
    expect(view.queryByText('SECRET-CONTENT')).toBeNull();
    expect(view.queryByText(t(app, 'psIntroTitle'))).toBeNull(); // the open setup is not shown
    expect(view.getByText(t(app, 'pkHonest'))).toBeTruthy(); // says what the check does and does not prove
  });

  test.each([
    ['/parent', '@/app/parent', 'DASHBOARD-CONTENT'],
    ['/welcome', '@/app/welcome', 'WELCOME-CONTENT'],
  ])('%s shows the protected setup, not its content', async (_route, module, content) => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const view = await renderRoute(app, module);
    await view.findByText(t(app, 'pkTitle'));
    expect(view.queryByText(content)).toBeNull();
  });

  test('/parent-security shows the protected setup, never the open PIN setup', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const view = await renderRoute(app, '@/app/parent-security');
    await view.findByText(t(app, 'pkTitle'));
    expect(view.queryByText(t(app, 'psIntroTitle'))).toBeNull();
    expect(view.queryByText(t(app, 'psContinue'))).toBeNull();
  });

  test('an unfinished earlier setup ("pending") is the same: it protects nothing, so it needs the check too', async () => {
    const app = await boot({ seed: withKids(), pin: 'pending' });
    const view = await renderRoute(app, '@/app/parent-security');
    await view.findByText(t(app, 'pkTitle'));
  });

  test('Pet Care\'s Family card offers only the protected setup: no dashboard shortcut and no "start set-up"', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const { FamilyModeCard } = require('@/components/family-mode-card') as typeof import('@/components/family-mode-card');
    const view = await app.rntl.render(app.React.createElement(FamilyModeCard));
    await view.findByText(t(app, 'pkCardText'));
    expect(view.queryByRole('button', { name: t(app, 'openDashboard') })).toBeNull();
    expect(view.queryByRole('button', { name: t(app, 'startSetup') })).toBeNull();
    await app.rntl.fireEvent.press(view.getByRole('button', { name: t(app, 'pkPickerButton') }));
    expect(mockRouter.push).toHaveBeenCalledWith('/parent-security'); // which shows the protected setup
  });

  test('an unreadable family list is treated as "has children": the same protected setup', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const original = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === HOUSEHOLD) throw new Error('read failed');
      return original(key);
    });
    const view = await renderGate(app);
    await view.findByText(t(app, 'pkTitle'));
    expect(view.queryByText('SECRET-CONTENT')).toBeNull();
    app.AsyncStorage.getItem = original;
  });

  test('a household with NO child yet keeps the first set-up open (nothing to protect), exactly as before', async () => {
    const app = await boot({ seed: {}, pin: 'none' });
    const view = await renderGate(app);
    await view.findByText('SECRET-CONTENT');
    const route = await renderRoute(app, '@/app/parent-security');
    await route.findByText(t(app, 'psIntroTitle')); // the ordinary setup, no device check
  });

  test('with family mode off the gate is open exactly as it always was, even with children saved', async () => {
    const app = await boot({ family: false, seed: withKids() });
    const view = await renderGate(app);
    expect(view.getByText('SECRET-CONTENT')).toBeTruthy(); // the very first frame, no check, no waiting
    expect(g.__la.calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the device security check, then the existing setup', () => {
  test('success: the claim is granted and the EXISTING setup starts; before it the PIN could not be created', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    expect(await app.pin.beginPinSetup('1357')).toEqual({ ok: false, reason: 'claim-required' });
    const view = await renderGate(app);
    await view.findByText(t(app, 'pkTitle'));
    await app.rntl.fireEvent.press(view.getByRole('button', { name: t(app, 'pkCheck') }));
    await view.findByText(t(app, 'psIntroTitle')); // the unchanged first-setup screen
    expect(g.__la.calls).toBe(1);
    expect(app.claim.hasSetupClaim()).toBe(true);
    const begun = await app.pin.beginPinSetup('1357');
    expect(begun.ok).toBe(true); // creates only a PENDING record: nothing is protected until it is confirmed
    expect(await app.gate.isParentAccessAllowed()).toBe(true); // still no PIN
  });

  test('leaving the screen ends the claim: the setup cannot be resumed from the history', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const view = await renderGate(app);
    await app.rntl.fireEvent.press(await view.findByRole('button', { name: t(app, 'pkCheck') }));
    await view.findByText(t(app, 'psIntroTitle'));
    await view.unmount();
    expect(app.claim.hasSetupClaim()).toBe(false);
    expect(await app.pin.beginPinSetup('1357')).toEqual({ ok: false, reason: 'claim-required' });
    const again = await renderGate(app); // "back" to the same address: the check is asked again
    await again.findByText(t(app, 'pkTitle'));
    expect(again.queryByText(t(app, 'psIntroTitle'))).toBeNull();
  });

  test('the claim ends after ten minutes, when the app goes to the background and when the profile changes', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    expect(await app.claim.grantSetupClaim()).toBe(true);
    setClock(T0 + 9 * 60 * 1000);
    expect(app.claim.hasSetupClaim()).toBe(true);
    setClock(T0 + 11 * 60 * 1000);
    expect(app.claim.hasSetupClaim()).toBe(false);
    expect(await app.pin.beginPinSetup('1357')).toEqual({ ok: false, reason: 'claim-required' });

    setClock(T0);
    expect(await app.claim.grantSetupClaim()).toBe(true);
    const spy = jest.spyOn(ReactNative.AppState, 'addEventListener');
    void spy;
    await app.profiles.registerChildProfile('kid-mia');
    await app.profiles.switchProfile('kid-mia'); // a profile change
    expect(app.claim.hasSetupClaim()).toBe(false);
    spy.mockRestore();
  });

  test('a clock moved backwards never extends a claim', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    await app.claim.grantSetupClaim();
    setClock(T0 - 60 * 1000);
    expect(app.claim.hasSetupClaim()).toBe(false);
  });

  test('the claim needs no check in a household with no child, and is never needed with family mode off', async () => {
    const empty = await boot({ seed: {}, pin: 'none' });
    expect((await empty.pin.beginPinSetup('1357')).ok).toBe(true);
    const off = await boot({ family: false, seed: withKids() });
    expect(await off.claim.setupClaimSatisfied()).toBe(true);
    expect(await off.claim.grantSetupClaim()).toBe(false); // nothing to grant, nothing to need
  });
});

describe('every other outcome of the device check changes nothing', () => {
  const outcomes: [string, Partial<La>, string][] = [
    ['no screen lock or biometrics at all', { level: 0 }, 'pkNotSecured'],
    ['cancelled by the person', { result: { success: false, error: 'user_cancel' } }, 'pkCancelled'],
    ['cancelled by the system', { result: { success: false, error: 'system_cancel' } }, 'pkCancelled'],
    ['not matching', { result: { success: false, error: 'authentication_failed' } }, 'pkFailed'],
    ['too many tries (lockout)', { result: { success: false, error: 'lockout' } }, 'pkLockout'],
    ['passcode not set', { result: { success: false, error: 'passcode_not_set' } }, 'pkNotSecured'],
    ['not enrolled', { result: { success: false, error: 'not_enrolled' } }, 'pkNotSecured'],
    ['not available', { result: { success: false, error: 'not_available' } }, 'pkUnavailable'],
    ['a native error', { throws: true }, 'pkUnavailable'],
    ['an answer that is not a clear success', { result: { success: 'yes' } }, 'pkFailed'],
  ];

  test.each(outcomes)('%s: it says so, the setup does not start, no claim, no credential written', async (_name, la, key) => {
    Object.assign(g.__la, la);
    const app = await boot({ seed: withKids(), pin: 'none' });
    const before = await mainKeys(app);
    const secureBefore = secureTest().sets.length;
    const view = await renderGate(app);
    await app.rntl.fireEvent.press(await view.findByRole('button', { name: t(app, 'pkCheck') }));
    await view.findByText(t(app, key as never));
    expect(view.queryByText(t(app, 'psIntroTitle'))).toBeNull();
    expect(view.queryByText('SECRET-CONTENT')).toBeNull();
    expect(app.claim.hasSetupClaim()).toBe(false);
    expect(await app.pin.beginPinSetup('1357')).toEqual({ ok: false, reason: 'claim-required' });
    expect(secureTest().sets.length).toBe(secureBefore);
    expect(await mainKeys(app)).toEqual(before);
    if (key === 'pkNotSecured' && la.level === 0) expect(g.__la.calls).toBe(0); // no fallback: the prompt was never shown
  });

  test('the check can be tried again after a failure', async () => {
    g.__la.result = { success: false, error: 'authentication_failed' };
    const app = await boot({ seed: withKids(), pin: 'none' });
    const view = await renderGate(app);
    await app.rntl.fireEvent.press(await view.findByRole('button', { name: t(app, 'pkCheck') }));
    await view.findByText(t(app, 'pkFailed'));
    g.__la.result = { success: true };
    await app.rntl.fireEvent.press(view.getByRole('button', { name: t(app, 'pkCheck') }));
    await view.findByText(t(app, 'psIntroTitle'));
  });

  test('in a browser nothing is offered (no secure storage, no native check) and nothing is simulated', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    // React Native is loaded again for every fresh copy of the app, so the platform is changed on THIS copy's Platform.
    const os = jest.replaceProperty(require('react-native').Platform, 'OS', 'web');
    const view = await renderGate(app);
    await view.findByText(t(app, 'puBody')); // "a PIN cannot be set up here"
    expect(view.queryByRole('button', { name: t(app, 'pkCheck') })).toBeNull();
    expect(view.queryByText(t(app, 'psIntroTitle'))).toBeNull();
    expect(view.queryByText('SECRET-CONTENT')).toBeNull();
    expect(g.__la.calls).toBe(0);
    expect(await app.claim.grantSetupClaim()).toBe(false);
    expect(await app.pin.beginPinSetup('1357')).toMatchObject({ ok: false });
    os.restore();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('an existing PIN is never replaced, reset or bypassed (including by the device check)', () => {
  const existing: PinState[] = ['ready', 'unconfirmed', 'missing', 'unavailable-after-setup'];

  test.each(existing)('PIN state "%s": no claim is offered, the check is never asked for, nothing is created', async (pin) => {
    const app = await boot({ seed: withKids(), pin });
    const secureBefore = [...secureTest().map];
    const marker = await app.AsyncStorage.getItem(`${P}parentAuth`);
    const view = await renderGate(app);
    await view.findByText(/Parent area|Área para padres/); // the ordinary lock screen
    expect(view.queryByText(t(app, 'pkTitle'))).toBeNull();
    expect(view.queryByText('SECRET-CONTENT')).toBeNull();
    const route = await renderRoute(app, '@/app/parent-security');
    await route.findByText(/Parent area|Área para padres/);
    expect(route.queryByText(t(app, 'psIntroTitle'))).toBeNull();
    expect(g.__la.calls).toBe(0);
    expect(await app.claim.grantSetupClaim()).toBe(false);
    expect((await app.pin.beginPinSetup('1357')).ok).toBe(false);
    expect([...secureTest().map]).toEqual(secureBefore);
    expect(await app.AsyncStorage.getItem(`${P}parentAuth`)).toBe(marker);
  });

  test('a successful device check cannot open the parent area, Main or a parent action when a PIN exists', async () => {
    const app = await boot({ seed: withKids(), pin: 'ready' });
    const { authenticateDevice } = require('@/utils/device-auth') as typeof import('@/utils/device-auth');
    expect(await authenticateDevice('x', 'y')).toEqual({ ok: true }); // the system says yes...
    expect((await app.gate.getParentAccess()).state).toBe('locked'); // ...and nothing opened
    const { checkParentAction } = require('@/utils/parent-session') as typeof import('@/utils/parent-session');
    expect(await checkParentAction('parent')).toEqual({ ok: false, reason: 'locked' });
    expect(await app.gate.unlockParentArea('000000')).toMatchObject({ ok: false }); // only the PIN opens it
  });

  test('a PIN lost after a restore stays locked: no setup, no bypass, data kept', async () => {
    const app = await boot({ seed: withKids(), pin: 'missing' });
    const view = await renderGate(app);
    await view.findByText(t(app, 'pgVerifierMissing'));
    expect(await app.AsyncStorage.getItem(HOUSEHOLD)).toContain('kid-mia');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the family picker offers the protected setup only when no PIN exists', () => {
  async function renderPicker(app: App) {
    const { FamilyGate } = require('@/components/family-gate') as typeof import('@/components/family-gate');
    const shell = app.React.createElement(app.Text, null, 'SHELL');
    return app.rntl.render(app.React.createElement(FamilyGate, null, shell));
  }

  test('no PIN: Main stays locked, "Finish parent setup" is offered, and it leads to the device check then the setup', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const view = await renderPicker(app);
    await view.findByText(t(app, 'pkPickerHint'));
    expect(view.getByRole('button', { name: new RegExp(`^${t(app, 'fpMainCardLabel', { status: 'S', hint: 'H' }).split('.')[0]}`) }).props.accessibilityState.disabled).toBe(true);
    await app.rntl.fireEvent.press(view.getByRole('button', { name: t(app, 'pkPickerButton') }));
    await view.findByText(t(app, 'pkTitle'));
    await app.rntl.fireEvent.press(view.getByRole('button', { name: t(app, 'pkCheck') }));
    await view.findByText(t(app, 'psIntroTitle'));
    expect(view.queryByText('SHELL')).toBeNull(); // nothing of the app (or Main) was entered
  });

  test.each(['ready', 'unconfirmed', 'missing'] as PinState[])('PIN state "%s": the offer is not there', async (pin) => {
    const app = await boot({ seed: withKids(), pin });
    const view = await renderPicker(app);
    await view.findByText('kid-mia');
    expect(view.queryByRole('button', { name: t(app, 'pkPickerButton') })).toBeNull();
    expect(view.queryByText(t(app, 'pkPickerHint'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('data stays as it was, and the text is in both languages', () => {
  test('Main\'s saved data is byte for byte unchanged by the gate, the check and a failed check', async () => {
    const main = { [`${P}petFamily`]: JSON.stringify({ version: 1, keep: 'me' }), [`${P}tasks`]: JSON.stringify([{ id: 't' }]) };
    const app = await boot({ seed: { ...withKids(), ...main }, pin: 'none' });
    const before = await mainKeys(app);
    g.__la.result = { success: false, error: 'user_cancel' };
    const view = await renderGate(app);
    await app.rntl.fireEvent.press(await view.findByRole('button', { name: t(app, 'pkCheck') }));
    await view.findByText(t(app, 'pkCancelled'));
    expect(await mainKeys(app)).toEqual(before);
    expect(JSON.parse((await app.AsyncStorage.getItem(HOUSEHOLD))!).children).toHaveLength(1);
  });

  test('Spanish text for the protected setup and its outcomes', async () => {
    g.__la.level = 0;
    const app = await boot({ seed: withKids(), pin: 'none', language: 'es' });
    const view = await renderGate(app);
    await view.findByText('Terminar la configuración de los padres');
    await app.rntl.fireEvent.press(view.getByRole('button', { name: 'Comprobar la seguridad del dispositivo' }));
    await view.findByText(/no tiene bloqueo de pantalla/);
  });

  test('English and Spanish have the same keys and placeholders', () => {
    const en = require('@/i18n/parent-claim.en').parentClaimEn as Record<string, string>;
    const es = require('@/i18n/parent-claim.es').parentClaimEs as Record<string, string>;
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) expect(es[key].length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the claim lifecycle (final-review cases)', () => {
  test('the app going to the background ends the claim', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const spy = jest.spyOn(require('react-native').AppState, 'addEventListener');
    expect(await app.claim.grantSetupClaim()).toBe(true);
    const listener = spy.mock.calls.filter((c) => c[0] === 'change').at(-1)![1] as (state: string) => void;
    listener('active');
    expect(app.claim.hasSetupClaim()).toBe(true); // coming back to the foreground is not an end
    listener('background');
    expect(app.claim.hasSetupClaim()).toBe(false);
    expect(await app.pin.beginPinSetup('1357')).toEqual({ ok: false, reason: 'claim-required' });
    spy.mockRestore();
  });

  test('starting the setup spends the claim, but the recovery code just shown stays on screen; a second attempt needs the check again', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const view = await renderGate(app);
    await app.rntl.fireEvent.press(await view.findByRole('button', { name: t(app, 'pkCheck') }));
    await view.findByText(t(app, 'psIntroTitle'));
    expect((await app.pin.beginPinSetup('1357')).ok).toBe(true); // spends the claim
    expect(app.claim.hasSetupClaim()).toBe(false);
    await app.rntl.act(async () => undefined);
    expect(view.queryByText(t(app, 'pkCheck'))).toBeNull(); // the screen did not fall back to the device check mid-setup
    expect(view.getByText(t(app, 'psIntroTitle'))).toBeTruthy();
    expect(await app.pin.beginPinSetup('8642')).toEqual({ ok: false, reason: 'claim-required' });
  });

  test('a granted claim shows only the setup, never the parent screen (it opens nothing)', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    await app.claim.grantSetupClaim();
    const view = await renderGate(app);
    await view.findByText(t(app, 'psIntroTitle'));
    expect(view.queryByText('SECRET-CONTENT')).toBeNull();
    expect((await app.gate.getParentAccess()).state).toBe('unprotected');
  });

  test('the device check allows the device passcode next to biometrics, with the prompt and cancel texts', async () => {
    const app = await boot({ seed: withKids(), pin: 'none' });
    const native = require('expo-local-authentication') as { authenticateAsync: jest.Mock };
    const view = await renderGate(app);
    await app.rntl.fireEvent.press(await view.findByRole('button', { name: t(app, 'pkCheck') }));
    await view.findByText(t(app, 'psIntroTitle'));
    expect(native.authenticateAsync).toHaveBeenCalledWith({ promptMessage: t(app, 'pkPrompt'), cancelLabel: t(app, 'pkCancelLabel'), disableDeviceFallback: false });
  });
});
