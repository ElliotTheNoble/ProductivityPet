import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { HOUR, T0, freezeClock, iso, pet, resetSecure, secureTest, unfreezeClock } from './helpers';

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));

// The visible family picker ("Who's playing today?", Stage 2). Each test starts from a fresh copy of every module over an
// in-memory storage, renders the real FamilyGate with a small stand-in for the app shell, and checks what is on screen and what was
// (not) loaded. The Parent PIN is the REAL one (parent gate + PIN module over an in-memory secure store), set up, left unfinished or
// broken exactly the way the app can leave it.

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
// The two big screens behind /parent and /welcome are replaced by a marker; the Parent Gate around them is the real one.
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

const P = '@ProductivityPet:';
const REGISTRY = `${P}profiles`;
const HOUSEHOLD = `${P}household`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const PIN = '246813';

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => {
  freezeClock(T0);
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
});
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const child = (id: string, nickname: string, extra: object = {}) => ({
  id,
  nickname,
  createdAt: iso(T0),
  settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' },
  tasks: [],
  ...extra,
});
const household = (children: object[]) => JSON.stringify({ version: 1, parent: null, children, selectedChildId: null });
const family = (pets: object[]) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens: 0 } });
const sick = (id: string, hoursAgo: number) =>
  pet({
    id,
    p: { hunger: 0, lastUpdatedAt: iso(T0 - HOUR) },
    lifecycle: { state: 'sick', sickSince: iso(T0 - hoursAgo * HOUR), exhausted: false, lastEvaluatedAt: iso(T0 - HOUR) },
  });

// ready = a PIN set up and confirmed; unconfirmed = its recovery code was never confirmed; pending = an unfinished setup; none = never
// set up; missing = it was set up but its secret cannot be found; unavailable = secure storage cannot be used on this device.
type Pin = 'ready' | 'unconfirmed' | 'pending' | 'none' | 'missing' | 'unavailable';
type Options = { seed?: Record<string, string>; pin?: Pin; language?: 'en' | 'es'; failBackup?: boolean; autoLock?: boolean; keepSecure?: boolean; failHouseholdRead?: boolean };

// A fresh app: every module new, storage seeded, a PIN checker registered (or not), and the gate rendered around a stand-in shell
// that loads the active profile's pet family, like the real app shell does the moment it is mounted.
async function boot(options: Options = {}) {
  jest.resetModules();
  // Every app module is new, but React, React Native and the test renderer stay the one copy the renderer itself uses.
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  if (!options.keepSecure) resetSecure();
  const AsyncStorage = (require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage')) as typeof import('@react-native-async-storage/async-storage').default;
  await AsyncStorage.clear();
  for (const [key, value] of Object.entries(options.seed ?? {})) await AsyncStorage.setItem(key, value);
  if (options.failHouseholdRead) {
    const original = AsyncStorage.getItem;
    AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === HOUSEHOLD) throw new Error('read failed');
      return original(key);
    });
  }
  if (options.failBackup) {
    // storage that cannot hold the one-time backup copy: the profile layer then stays in safe mode (Main only, as before)
    const original = AsyncStorage.setItem;
    (AsyncStorage as unknown as { __failBackup: boolean }).__failBackup = true;
    AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key.startsWith(`${P}backup`) && (AsyncStorage as unknown as { __failBackup: boolean }).__failBackup) throw new Error('disk full');
      return original(key, value);
    });
  }
  const React = ReactTop;
  const rntl = RNTL;
  const { Text } = ReactNative;
  const i18n = require('@/i18n') as typeof import('@/i18n');
  i18n.setCurrentLanguage(options.language ?? 'en');
  const profiles = require('@/utils/profiles') as typeof import('@/utils/profiles');
  const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
  const session = require('@/utils/family-session') as typeof import('@/utils/family-session');
  const familyStore = require('@/utils/pet-family') as typeof import('@/utils/pet-family');
  const { FamilyGate } = require('@/components/family-gate') as typeof import('@/components/family-gate');
  const pinModule = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
  if (options.pin === 'unavailable') secureTest().available = false;
  // The app shell starts the PIN system at launch (family mode only), before anything is asked of it.
  pinModule.startParentAuth({ enabled: true, platformOS: 'ios' });
  if (options.pin === 'ready' || options.pin === 'unconfirmed' || options.pin === 'missing' || options.pin === 'pending') {
    // The household already has children, so the first PIN needs the setup claim (a successful device security check).
    const claim = require('@/utils/family-claim') as typeof import('@/utils/family-claim');
    await claim.grantSetupClaim();
    const begun = await pinModule.beginPinSetup(PIN);
    claim.clearSetupClaim();
    if (!begun.ok) throw new Error(`PIN setup failed: ${begun.reason}`);
    if (options.pin !== 'pending') {
      const done = await pinModule.confirmPinSetup(PIN, begun.recoveryCode);
      if (!done.ok) throw new Error(`PIN confirmation failed: ${done.reason}`);
    }
    if (options.pin === 'unconfirmed') await pinModule.regenerateRecoveryCode(PIN); // a new code nobody has typed back yet
    if (options.pin === 'missing') secureTest().map.clear(); // the marker stays, the secret is gone (a restore, a new device)
  }
  gate.lockParentArea();
  const stop = options.autoLock === false ? () => undefined : gate.startParentGateAutoLock();
  const shellLoads: string[] = [];
  function Shell() {
    const [text, setText] = React.useState('loading shell');
    React.useEffect(() => {
      void familyStore.ensureFamilyLoaded().then((f) => {
        shellLoads.push(profiles.getActiveProfileId());
        setText(`SHELL ${profiles.getActiveProfileId()} wallet ${f.wallet.pawTokens}`);
      });
    }, []);
    return React.createElement(Text, null, text);
  }
  const view = await rntl.render(React.createElement(FamilyGate, null, React.createElement(Shell)));
  return { AsyncStorage, rntl, screen: rntl.screen, fireEvent: rntl.fireEvent, waitFor: rntl.waitFor, i18n, profiles, gate, session, familyStore, pinModule, shellLoads, view, stop, React, Text };
}
type App = Awaited<ReturnType<typeof boot>>;

const t = (app: App, key: Parameters<App['i18n']['translate']>[1], params?: Parameters<App['i18n']['translate']>[2]) =>
  app.i18n.translate(app.i18n.getCurrentLanguage(), key, params);
const card = (app: App, name: RegExp | string) => app.screen.getByRole('button', { name });
const prefix = (app: App, key: 'fpMainCardLabel' | 'fpAddChildLabel') => t(app, key, { status: 'S', hint: 'H' }).split('.')[0];
const mainCard = (app: App) => card(app, new RegExp(`^${prefix(app, 'fpMainCardLabel')}`));
const addCard = (app: App) => card(app, new RegExp(`^${prefix(app, 'fpAddChildLabel')}`));
const typePin = async (app: App, pin: string) => {
  for (const d of pin) await app.fireEvent.press(app.screen.getByRole('button', { name: d }));
};
const twoKids = () => ({
  [HOUSEHOLD]: household([child('kid-mia', 'Mia'), child('kid-leo', 'Leo')]),
});

// ---------------------------------------------------------------------------------------------------------
describe('cold start', () => {
  test('with no active child there is no picker: the app opens as it always has', async () => {
    const app = await boot({ seed: {} });
    await app.screen.findByText(/SHELL main/);
    expect(app.screen.queryByText(t(app, 'fpTitle'))).toBeNull();
  });

  test('with only archived children there is no picker either, and nothing of theirs is touched', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: household([child('kid-mia', 'Mia', { archivedAt: iso(T0) })]) } });
    await app.screen.findByText(/SHELL main/);
    expect(app.screen.queryByText('Mia')).toBeNull();
  });

  test('with one child the picker shows first, and the app shell is not even mounted', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: household([child('kid-mia', 'Mia')]) }, pin: 'ready' });
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(app.screen.getByText('Mia')).toBeTruthy();
    expect(app.screen.getByText(t(app, 'fpMain'))).toBeTruthy();
    expect(app.screen.queryByText(/SHELL|loading shell/)).toBeNull();
    expect(app.shellLoads).toEqual([]);
    expect(app.familyStore.peekFamily()).toBeNull(); // no game store has loaded anything
  });

  test('with several children every active one is offered, with Main and the parent-only "Add a child"; archived ones stay hidden', async () => {
    const app = await boot({
      seed: { [HOUSEHOLD]: household([child('kid-mia', 'Mia'), child('kid-leo', 'Leo'), child('kid-zoe', 'Zoe', { archivedAt: iso(T0) })]) },
      pin: 'ready',
    });
    await app.screen.findByText('Mia');
    expect(app.screen.getByText('Leo')).toBeTruthy();
    expect(app.screen.queryByText('Zoe')).toBeNull();
    expect(addCard(app)).toBeTruthy();
    expect(JSON.parse((await app.AsyncStorage.getItem(HOUSEHOLD))!).children).toHaveLength(3); // the archived child is still there
  });

  test('before a profile is chosen nothing of any profile is read except the care badges: no store loads, no alert is scheduled', async () => {
    const app = await boot({ seed: { ...twoKids(), [scoped('kid-mia', 'petFamily')]: family([pet({ id: 'a' })]) }, pin: 'ready' });
    await app.screen.findByText('Mia');
    expect(app.familyStore.peekFamily()).toBeNull();
    expect(require('expo-notifications').scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(require('expo-notifications').cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(app.profiles.isProfileReleased()).toBe(false); // nothing was switched or released just by showing it
  });

  test('the last-used profile is not opened by itself: the picker shows even when the saved pointer names a child', async () => {
    const app1 = await boot({ seed: twoKids(), pin: 'ready' });
    await app1.screen.findByText('Mia');
    await app1.fireEvent.press(card(app1, /Mia/));
    await app1.screen.findByText(/SHELL kid-mia/);
    const disk: Record<string, string> = {};
    for (const key of await app1.AsyncStorage.getAllKeys()) disk[key] = (await app1.AsyncStorage.getItem(key)) as string;
    expect(JSON.parse(disk[REGISTRY]).activeProfileId).toBe('kid-mia');
    app1.stop();
    const app2 = await boot({ seed: disk, keepSecure: true });
    await app2.screen.findByText(t(app2, 'fpTitle'));
    expect(app2.screen.queryByText(/SHELL/)).toBeNull();
    expect(app2.shellLoads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('children choose their own profile without a PIN', () => {
  test('tapping a card shows that the pets are being got ready, then opens only that child\'s profile', async () => {
    const app = await boot({ seed: { ...twoKids(), [scoped('kid-leo', 'petFamily')]: family([pet({ id: 'l' })]) }, pin: 'ready' });
    await app.screen.findByText('Leo');
    await app.fireEvent.press(card(app, /Leo/));
    await app.screen.findByText(/SHELL kid-leo/);
    expect(app.profiles.getActiveProfileId()).toBe('kid-leo');
    expect(app.screen.queryByText('Mia')).toBeNull();
    expect((await app.gate.getParentAccess()).state).toBe('locked'); // choosing a child opened nothing parental
    expect(app.shellLoads).toEqual(['kid-leo']);
  });

  test('while the switch is running a friendly loading screen with the child\'s name is shown, and it never claims success early', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready' });
    await app.screen.findByText('Mia');
    let finish: (v: { ok: true; changed: boolean }) => void = () => {};
    jest.spyOn(app.profiles, 'switchProfile').mockImplementationOnce(() => new Promise((r) => (finish = r)));
    await app.fireEvent.press(card(app, /Mia/));
    expect(await app.screen.findByText(t(app, 'fpSwitching', { name: 'Mia' }))).toBeTruthy();
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
    await app.rntl.act(async () => finish({ ok: true, changed: true }));
    await app.screen.findByText(/SHELL/);
  });

  test('a second tap while a switch is running does nothing', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready' });
    await app.screen.findByText('Mia');
    const spy = jest.spyOn(app.profiles, 'switchProfile');
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('Child A, then back to the picker, then Child B, then back to Main: data stays separate and notifications are cleared each time', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready' });
    const cancelAll = require('expo-notifications').cancelAllScheduledNotificationsAsync as jest.Mock;
    await app.screen.findByText('Mia');
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia wallet 0/);
    app.familyStore.addToWallet(25);
    expect(await app.session.returnToPicker()).toEqual({ ok: true, changed: true });
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
    expect(app.familyStore.peekFamily()).toBeNull();
    expect(cancelAll).toHaveBeenCalled();

    await app.fireEvent.press(card(app, /Leo/));
    await app.screen.findByText(/SHELL kid-leo wallet 0/); // Leo does not see Mia's 25
    expect(await app.session.returnToPicker()).toMatchObject({ ok: true });
    await app.screen.findByText(t(app, 'fpTitle'));

    await app.fireEvent.press(mainCard(app));
    await typePin(app, PIN);
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'pgUnlock') }));
    await app.screen.findByText(/SHELL main wallet/);
    expect(JSON.parse((await app.AsyncStorage.getItem(scoped('kid-mia', 'petFamily')))!).wallet.pawTokens).toBe(25);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('Main needs the Parent PIN', () => {
  async function pinPrompt(options: Options = {}) {
    const app = await boot({ seed: twoKids(), pin: 'ready', ...options });
    await app.screen.findByText('Mia');
    await app.fireEvent.press(mainCard(app));
    await app.screen.findByText(t(app, 'fpPinBodyMain'));
    return app;
  }
  const unlock = async (app: App, pin: string) => {
    await typePin(app, pin);
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'pgUnlock') }));
  };

  test('the correct PIN opens Main, and only Main', async () => {
    const app = await pinPrompt();
    await unlock(app, PIN);
    await app.screen.findByText(/SHELL main/);
    expect(app.profiles.getActiveProfileId()).toBe('main');
    expect(app.shellLoads).toEqual(['main']);
    expect(app.screen.queryByText(/kid-/)).toBeNull();
  });

  test('a wrong PIN says so with the tries left, opens nothing and loads nothing', async () => {
    const app = await pinPrompt();
    await unlock(app, '111111');
    expect(await app.screen.findByText(new RegExp(t(app, 'pgWrong')))).toBeTruthy();
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
    expect(app.shellLoads).toEqual([]);
    expect(app.familyStore.peekFamily()).toBeNull();
  });

  test('too many wrong PINs pause it (also for the correct PIN), and the Main card says it is locked; children still play', async () => {
    const app = await pinPrompt();
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'pinKeyClear') }));
      await unlock(app, '111111');
      if (i < 2) await app.screen.findByText(new RegExp(t(app, 'pgWrong')));
    }
    const pausedText = t(app, 'pgCooldown', { time: '@@' }).split('@@')[0];
    expect(await app.screen.findByText(new RegExp(pausedText))).toBeTruthy();
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'pinKeyClear') }));
    await typePin(app, PIN);
    expect(app.screen.getByRole('button', { name: t(app, 'pgUnlock') }).props.accessibilityState.disabled).toBe(true);
    expect(app.screen.queryByText(/SHELL/)).toBeNull(); // the correct PIN opens nothing while it is paused
    expect(app.shellLoads).toEqual([]);
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'fpCancel') }));
    expect(app.screen.getByText(new RegExp(t(app, 'fpMainLocked', { time: '@@' }).split('@@')[0]))).toBeTruthy();
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia/);
  });

  test('Back leaves the prompt without opening anything', async () => {
    const app = await pinPrompt();
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'fpCancel') }));
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
  });

  test('a PIN that cannot be found: Main cannot be opened, the card says why, and children still play', async () => {
    const app = await boot({ seed: twoKids(), pin: 'missing' });
    await app.screen.findByText('Mia');
    const main = mainCard(app);
    expect(main.props.accessibilityState.disabled).toBe(true);
    expect(app.screen.getAllByText(t(app, 'fpMainMissingShort')).length).toBeGreaterThan(0);
    await app.fireEvent.press(main);
    expect(app.screen.queryByText(t(app, 'fpPinBodyMain'))).toBeNull();
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia/);
  });

  test('"Add a child" is disabled with an explanation until a PIN exists, and needs the PIN once it does', async () => {
    const noPin = await boot({ seed: twoKids(), pin: 'none' });
    await noPin.screen.findByText('Mia');
    const add = addCard(noPin);
    expect(add.props.accessibilityState.disabled).toBe(true);
    expect(noPin.screen.getByText(t(noPin, 'fpAddChildNeedsPin'))).toBeTruthy();
    noPin.stop();

    const app = await boot({ seed: twoKids(), pin: 'ready' });
    await app.screen.findByText('Mia');
    await app.fireEvent.press(addCard(app));
    await app.screen.findByText(t(app, 'fpPinBodyAdd'));
    await unlock(app, PIN);
    await app.screen.findByText(/SHELL main/);
    expect(app.session.consumePendingRoute()).toBe('/parent'); // the existing protected dashboard, nothing new
    expect((await app.gate.getParentAccess()).state).toBe('unlocked'); // the PIN that was just entered
  });

  test('entering Main with the PIN leaves the parent area open for that PIN session, and entering a child locks it again', async () => {
    const app = await pinPrompt();
    await unlock(app, PIN);
    await app.screen.findByText(/SHELL main/);
    expect((await app.gate.getParentAccess()).state).toBe('unlocked');
    expect(app.session.consumePendingRoute()).toBeNull();
    expect(await app.session.returnToPicker()).toMatchObject({ ok: true });
    expect((await app.gate.getParentAccess()).state).toBe('locked'); // leaving locks it
    await app.screen.findByText('Mia');
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia/);
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('a switch that fails', () => {
  async function ready() {
    const app = await boot({ seed: { ...twoKids(), [scoped('kid-mia', 'petFamily')]: family([pet({ id: 'a' })]) }, pin: 'ready' });
    await app.screen.findByText('Mia');
    return app;
  }

  test('storage failure: a clear message with Try again, the picker stays, nothing opened; Try again then works', async () => {
    const app = await ready();
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === REGISTRY) throw new Error('disk full');
      return original(key, value);
    });
    await app.fireEvent.press(card(app, /Mia/));
    expect(await app.screen.findByText(t(app, 'fpErrStorage'))).toBeTruthy();
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
    expect(app.profiles.getActiveProfileId()).toBe('main');
    expect(app.shellLoads).toEqual([]);
    app.AsyncStorage.setItem = original;
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'fpRetry') }));
    await app.screen.findByText(/SHELL kid-mia/);
  });

  test.each([
    ['timeout', 'fpErrTimeout'],
    ['unsaved-changes', 'fpErrUnsaved'],
    ['busy', 'fpErrBusy'],
    ['conflict', 'fpErrConflict'],
    ['unknown-profile', 'fpErrUnknown'],
    ['unavailable', 'fpErrUnavailable'],
  ] as const)('%s is explained in plain words and nothing is opened', async (reason, key) => {
    const app = await ready();
    jest.spyOn(app.profiles, 'switchProfile').mockResolvedValueOnce({ ok: false, reason });
    await app.fireEvent.press(card(app, /Mia/));
    expect(await app.screen.findByText(t(app, key))).toBeTruthy();
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
    expect(app.screen.getByRole('button', { name: t(app, 'fpRetry') })).toBeTruthy();
  });

  test('a failed switch refreshes the list and the care badges, so nothing stale is left on screen', async () => {
    const app = await ready();
    expect(app.screen.getAllByText(t(app, 'fpBadgeHealthy')).length).toBeGreaterThan(0);
    await app.AsyncStorage.setItem(scoped('kid-mia', 'petFamily'), family([sick('a', 2)])); // she got sick while the picker was open
    jest.spyOn(app.profiles, 'switchProfile').mockResolvedValueOnce({ ok: false, reason: 'timeout' });
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(t(app, 'fpErrTimeout'));
    await app.waitFor(() => expect(app.screen.getByText(t(app, 'fpBadgeSick'))).toBeTruthy());
  });

  test('storage in safe mode: the players are not offered, the problem is explained with Try again, and Main still needs the PIN', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready', failBackup: true });
    expect(await app.screen.findByText(t(app, 'fpSafeModeTitle'))).toBeTruthy();
    expect(app.screen.queryByText('Mia')).toBeNull();
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
    expect(app.profiles.getProfilesStatus().state).toBe('safe-mode');
    expect(app.screen.getByRole('button', { name: t(app, 'fpRetry') })).toBeTruthy();
    expect(app.screen.getByText(t(app, 'fpMainSubProtected'))).toBeTruthy();
    // Main is still behind the PIN
    await app.fireEvent.press(mainCard(app));
    await app.screen.findByText(t(app, 'fpPinBodyMain'));
    await typePin(app, PIN);
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'pgUnlock') }));
    await app.screen.findByText(/SHELL main/);
    expect(await app.AsyncStorage.getItem(HOUSEHOLD)).toContain('Mia'); // nothing was lost
  });

  test('Try again after the storage problem is fixed offers the players', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready', failBackup: true });
    await app.screen.findByText(t(app, 'fpSafeModeTitle'));
    (app.AsyncStorage as unknown as { __failBackup: boolean }).__failBackup = false; // the space was freed
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'fpRetry') }));
    await app.screen.findByText('Mia');
    expect(app.screen.queryByText(t(app, 'fpSafeModeTitle'))).toBeNull();
    expect(app.profiles.getProfilesStatus().state).toBe('ready');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('read-only care badges', () => {
  const sevenKids = () => ({
    [HOUSEHOLD]: household([
      child('kid-ok', 'Okay'),
      child('kid-low', 'Lowneeds'),
      child('kid-sick', 'Sicky'),
      child('kid-crit', 'Critty'),
      child('kid-dead', 'Deady'),
      child('kid-new', 'Newbie'),
      child('kid-bad', 'Broken'),
    ]),
    [scoped('kid-ok', 'petFamily')]: family([pet({ id: 'a' })]),
    [scoped('kid-low', 'petFamily')]: family([pet({ id: 'b', p: { hunger: 20 } })]),
    [scoped('kid-sick', 'petFamily')]: family([sick('c', 2)]),
    [scoped('kid-crit', 'petFamily')]: family([sick('d', 30)]),
    [scoped('kid-dead', 'petFamily')]: family([sick('e', 100)]),
    [scoped('kid-bad', 'petFamily')]: '{not json',
  });
  const badgeOf = (app: App, name: string, label: string) => {
    const button = card(app, new RegExp(`^${name}\\.`));
    return button.props.accessibilityLabel.includes(label);
  };

  test('healthy, needs care, sick, critical, passed away, not started and unreadable are all told apart, in the cards\' spoken labels too', async () => {
    const app = await boot({ seed: sevenKids(), pin: 'ready' });
    await app.screen.findByText('Okay');
    await app.waitFor(() => expect(app.screen.queryByText(t(app, 'fpBadgeChecking'))).toBeNull());
    expect(badgeOf(app, 'Okay', t(app, 'fpBadgeHealthy'))).toBe(true);
    expect(badgeOf(app, 'Lowneeds', t(app, 'fpBadgeNeedsCare'))).toBe(true);
    expect(badgeOf(app, 'Sicky', t(app, 'fpBadgeSick'))).toBe(true);
    expect(badgeOf(app, 'Critty', t(app, 'fpBadgeCritical'))).toBe(true);
    expect(badgeOf(app, 'Deady', t(app, 'fpBadgeDeceased'))).toBe(true);
    expect(badgeOf(app, 'Newbie', t(app, 'fpBadgeNew'))).toBe(true);
    expect(badgeOf(app, 'Broken', t(app, 'fpBadgeUnreadable'))).toBe(true);
  });

  test('an unreadable record is never shown as healthy, and the badge is read from the saved record without loading it', async () => {
    const app = await boot({ seed: sevenKids(), pin: 'ready' });
    await app.screen.findByText('Broken');
    await app.waitFor(() => expect(badgeOf(app, 'Broken', t(app, 'fpBadgeUnreadable'))).toBe(true));
    expect(badgeOf(app, 'Broken', t(app, 'fpBadgeHealthy'))).toBe(false);
    expect(app.familyStore.peekFamily()).toBeNull();
    expect(await app.AsyncStorage.getItem(scoped('kid-bad', 'petFamily'))).toBe('{not json'); // untouched
  });

  test('the badges are advanced to now: a pet saved as healthy that has been neglected shows a warning', async () => {
    const old = pet({
      id: 'z',
      p: { hunger: 0, lastUpdatedAt: iso(T0 - 40 * HOUR) },
      lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: iso(T0 - 40 * HOUR) },
    });
    const app = await boot({ seed: { [HOUSEHOLD]: household([child('kid-old', 'Oldie')]), [scoped('kid-old', 'petFamily')]: family([old]) }, pin: 'ready' });
    await app.screen.findByText('Oldie');
    await app.waitFor(() => expect(badgeOf(app, 'Oldie', t(app, 'fpBadgeHealthy'))).toBe(false));
    expect(badgeOf(app, 'Oldie', t(app, 'fpBadgeChecking'))).toBe(false);
  });

  test('Main\'s own badge is shown too (read from the original record)', async () => {
    const app = await boot({
      seed: { ...twoKids(), [`${P}petFamily`]: family([sick('m', 2)]) },
      pin: 'ready',
    });
    await app.screen.findByText('Mia');
    await app.waitFor(() => expect(app.screen.getByRole('button', { name: new RegExp(`^${t(app, 'fpMain')}|${t(app, 'fpMainCardLabel', { status: t(app, 'fpBadgeSick'), hint: '' }).slice(0, 12)}`) }).props.accessibilityLabel).toContain(t(app, 'fpBadgeSick')));
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('English, Spanish, long names and accessibility', () => {
  const longName = 'Maximiliano Alejandro Fernández de la Ve'; // 40 characters: the longest a nickname can be

  test('Spanish text everywhere on the picker, including the badges and the PIN prompt', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: household([child('kid-mia', 'Mia')]) }, pin: 'ready', language: 'es' });
    await app.screen.findByText('¿Quién juega hoy?');
    expect(app.screen.getByText('Principal')).toBeTruthy();
    expect(app.screen.getByText('Añadir un niño')).toBeTruthy();
    await app.waitFor(() => expect(app.screen.getAllByText('Nuevo: hay un huevo esperando').length).toBeGreaterThan(0));
    await app.fireEvent.press(mainCard(app));
    expect(await app.screen.findByText('Escribe el PIN de los padres para abrir Principal.')).toBeTruthy();
    expect(app.screen.getByRole('button', { name: 'Atrás' })).toBeTruthy();
  });

  test('a very long nickname is shown whole to a screen reader and wraps onto more lines (never cut off with an ellipsis)', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: household([child('kid-long', longName)]) }, pin: 'ready' });
    await app.screen.findByText(longName);
    const button = card(app, new RegExp(longName));
    expect(button.props.accessibilityLabel.startsWith(`${longName}.`)).toBe(true);
    expect(app.screen.getByText(longName).props.numberOfLines).toBeUndefined(); // never cut off with an ellipsis
  });

  test('every card is a button with a spoken name, the title is a header, and the avatar picture is hidden from screen readers', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready' });
    await app.screen.findByText('Mia');
    expect(app.screen.getByRole('header', { name: t(app, 'fpTitle') })).toBeTruthy();
    for (const name of ['Mia', 'Leo']) expect(card(app, new RegExp(`^${name}\\.`)).props.accessibilityLabel).toContain(t(app, 'fpCardLabel', { name, status: '' }).split('.')[1].trim().slice(0, 4));
    expect(app.screen.getByRole('button', { name: new RegExp(t(app, 'fpMainCardLabel', { status: '', hint: '' }).slice(0, 10)) })).toBeTruthy();
  });

  test('the English and Spanish tables have exactly the same picker keys (nothing falls back to English by accident)', () => {
    const en = require('@/i18n/family-picker.en').familyPickerEn as Record<string, string>;
    const es = require('@/i18n/family-picker.es').familyPickerEs as Record<string, string>;
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(es[key].length).toBeGreaterThan(0);
      expect([...en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()).toEqual([...es[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('routes, the flag and the shell', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8');

  test('direct addresses cannot skip the picker or the PIN: the shell (and so every route) is not rendered until a profile is chosen, and /parent is still gated after', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready' });
    await app.screen.findByText('Mia');
    expect(app.screen.queryByText(/SHELL|loading shell/)).toBeNull(); // the Slot with any route is inside the shell
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia/);
    const { ParentGate } = require('@/components/parent-gate') as typeof import('@/components/parent-gate');
    const secret = app.React.createElement(app.Text, null, 'DASHBOARD-CONTENT');
    const view = await app.rntl.render(app.React.createElement(ParentGate, null, secret));
    await view.findByText(/Parent area|Área para padres/);
    expect(view.queryByText('DASHBOARD-CONTENT')).toBeNull();
  });

  test('family mode off: the layout never loads the gate, the picker or the session at all', () => {
    const layout = read('src/app/_layout.tsx');
    expect(layout).toMatch(/if \(!FAMILY_MODE_ENABLED\) return <AppShell key=\{profileId\} \/>;/);
    expect(layout).toMatch(/require\('@\/components\/family-gate'\)/);
    expect(layout).not.toMatch(/^import .*family-gate|^import .*family-picker/m);
    expect(read('src/utils/dev-flags.ts')).toMatch(/FAMILY_MODE_ENABLED: boolean = __DEV__ && process\.env\.EXPO_PUBLIC_FAMILY_MODE === '1'/);
  });

  test('with the flag off the committed default is off', () => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_FAMILY_MODE;
    expect((require('@/utils/dev-flags') as { FAMILY_MODE_ENABLED: boolean }).FAMILY_MODE_ENABLED).toBe(false);
  });

  test('the picker never logs, stores or puts a PIN in a route, and keeps no profile data of its own', () => {
    for (const file of ['src/components/family-picker.tsx', 'src/components/family-gate.tsx', 'src/utils/family-session.ts', 'src/utils/family-picker-model.ts']) {
      const code = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/console\.|AsyncStorage|SecureStore|localStorage|router\.(push|replace)|Linking|Clipboard/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('Main fails closed (security review)', () => {
  const blocked: [Pin, string][] = [
    ['none', 'fpMainNoPin'],
    ['pending', 'fpMainNoPin'],
    ['unconfirmed', 'fpMainUnconfirmed'],
    ['missing', 'fpMainMissingShort'],
    ['unavailable', 'fpMainUnavailable'],
  ];

  test.each(blocked)('PIN state "%s": Main and "Add a child" cannot be opened, the card says why, children still play, nothing is created or reset', async (pin, key) => {
    const mainBefore = { [`${P}petFamily`]: family([pet({ id: 'm' })]), [`${P}tasks`]: JSON.stringify([{ id: 't', text: 'x' }]) };
    const app = await boot({ seed: { ...twoKids(), ...mainBefore }, pin });
    await app.screen.findByText('Mia');
    const main = mainCard(app);
    expect(main.props.accessibilityState.disabled).toBe(true);
    expect(app.screen.getAllByText(t(app, key as never)).length).toBeGreaterThan(0);
    expect(addCard(app).props.accessibilityState.disabled).toBe(true);
    const secureWritesBefore = secureTest().sets.length;
    await app.fireEvent.press(main);
    await app.fireEvent.press(addCard(app));
    expect(app.screen.queryByText(t(app, 'fpPinBodyMain'))).toBeNull(); // no PIN prompt is ever offered
    expect(app.screen.queryByText(t(app, 'fpPinBodyAdd'))).toBeNull();
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
    expect(app.profiles.getActiveProfileId()).toBe('main'); // the saved pointer, nothing was switched
    expect(app.shellLoads).toEqual([]);
    expect(secureTest().sets.length).toBe(secureWritesBefore); // no PIN was created, changed or reset by looking at the picker
    for (const [k, v] of Object.entries(mainBefore)) expect(await app.AsyncStorage.getItem(k)).toBe(v); // Main's saved data is untouched
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia/); // children are never blocked by this
  });

  test('a PIN that works lets the picker ask for it, and only a verified session lets Main in (the last check)', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready' });
    await app.screen.findByText('Mia');
    expect(mainCard(app).props.accessibilityState.disabled).toBe(false);
    const model = require('@/utils/family-picker-model') as typeof import('@/utils/family-picker-model');
    expect(await model.parentSessionVerified()).toBe(false); // locked: no
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
    expect(await model.parentSessionVerified()).toBe(true);
    app.gate.lockParentArea();
    expect(await model.parentSessionVerified()).toBe(false);
  });

  test('an open parent session whose recovery code is not confirmed does not count as verified', async () => {
    const app = await boot({ seed: twoKids(), pin: 'unconfirmed' });
    const model = require('@/utils/family-picker-model') as typeof import('@/utils/family-picker-model');
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true }); // the PIN itself is right
    expect(await model.parentSessionVerified()).toBe(false);
  });

  test('the Main entry table: every state that is not a working, confirmed PIN is closed', () => {
    jest.resetModules();
    const { mainEntry } = require('@/utils/family-picker-model') as typeof import('@/utils/family-picker-model');
    const auth = (state: string, recovery = 'confirmed', loading = false) => ({ loading, state, recovery }) as never;
    expect(mainEntry({ state: 'locked' }, auth('ready'))).toBe('allowed');
    expect(mainEntry({ state: 'cooldown', remainingMs: 5 }, auth('ready'))).toBe('allowed');
    expect(mainEntry({ state: 'unlocked' }, auth('ready'))).toBe('allowed');
    expect(mainEntry({ state: 'checking' }, auth('ready'))).toBe('checking');
    expect(mainEntry({ state: 'locked' }, auth('ready', 'confirmed', true))).toBe('checking');
    expect(mainEntry({ state: 'unprotected' }, auth('none', 'none'))).toBe('no-pin');
    expect(mainEntry({ state: 'unprotected' }, auth('pending', 'pending-setup'))).toBe('no-pin');
    expect(mainEntry({ state: 'unprotected' }, auth('ready'))).toBe('no-pin'); // the gate says "no PIN": believe the stricter
    expect(mainEntry({ state: 'locked' }, auth('ready', 'unconfirmed'))).toBe('unconfirmed');
    expect(mainEntry({ state: 'locked' }, auth('ready', 'unavailable'))).toBe('unconfirmed');
    expect(mainEntry({ state: 'locked', reason: 'verifier-missing' }, auth('verifier-missing', 'unavailable'))).toBe('verifier-missing');
    expect(mainEntry({ state: 'locked' }, auth('verifier-missing', 'unavailable'))).toBe('verifier-missing');
    expect(mainEntry({ state: 'unprotected' }, auth('unsupported'))).toBe('unavailable');
    expect(mainEntry({ state: 'unprotected' }, auth('off'))).toBe('unavailable');
  });

  test('a household with active children that cannot be offered still shows the picker (never opens Main without the PIN)', async () => {
    // an active child whose id can never be a profile id: not selectable, but present
    const app = await boot({ seed: { [HOUSEHOLD]: household([child('bad id!', 'Ghost')]) }, pin: 'ready' });
    await app.screen.findByText(t(app, 'fpChildrenNotReadyTitle'));
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
    expect(app.shellLoads).toEqual([]);
    expect(mainCard(app).props.accessibilityState.disabled).toBe(false); // asks for the PIN
    await app.fireEvent.press(mainCard(app));
    await app.screen.findByText(t(app, 'fpPinBodyMain'));
  });

  test('a household that cannot be read still shows the picker, and Main still needs the PIN', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready', failHouseholdRead: true });
    await app.screen.findByText(t(app, 'fpHouseholdUnreadableTitle'));
    expect(app.screen.queryByText(/SHELL/)).toBeNull();
    expect(app.screen.queryByText('Mia')).toBeNull();
    await app.fireEvent.press(mainCard(app));
    await app.screen.findByText(t(app, 'fpPinBodyMain'));
  });

  test('the original single-user app: no household, or no active child, opens Main with no picker and no PIN prompt (also with a PIN set up)', async () => {
    for (const pin of ['none', 'ready'] as Pin[]) {
      const app = await boot({ seed: {}, pin });
      await app.screen.findByText(/SHELL main/);
      expect(app.screen.queryByText(t(app, 'fpTitle'))).toBeNull();
      app.stop();
    }
    const archived = await boot({ seed: { [HOUSEHOLD]: household([child('kid-mia', 'Mia', { archivedAt: iso(T0) })]) }, pin: 'none' });
    await archived.screen.findByText(/SHELL main/);
  });

  test('entering Main needs the PIN each time the app starts: a previous session never carries over', async () => {
    const first = await boot({ seed: twoKids(), pin: 'ready' });
    await first.screen.findByText('Mia');
    await first.fireEvent.press(mainCard(first));
    await typePin(first, PIN);
    await first.fireEvent.press(first.screen.getByRole('button', { name: t(first, 'pgUnlock') }));
    await first.screen.findByText(/SHELL main/);
    const disk: Record<string, string> = {};
    for (const key of await first.AsyncStorage.getAllKeys()) disk[key] = (await first.AsyncStorage.getItem(key)) as string;
    first.stop();
    const second = await boot({ seed: disk, pin: 'none', keepSecure: true }); // the secure store (and so the PIN) is kept
    await second.screen.findByText(t(second, 'fpTitle'));
    expect(second.screen.queryByText(/SHELL/)).toBeNull();
    expect((await second.gate.getParentAccess()).state).toBe('locked');
  });
});

describe('the parent session locks (security review)', () => {
  async function inMain(options: Options = {}) {
    const app = await boot({ seed: twoKids(), pin: 'ready', ...options });
    await app.screen.findByText('Mia');
    await app.fireEvent.press(mainCard(app));
    await typePin(app, PIN);
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'pgUnlock') }));
    await app.screen.findByText(/SHELL main/);
    expect((await app.gate.getParentAccess()).state).toBe('unlocked');
    return app;
  }

  test('going back to the picker locks it, even if the profile listeners were not running', async () => {
    const app = await inMain({ autoLock: false });
    expect(await app.session.returnToPicker()).toMatchObject({ ok: true });
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    await app.screen.findByText(t(app, 'fpTitle'));
  });

  test('switching to a child locks it', async () => {
    const app = await inMain();
    expect(await app.session.returnToPicker()).toMatchObject({ ok: true });
    await app.screen.findByText('Mia');
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia/);
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });

  // React Native is loaded again for every fresh copy of the app, so the listener is watched on THIS copy's AppState.
  function watchAppState() {
    const spy = jest.spyOn(require('react-native').AppState, 'addEventListener');
    return { spy, listeners: () => spy.mock.calls.filter((c) => c[0] === 'change').map((c) => c[1] as (state: string) => void) };
  }

  test('the app going to the background locks it (the PIN is asked again)', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready', autoLock: false });
    const watch = watchAppState();
    app.gate.startParentGateAutoLock(); // what the app shell does once at start
    await app.screen.findByText('Mia');
    await app.fireEvent.press(mainCard(app));
    await typePin(app, PIN);
    await app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'pgUnlock') }));
    await app.screen.findByText(/SHELL main/);
    expect((await app.gate.getParentAccess()).state).toBe('unlocked');
    await app.rntl.act(async () => watch.listeners().forEach((h) => h('background')));
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    watch.spy.mockRestore();
  });

  test('the typed PIN is wiped when the app goes to the background (nothing is kept on the prompt)', async () => {
    const app = await boot({ seed: twoKids(), pin: 'ready' });
    const watch = watchAppState();
    await app.screen.findByText('Mia');
    await app.fireEvent.press(mainCard(app));
    await app.screen.findByText(t(app, 'fpPinBodyMain'));
    await typePin(app, '1357');
    expect(app.screen.getAllByText(app.i18n.tn('pinDigitsEntered', 4)).length).toBeGreaterThan(0);
    await app.rntl.act(async () => watch.listeners().forEach((h) => h('background')));
    expect(app.screen.getAllByText(app.i18n.tn('pinDigitsEntered', 0)).length).toBeGreaterThan(0);
    watch.spy.mockRestore();
  });
});

describe('direct addresses cannot skip the Parent Gate (security review)', () => {
  const routes: [string, string][] = [
    ['/parent', '@/app/parent'],
    ['/welcome', '@/app/welcome'],
    ['/parent-security', '@/app/parent-security'],
  ];

  test.each(routes)('%s shows the Parent PIN screen, not its content, for a child profile and for Main', async (_route, module) => {
    const app = await boot({ seed: twoKids(), pin: 'ready' });
    await app.screen.findByText('Mia');
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia/);
    const Page = (require(module) as { default: () => React.ReactElement }).default;
    const view = await app.rntl.render(app.React.createElement(Page));
    await view.findByText(/Parent area|Área para padres/);
    expect(view.queryByText('DASHBOARD-CONTENT')).toBeNull();
    expect(view.queryByText('WELCOME-CONTENT')).toBeNull();
    expect(view.queryByText(t(app, 'psIntroTitle'))).toBeNull();
  });

  test('with the PIN missing the same pages explain it and show nothing, and create nothing', async () => {
    const app = await boot({ seed: twoKids(), pin: 'missing' });
    await app.screen.findByText('Mia');
    await app.fireEvent.press(card(app, /Mia/));
    await app.screen.findByText(/SHELL kid-mia/);
    const secureWrites = secureTest().sets.length;
    const Page = (require('@/app/parent') as { default: () => React.ReactElement }).default;
    const view = await app.rntl.render(app.React.createElement(Page));
    await view.findByText(t(app, 'pgVerifierMissing'));
    expect(view.queryByText('DASHBOARD-CONTENT')).toBeNull();
    expect(secureTest().sets.length).toBe(secureWrites);
  });
});
