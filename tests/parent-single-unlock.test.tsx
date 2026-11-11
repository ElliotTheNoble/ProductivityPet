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

// ONE Parent PIN unlock: the PIN typed on "Who's playing today?" to enter Main opens the parent area, and the Parent Dashboard and Family
// Settings (/parent) use that same open session: no second PIN screen, no second "Parent area" unlock. The session still ends on idle, on
// the app going to the background and on a profile change, and a locked or expired session always shows the PIN screen.
const mockRouter = {
  push: jest.fn((path: string) => {
    mockPath = path;
  }),
  replace: jest.fn((path: string) => {
    mockPath = path;
  }),
};
let mockPath = '/dashboard';
jest.mock('expo-router', () => {
  const R = require('react');
  const { Text: T } = require('react-native');
  return {
    useRouter: () => mockRouter,
    usePathname: () => mockPath,
    Redirect: () => null,
    Slot: () => {
      if (mockPath === '/dashboard') return R.createElement(require('@/app/dashboard').default);
      if (mockPath === '/parent') return R.createElement(require('@/app/parent').default);
      return R.createElement(T, null, `ROUTE:${mockPath}`);
    },
    ThemeProvider: ({ children }: { children: unknown }) => children,
    DarkTheme: {},
    DefaultTheme: {},
  };
});

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => {
  freezeClock(T0);
  mockPath = '/dashboard';
});
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const t = (key: string) => (require('@/i18n') as typeof import('@/i18n')).translate('en', key as never);
const pressButton = async (name: string | RegExp) => RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name }));

async function bootPicker() {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app: App = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const household = require('@/utils/household') as typeof import('@/utils/household');
  for (const name of ['Billy', 'Sarah']) await household.addChild(name);
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  app.gate.lockParentArea(); // a fresh start: the parent area is closed and the picker is showing
  const stopAutoLock = app.gate.startParentGateAutoLock();
  const { FamilyGate } = require('@/components/family-gate') as typeof import('@/components/family-gate');
  const { ShellChooser } = require('@/components/shell-chooser') as typeof import('@/components/shell-chooser');
  await RNTL.render(
    <FamilyGate>
      <ShellChooser renderGame={() => <ReactNative.Text>GAME-SHELL</ReactNative.Text>} />
    </FamilyGate>
  );
  await settle();
  return { app, stopAutoLock };
}

async function enterMainWithPin() {
  const main = RNTL.screen.getAllByRole('button').find((b) => /Main/.test(String(b.props.accessibilityLabel)));
  await RNTL.fireEvent.press(main!);
  await settle();
  for (const digit of TEST_PIN) await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: digit }));
  await pressButton(t('pgUnlock'));
  await RNTL.screen.findByText(t('phChildren'), {}, { timeout: 20000 }); // the PIN is checked, then Main opens on the dashboard
  await settle();
}

describe('one PIN, one unlock', () => {
  test('the PIN typed to enter Main opens the dashboard directly, and Family Settings opens with no second PIN screen', async () => {
    const { stopAutoLock } = await bootPicker();
    expect(RNTL.screen.getByText('Billy')).toBeTruthy(); // the picker
    await enterMainWithPin();
    // the dashboard: no PIN screen in between
    expect(RNTL.screen.queryByText(t('fpPinTitle'))).toBeNull();
    expect(RNTL.screen.queryByText(t('pgSubtitle'))).toBeNull();
    expect(await RNTL.screen.findByText(t('phChildren'))).toBeTruthy();
    // Family Settings uses the same open session
    await pressButton(t('phSettings'));
    await settle();
    expect(mockPath).toBe('/parent');
    expect(RNTL.screen.queryByText(t('pgSubtitle'))).toBeNull(); // not the PIN screen
    expect(RNTL.screen.queryByText(t('pgPinLabel'))).toBeNull();
    // Family Settings itself: its page title plus the header button of the same name
    expect((await RNTL.screen.findAllByText(t('dashboardTitle'))).length).toBe(2);
    // and back to the dashboard, still no PIN
    await pressButton(t('phNavDashboard'));
    await settle();
    expect(await RNTL.screen.findByText(t('phChildren'))).toBeTruthy();
    expect(RNTL.screen.queryByText(t('pgSubtitle'))).toBeNull();
    stopAutoLock();
  });

  test('the session still ends: once it is locked, the dashboard and Family Settings both show the PIN screen and nothing else', async () => {
    const { app, stopAutoLock } = await bootPicker();
    await enterMainWithPin();
    await RNTL.screen.findByText(t('phChildren'));
    await RNTL.act(async () => {
      app.gate.lockParentArea();
    });
    await settle();
    expect(RNTL.screen.queryByText('Billy')).toBeNull();
    expect(await RNTL.screen.findByText(t('pgSubtitle'))).toBeTruthy();
    mockPath = '/parent';
    await pressButton(t('phSettings'));
    await settle();
    expect(RNTL.screen.queryAllByText(t('dashboardTitle'))).toHaveLength(1); // only the header button: the page itself is not shown
    expect(await RNTL.screen.findByText(t('pgSubtitle'))).toBeTruthy();
    stopAutoLock();
  });

  test('going to the background closes the session', async () => {
    const { stopAutoLock } = await bootPicker();
    await enterMainWithPin();
    await RNTL.screen.findByText(t('phChildren'));
    const { AppState } = ReactNative;
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (state: string) => void) => {
      listeners.push(fn);
      return { remove: () => undefined };
    }) as never);
    const { startParentGateAutoLock } = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
    const stop = startParentGateAutoLock();
    await RNTL.act(async () => {
      listeners.forEach((fn) => fn('background'));
    });
    await settle();
    expect(RNTL.screen.queryByText('Billy')).toBeNull();
    expect(await RNTL.screen.findByText(t('pgSubtitle'))).toBeTruthy();
    stop();
    stopAutoLock();
  });
});

describe('the Parent PIN screens use a simple outline lock, not an emoji', () => {
  test('the picker\'s Main card and its PIN screen, and the Parent area lock screen', async () => {
    const { app, stopAutoLock } = await bootPicker();
    expect(RNTL.screen.getByTestId('picker-main-lock-icon', { hidden: true })).toBeTruthy(); // the lock on the Main card
    const main = RNTL.screen.getAllByRole('button').find((b) => /Main/.test(String(b.props.accessibilityLabel)));
    await RNTL.fireEvent.press(main!);
    await settle();
    expect(RNTL.screen.getByText(t('fpPinTitle'))).toBeTruthy();
    expect(RNTL.screen.getByTestId('parent-pin-lock-icon', { hidden: true })).toBeTruthy();
    expect(RNTL.screen.queryByText('🔒')).toBeNull();
    stopAutoLock();
    void app;
  });

  test('the lock screen of an expired session', async () => {
    const { app, stopAutoLock } = await bootPicker();
    await enterMainWithPin();
    await RNTL.screen.findByText(t('phChildren'));
    await RNTL.act(async () => {
      app.gate.lockParentArea();
    });
    await settle();
    expect(await RNTL.screen.findByText(t('pgSubtitle'))).toBeTruthy();
    expect(RNTL.screen.getByTestId('parent-pin-lock-icon', { hidden: true })).toBeTruthy();
    expect(RNTL.screen.queryByText('🔒')).toBeNull();
    stopAutoLock();
  });

  test('no lock or unlock emoji is left in any screen file (other emojis, like the pets, are not touched)', () => {
    const fs = require('fs');
    const path = require('path');
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.resolve(dir), { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) => {
        const rel = `${dir}/${e.name}`;
        return e.isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
      });
    const offenders = [...walk('src/components'), ...walk('src/app')].filter((file) => /🔒|🔓/u.test(fs.readFileSync(path.resolve(file), 'utf8')));
    expect(offenders).toEqual([]);
    expect(fs.readFileSync(path.resolve('src/components/app-header.tsx'), 'utf8')).toContain('🐾'); // the paw is still there
  });
});

describe('inside the parent shell there is no second "Parent area unlocked / Lock now" step', () => {
  test('the dashboard and Family Settings show their content without that bar; the session itself is unchanged', async () => {
    const { stopAutoLock } = await bootPicker();
    await enterMainWithPin();
    await RNTL.screen.findByText(t('phChildren'));
    expect(RNTL.screen.queryByText(t('pgUnlockedBar'))).toBeNull();
    expect(RNTL.screen.queryByRole('button', { name: t('pgLockNow') })).toBeNull();
    await pressButton(t('phSettings'));
    await settle();
    expect(RNTL.screen.queryByText(t('pgUnlockedBar'))).toBeNull();
    // leaving still locks: the profile chip is the way out and it ends the session
    expect(RNTL.screen.getByRole('button', { name: /Switch player/ })).toBeTruthy();
    stopAutoLock();
  });

  test('Family Settings is named "Family Settings" (the dashboard is the only "Parent Dashboard"), in English and Spanish', () => {
    const i18n = require('@/i18n') as typeof import('@/i18n');
    expect(i18n.translate('en', 'dashboardTitle')).toBe('Family Settings');
    expect(i18n.translate('es', 'dashboardTitle')).toBe('Ajustes de la familia');
    expect(i18n.translate('en', 'openDashboard')).toBe('Open Family Settings');
    expect(i18n.translate('en', 'phTitle')).toBe('Parent Dashboard');
  });
});

describe('the PIN checker being registered again must not throw away a session that was just opened', () => {
  // The exact sequence seen on the Samsung: the PIN is typed on the picker (session opens), Main starts, and the app start-up code runs
  // again (the navigator rebuilt the root layout) and calls startParentAuth() a second time. That used to register the checker anew, which
  // clears the open session, and the dashboard then asked for the PIN a second time.
  const startAgain = (platformOS = 'ios') => (require('@/utils/parent-pin') as typeof import('@/utils/parent-pin')).startParentAuth({ enabled: true, platformOS });

  test('the second start-up registration keeps the session: dashboard and Family Settings open with no second PIN screen', async () => {
    const { app, stopAutoLock } = await bootPicker();
    await enterMainWithPin();
    await RNTL.screen.findByText(t('phChildren'));
    const before = app.gate.getRegisteredPinVerifier();
    await RNTL.act(async () => {
      expect(startAgain()).toBe(true); // the repeated registration
    });
    await settle();
    expect(app.gate.getRegisteredPinVerifier()).toBe(before); // nothing new was registered
    expect(RNTL.screen.queryByText(t('pgSubtitle'))).toBeNull();
    expect(RNTL.screen.getByText(t('phChildren'))).toBeTruthy();
    await pressButton(t('phSettings'));
    await settle();
    expect((await RNTL.screen.findAllByText(t('dashboardTitle'))).length).toBe(2);
    expect(RNTL.screen.queryByText(t('pgSubtitle'))).toBeNull();
    // and again while moving around
    await RNTL.act(async () => {
      startAgain();
    });
    await pressButton(t('phNavDashboard'));
    await settle();
    expect(await RNTL.screen.findByText(t('phChildren'))).toBeTruthy();
    expect(RNTL.screen.queryByText(t('pgSubtitle'))).toBeNull();
    stopAutoLock();
  });

  test('a checker that really is different still clears the session: another checker registered, or another platform setup', async () => {
    const { app, stopAutoLock } = await bootPicker();
    await enterMainWithPin();
    await RNTL.screen.findByText(t('phChildren'));
    await RNTL.act(async () => {
      expect(startAgain('android')).toBe(true); // a different setup: registered anew
    });
    await settle();
    expect(app.gate.getRegisteredPinVerifier()).not.toBe(undefined);
    expect(RNTL.screen.queryByText('Billy')).toBeNull();
    expect(await RNTL.screen.findByText(t('pgSubtitle'))).toBeTruthy();
    stopAutoLock();
  });

  test('registering any other checker in between (not the one start-up registered) is registered again and locks', async () => {
    const { app, stopAutoLock } = await bootPicker();
    await enterMainWithPin();
    await RNTL.screen.findByText(t('phChildren'));
    await RNTL.act(async () => {
      app.gate.registerPinVerifier({ isConfigured: async () => true, verify: async () => false });
    });
    await RNTL.act(async () => {
      startAgain(); // the start-up checker is no longer the registered one: it is put back, which is a new registration
    });
    await settle();
    expect(await RNTL.screen.findByText(t('pgSubtitle'))).toBeTruthy();
    stopAutoLock();
  });
});

describe('changing the PIN still takes effect, and the other ways a session ends are unchanged', () => {
  test('after a PIN change the old PIN no longer opens the parent area and the new one does', async () => {
    jest.doMock('react', () => ReactTop);
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const app: App = await loadApp();
    await app.profiles.ensureProfilesReady();
    await configurePin(app, { unlocked: true });
    expect(await app.pin.changePin(TEST_PIN, '1357')).toMatchObject({ ok: true });
    app.gate.lockParentArea();
    expect(await app.gate.unlockParentArea(TEST_PIN)).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await app.gate.unlockParentArea('1357')).toEqual({ ok: true });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unlocked' });
  });

  test('idle, the 30-minute cap, a profile change and the background still end the session', async () => {
    jest.doMock('react', () => ReactTop);
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const app: App = await loadApp();
    await app.profiles.ensureProfilesReady();
    await configurePin(app, { unlocked: true });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unlocked' });
    const { setClock } = require('./helpers') as typeof import('./helpers');
    setClock(T0 + app.gate.PARENT_IDLE_LOCK_MS + 1000); // 5 minutes without a touch
    expect(await app.gate.getParentAccess()).toMatchObject({ state: 'locked' });
    expect(await app.gate.unlockParentArea(TEST_PIN)).toEqual({ ok: true });
    for (let i = 0; i < 8; i += 1) {
      setClock(Date.now() + 4 * 60 * 1000);
      app.gate.touchParentSession(); // kept busy: only the 30-minute cap can end it now
    }
    expect(await app.gate.getParentAccess()).toMatchObject({ state: 'locked' });
    expect(await app.gate.unlockParentArea(TEST_PIN)).toEqual({ ok: true });
    app.gate.lockParentArea(); // what the background and a profile change call
    expect(await app.gate.getParentAccess()).toMatchObject({ state: 'locked' });
  });
});
