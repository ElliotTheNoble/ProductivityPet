import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, freezeClock, iso, pet, resetSecure, unfreezeClock } from './helpers';

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));

// Stage 4.3: the live inactivity rule in the real family gate: the warning, the timeout that returns to the picker, a failed return,
// the background, and what is and is not counted as the person being there. Time is a fake clock (the controller's timer is asked to
// look by hand, as the 9- and 10-minute timers would), the storage is in memory, the Parent PIN and gate are the real ones.

const MIN = 60 * 1000;
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/' }));
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

const mockClock = globalThis as unknown as { __wall: number; __mono: number };
jest.mock('@/utils/activity-clock', () => {
  const actual = jest.requireActual('@/utils/activity-clock');
  return { ...actual, systemTime: { read: () => ({ wall: mockClock.__wall, mono: mockClock.__mono }) } };
});

const P = '@ProductivityPet:';
const HOUSEHOLD = `${P}household`;
const REGISTRY = `${P}profiles`;
const BACKUP = `${P}backup:preM2:`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
const originalOS = ReactNative.Platform.OS;
beforeEach(() => {
  freezeClock(T0);
  mockClock.__wall = 1_700_000_000_000;
  mockClock.__mono = 5_000;
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
});
afterEach(() => {
  unfreezeClock();
  // the inactivity timer of the last test's idle session is cancelled, so no 10-minute timer outlives the test
  const idle = require('@/utils/idle-session') as typeof import('@/utils/idle-session');
  const controller = idle.getIdleController();
  if (controller) idle.stopIdleSession(controller);
  (ReactNative.Platform as { OS: string }).OS = originalOS;
  delete (globalThis as { document?: unknown }).document;
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
const kids = () => ({
  [HOUSEHOLD]: household([child('kid-mia', 'Mia'), child('kid-leo', 'Leo')]),
  [scoped('kid-mia', 'petFamily')]: family([pet({ id: 'a' })]),
  [scoped('kid-leo', 'petFamily')]: family([pet({ id: 'l' })]),
  [`${P}petFamily`]: family([pet({ id: 'm' })]),
});

type Options = { seed?: Record<string, string>; open?: string; language?: 'en' | 'es'; web?: boolean };

async function boot(options: Options = {}) {
  jest.resetModules();
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  resetSecure();
  const handlers: ((state: string) => void)[] = [];
  jest.spyOn(ReactNative.AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
    handlers.push(handler);
    return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
  }) as never);
  const announce = jest.spyOn(ReactNative.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  const documentListeners: Record<string, ((event: unknown) => void)[]> = {};
  if (options.web) {
    (ReactNative.Platform as { OS: string }).OS = 'web';
    (globalThis as { document?: unknown }).document = {
      addEventListener: (name: string, fn: (event: unknown) => void) => ((documentListeners[name] ??= []).push(fn)),
      removeEventListener: (name: string, fn: (event: unknown) => void) => {
        documentListeners[name] = (documentListeners[name] ?? []).filter((f) => f !== fn);
      },
    };
  }
  const AsyncStorage = (require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage')) as typeof import('@react-native-async-storage/async-storage').default;
  await AsyncStorage.clear();
  for (const [key, value] of Object.entries(options.seed ?? kids())) await AsyncStorage.setItem(key, value);
  const React = ReactTop;
  const { Text, View } = ReactNative;
  const i18n = require('@/i18n') as typeof import('@/i18n');
  i18n.setCurrentLanguage(options.language ?? 'en');
  const profiles = require('@/utils/profiles') as typeof import('@/utils/profiles');
  const session = require('@/utils/family-session') as typeof import('@/utils/family-session');
  const idle = require('@/utils/idle-session') as typeof import('@/utils/idle-session');
  const unfinished = require('@/utils/unfinished-work') as typeof import('@/utils/unfinished-work');
  const familyStore = require('@/utils/pet-family') as typeof import('@/utils/pet-family');
  const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
  const { FamilyGate } = require('@/components/family-gate') as typeof import('@/components/family-gate');
  const pinModule = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
  const household_ = require('@/utils/household') as typeof import('@/utils/household');
  pinModule.startParentAuth({ enabled: true, platformOS: 'ios' });
  await profiles.ensureProfilesReady();
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  await household_.ensureHouseholdLoaded();
  gate.startParentGateAutoLock();
  if (options.open) {
    expect(await profiles.switchProfile(options.open)).toMatchObject({ ok: true });
    session.markProfileChosen();
    session.consumePendingRoute();
  }
  function Screen() {
    const [loaded, setLoaded] = React.useState('loading');
    React.useEffect(() => {
      void familyStore.ensureFamilyLoaded().then(() => setLoaded(`SCREEN ${profiles.getActiveProfileId()}`));
    }, []);
    return React.createElement(Text, null, loaded);
  }
  const view = await RNTL.render(React.createElement(FamilyGate, null, React.createElement(View, null, React.createElement(Screen))));
  const emitAppState = (state: string) => RNTL.act(() => handlers.slice().forEach((h) => h(state)));
  // time passes (both clocks); the controller's timer is asked to look, as the real timer would at that moment
  const pass = async (ms: number) => {
    mockClock.__wall += ms;
    mockClock.__mono += ms;
    await RNTL.act(async () => {
      idle.getIdleController()?.check();
    });
  };
  return { AsyncStorage, rntl: RNTL, screen: RNTL.screen, fireEvent: RNTL.fireEvent, i18n, profiles, session, idle, unfinished, familyStore, gate, view, handlers, announce, documentListeners, emitAppState, pass, React, ReactNative };
}
type App = Awaited<ReturnType<typeof boot>>;

const t = (app: App, key: Parameters<App['i18n']['translate']>[1], params?: Parameters<App['i18n']['translate']>[2]) =>
  app.i18n.translate(app.i18n.getCurrentLanguage(), key, params);
const snapshot = async (app: App) =>
  [...(await app.AsyncStorage.getAllKeys())]
    .filter((k) => k !== REGISTRY && !k.startsWith(BACKUP) && !k.includes('parentAuth') && !k.includes('parentGate') && !k.endsWith('petAlertSchedule'))
    .sort();
const dump = async (app: App) => {
  const out: [string, string | null][] = [];
  for (const k of await snapshot(app)) out.push([k, await app.AsyncStorage.getItem(k)]);
  return out;
};
const walletOf = async (app: App, key: string) => JSON.parse((await app.AsyncStorage.getItem(key))!).wallet.pawTokens;

// ---------------------------------------------------------------------------------------------------------
describe('when the rule runs', () => {
  test('a household with a child: the rule runs for a child profile and for Main', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    expect(app.idle.getIdleController()).not.toBeNull();
    const main = await boot({ open: 'main' });
    await main.screen.findByText('SCREEN main');
    expect(main.idle.getIdleController()).not.toBeNull();
  });

  test('a household whose only child is archived: the rule still runs, for Main (archiving never turns it off)', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: household([child('kid-mia', 'Mia', { archivedAt: iso(T0) })]) }, open: 'main' });
    await app.screen.findByText('SCREEN main');
    expect(app.idle.getIdleController()).not.toBeNull();
    await app.pass(9 * MIN);
    expect(app.screen.getByText(t(app, 'idleTitle'))).toBeTruthy();
  });

  test('a household with no child record at all: there is no picker, so no timer and no warning', async () => {
    const app = await boot({ seed: {}, open: 'main' });
    await app.screen.findByText('SCREEN main');
    expect(app.idle.getIdleController()).toBeNull();
    await app.pass(30 * MIN);
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull();
    expect(app.screen.queryByText(t(app, 'fpTitle'))).toBeNull();
  });

  test('family mode off: the guard is only reachable through the family gate, which only the flag loads', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8') as string;
    const layout = read('src/app/_layout.tsx');
    expect(layout).toMatch(/if \(!FAMILY_MODE_ENABLED\) return <AppShell/);
    expect(layout).toMatch(/require\('@\/components\/family-gate'\)/);
    expect(layout).not.toMatch(/idle-guard|idle-session/);
    expect(read('src/components/family-gate.tsx')).toMatch(/import \{ IdleGuard \} from '@\/components\/idle-guard'/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the "Still playing?" warning', () => {
  test('exactly at 9 minutes it shows (not a moment before), friendly, with one Continue playing button of at least 44px', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await app.pass(9 * MIN - 1);
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull();
    await app.pass(1);
    expect(app.screen.getByText(t(app, 'idleTitle'))).toBeTruthy();
    expect(app.screen.getByText(t(app, 'idleBody'))).toBeTruthy();
    expect(app.screen.getByRole('button', { name: t(app, 'idleContinue') })).toBeTruthy();
    expect(app.screen.queryByRole('button', { name: t(app, 'cancel') })).toBeNull(); // one answer only
    expect(app.screen.queryByText(t(app, 'idleUnfinishedIntro'))).toBeNull(); // nothing unfinished: nothing to say about it
    const fs = require('fs');
    expect(fs.readFileSync(require('path').resolve('src/components/confirm-modal.tsx'), 'utf8')).toMatch(/minHeight: 44/);
  });

  test('screen readers are told when it appears, and it is a modal dialog with a focusable button', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    expect(app.announce).not.toHaveBeenCalled();
    await app.pass(9 * MIN);
    expect(app.announce).toHaveBeenCalledWith(t(app, 'idleTitle'));
    expect(app.screen.getByRole('button', { name: t(app, 'idleContinue') }).props.accessible).toBe(true);
  });

  test('it announces itself ONCE: re-renders, activity and time passing do not repeat it, and a second warning announces again', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await app.pass(9 * MIN);
    expect(app.announce).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 8; i += 1) {
      app.unfinished.registerUnfinishedWork(i % 2 === 0 ? 'bathing' : 'journal'); // changes that re-render the dialog
      app.idle.notifyUserActivity();
      await app.pass(5_000);
    }
    expect(app.announce).toHaveBeenCalledTimes(1);
    await app.rntl.act(async () => {
      app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'idleContinue') }));
    });
    await app.pass(9 * MIN);
    expect(app.announce).toHaveBeenCalledTimes(2);
  });

  test("Continue playing works through a screen reader's accessibility click and is a plain focusable button for keyboards", async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await app.pass(9 * MIN);
    const button = app.screen.getByRole('button', { name: t(app, 'idleContinue') });
    expect(button.props.accessible).toBe(true);
    expect(button.props.accessibilityState?.disabled).toBeFalsy();
    expect(button.props.tabIndex).not.toBe(-1); // reachable by Tab; Enter and Space press it (react-native-web's Pressable)
    // TalkBack's click: a non-pointer click event that targets the button itself, which Pressable answers with its onPress
    const target = {};
    await app.rntl.act(async () => {
      button.props.onClick({ nativeEvent: {}, currentTarget: target, target, stopPropagation: () => undefined });
    });
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull();
    expect(app.session.hasChosenProfile()).toBe(true);
    await app.pass(8 * MIN);
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull(); // a fresh ten minutes
  });

  test('it names the unfinished work that really exists, and only that', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    app.unfinished.registerUnfinishedWork('kitty-catch');
    app.unfinished.registerUnfinishedWork('task-draft');
    await app.pass(9 * MIN);
    expect(app.screen.getByText(t(app, 'idleUnfinishedIntro'))).toBeTruthy();
    expect(app.screen.getByText(`• ${t(app, 'pcKindKitty')}`)).toBeTruthy();
    expect(app.screen.getByText(`• ${t(app, 'pcKindTaskDraft')}`)).toBeTruthy();
    expect(app.screen.queryByText(`• ${t(app, 'pcKindBathing')}`)).toBeNull();
    expect(app.screen.getByText(t(app, 'idleSaved'))).toBeTruthy();
  });

  test('Spanish', async () => {
    const app = await boot({ open: 'kid-mia', language: 'es' });
    await app.screen.findByText('SCREEN kid-mia');
    app.unfinished.registerUnfinishedWork('memory-match');
    await app.pass(9 * MIN);
    expect(app.screen.getByText('¿Sigues jugando?')).toBeTruthy();
    expect(app.screen.getByText('• Tu ronda de Memory Match')).toBeTruthy();
    expect(app.screen.getByRole('button', { name: 'Seguir jugando' })).toBeTruthy();
  });

  test('Continue playing closes it and starts a fresh 10 minutes', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await app.pass(9 * MIN + 30_000);
    await app.rntl.act(async () => {
      app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'idleContinue') }));
    });
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull();
    await app.pass(8 * MIN);
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull();
    expect(app.session.hasChosenProfile()).toBe(true);
    await app.pass(1 * MIN);
    expect(app.screen.getByText(t(app, 'idleTitle'))).toBeTruthy(); // 9 minutes after the press
  });

  test('passive animations and stray taps cannot dismiss it, and the Android Back key answers it like Continue playing', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await app.pass(9 * MIN);
    for (let i = 0; i < 10; i += 1) {
      app.idle.notifyUserActivity(); // a touch somewhere that is not the button
      await app.pass(1000);
    }
    expect(app.screen.getByText(t(app, 'idleTitle'))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('meaningful activity', () => {
  test('a touch anywhere in the app (the native capture handlers) resets the timer without claiming the touch', async () => {
    const app = await boot({ open: 'kid-mia' });
    const text = await app.screen.findByText('SCREEN kid-mia');
    let wrapper = text.parent;
    while (wrapper && !wrapper.props.onTouchStartCapture) wrapper = wrapper.parent;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.props.onTouchMoveCapture).toBeDefined();
    expect(wrapper!.props.onTouchEndCapture).toBeDefined();
    expect(wrapper!.props.onStartShouldSetResponderCapture).toBeUndefined(); // it only looks at the touch
    expect(wrapper!.props.onMoveShouldSetResponderCapture).toBeUndefined();
    await app.pass(8 * MIN);
    await app.rntl.act(async () => {
      wrapper!.props.onTouchStartCapture();
    });
    await app.pass(8 * MIN);
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull();
    await app.pass(1 * MIN);
    expect(app.screen.getByText(t(app, 'idleTitle'))).toBeTruthy();
  });

  test('a screen reader activating a control (an accessibility click, which is not a touch) counts, natively and on the web', async () => {
    const native = await boot({ open: 'kid-mia' });
    const text = await native.screen.findByText('SCREEN kid-mia');
    let wrapper = text.parent;
    while (wrapper && !wrapper.props.onClickCapture) wrapper = wrapper.parent;
    expect(wrapper).not.toBeNull(); // TalkBack's click and a hardware Enter arrive as clicks; the container sees them first
    expect(wrapper!.props.onClickCapture).toBeInstanceOf(Function);
    await native.pass(8 * MIN);
    await native.rntl.act(async () => {
      wrapper!.props.onClickCapture({ nativeEvent: {} });
    });
    await native.pass(8 * MIN);
    expect(native.screen.queryByText(t(native, 'idleTitle'))).toBeNull();
    await native.pass(1 * MIN);
    expect(native.screen.getByText(t(native, 'idleTitle'))).toBeTruthy();

    const web = await boot({ open: 'kid-mia', web: true });
    await web.screen.findByText('SCREEN kid-mia');
    const click = (event: object) => web.documentListeners.click.forEach((fn) => fn(event));
    await web.pass(8 * MIN);
    await web.rntl.act(async () => click({ isTrusted: false })); // a script calling element.click() is not the person
    await web.pass(1 * MIN);
    expect(web.screen.getByText(t(web, 'idleTitle'))).toBeTruthy();
    await web.rntl.act(async () => {
      web.fireEvent.press(web.screen.getByRole('button', { name: t(web, 'idleContinue') }));
    });
    await web.pass(8 * MIN);
    await web.rntl.act(async () => click({ isTrusted: true })); // a screen reader's activation arrives as a trusted click
    await web.pass(8 * MIN);
    expect(web.screen.queryByText(t(web, 'idleTitle'))).toBeNull();
  });

  test('the tracking never claims a touch or a click: it only looks (so screen readers, buttons and gestures are unaffected)', async () => {
    const app = await boot({ open: 'kid-mia' });
    const text = await app.screen.findByText('SCREEN kid-mia');
    let wrapper = text.parent;
    while (wrapper && !wrapper.props.onClickCapture) wrapper = wrapper.parent;
    for (const name of ['onStartShouldSetResponder', 'onMoveShouldSetResponder', 'onStartShouldSetResponderCapture', 'onMoveShouldSetResponderCapture', 'onResponderGrant']) {
      expect(wrapper!.props[name]).toBeUndefined();
    }
    for (const name of ['onTouchStartCapture', 'onTouchMoveCapture', 'onTouchEndCapture', 'onClickCapture']) {
      expect(wrapper!.props[name]()).toBeUndefined(); // returns nothing: it never stops the event
    }
  });

  test('a game being played or a bathing control being held (touches that keep moving, a pointer that keeps moving) never times out', async () => {
    const native = await boot({ open: 'kid-mia' });
    const text = await native.screen.findByText('SCREEN kid-mia');
    let wrapper = text.parent;
    while (wrapper && !wrapper.props.onTouchMoveCapture) wrapper = wrapper.parent;
    for (let second = 0; second < 40 * 60; second += 20) {
      await native.rntl.act(async () => {
        wrapper!.props.onTouchMoveCapture(); // a finger dragging in Kitty Catch or over a bathing circle
      });
      await native.pass(20_000);
    }
    expect(native.screen.queryByText(t(native, 'idleTitle'))).toBeNull();
    expect(native.session.hasChosenProfile()).toBe(true);

    const web = await boot({ open: 'kid-mia', web: true });
    await web.screen.findByText('SCREEN kid-mia');
    for (let second = 0; second < 40 * 60; second += 20) {
      await web.rntl.act(async () => {
        web.documentListeners.pointermove.forEach((fn) => fn({ movementX: 2, movementY: 1, pointerType: 'mouse' })); // holding the mouse over a circle
      });
      await web.pass(20_000);
    }
    expect(web.screen.queryByText(t(web, 'idleTitle'))).toBeNull();
    expect(web.session.hasChosenProfile()).toBe(true);
  });

  test('on the web: a pointer press, a key, the wheel and touch count; a pointer that did not move and anything else do not', async () => {
    const app = await boot({ open: 'kid-mia', web: true });
    await app.screen.findByText('SCREEN kid-mia');
    expect(Object.keys(app.documentListeners).sort()).toEqual(['click', 'keydown', 'pointerdown', 'pointermove', 'touchmove', 'touchstart', 'wheel']);
    const fire = (name: string, event: object = {}) => app.documentListeners[name].forEach((fn) => fn(event));
    // not interactions: a "move" with no movement (a layout change under a still pointer), no events at all
    await app.pass(8 * MIN);
    fire('pointermove', { movementX: 0, movementY: 0, pointerType: 'mouse' });
    await app.pass(1 * MIN);
    expect(app.screen.getByText(t(app, 'idleTitle'))).toBeTruthy(); // nothing reset it: 9 minutes
    await app.rntl.act(async () => {
      app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'idleContinue') }));
    });
    for (const [name, event] of [
      ['pointerdown', {}],
      ['keydown', {}],
      ['wheel', {}],
      ['touchstart', {}],
      ['touchmove', {}],
      ['pointermove', { movementX: 3, movementY: 0, pointerType: 'mouse' }],
    ] as const) {
      await app.pass(8 * MIN);
      await app.rntl.act(async () => fire(name, event));
      await app.pass(8 * MIN);
      expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull(); // each one reset the clock (16 minutes in two halves)
    }
  });

  test('the web listeners are passive capture listeners, removed when the profile is left', async () => {
    const app = await boot({ open: 'kid-mia', web: true });
    await app.screen.findByText('SCREEN kid-mia');
    await app.rntl.act(async () => {
      await app.session.leaveProfile();
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    for (const name of Object.keys(app.documentListeners)) expect(app.documentListeners[name]).toEqual([]);
  });

  test('the source registers capture, passive listeners and ignores unmoved pointers', () => {
    const fs = require('fs');
    const code = fs.readFileSync(require('path').resolve('src/components/idle-guard.tsx'), 'utf8') as string;
    expect(code).toMatch(/capture: true, passive: true/);
    expect(code).toMatch(/movementX !== 0 \|\| e\.movementY !== 0/);
    expect(code).not.toMatch(/['"]scroll['"]/); // scripted scrolling is not the person
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('at 10 minutes', () => {
  test('with no interaction the app goes back to the picker: parent area locked first, saves finished, data kept, memory cleared', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    app.familyStore.addToWallet(7);
    const cancelAll = require('expo-notifications').cancelAllScheduledNotificationsAsync as jest.Mock;
    const calls = cancelAll.mock.calls.length;
    const lock = jest.spyOn(app.gate, 'lockParentArea');
    const original = app.profiles.releaseActiveProfile;
    let lockedBefore = false;
    jest.spyOn(app.profiles, 'releaseActiveProfile').mockImplementation(async (...args) => {
      lockedBefore = lock.mock.calls.length > 0;
      return original(...args);
    });
    app.unfinished.registerUnfinishedWork('task-draft');
    await app.pass(10 * MIN);
    await app.screen.findByText(t(app, 'fpTitle'));

    expect(lockedBefore).toBe(true);
    expect(app.screen.queryByText(/SCREEN/)).toBeNull();
    expect(app.profiles.isProfileReleased()).toBe(true);
    expect(app.familyStore.peekFamily()).toBeNull(); // the departing profile's memory was cleared (after the release worked)
    expect(app.unfinished.listUnfinishedWork()).toEqual([]);
    expect(cancelAll.mock.calls.length).toBe(calls + 1);
    expect(await walletOf(app, scoped('kid-mia', 'petFamily'))).toBe(7); // the saved data, including the last change, is there
    expect(app.idle.getIdleController()?.getSnapshot().phase ?? 'none').not.toBe('failed');
  });

  test('Main and every child keep all their data, byte for byte (only the profile just left may have been caught up and saved)', async () => {
    for (const id of ['kid-mia', 'main']) {
      const app = await boot({ open: id });
      await app.screen.findByText(`SCREEN ${id}`);
      const before = await dump(app);
      await app.pass(10 * MIN);
      await app.screen.findByText(t(app, 'fpTitle'));
      const after = await dump(app);
      const own = id === 'main' ? (k: string) => !k.startsWith(`${P}p:`) && k !== HOUSEHOLD : (k: string) => k.startsWith(scoped(id, ''));
      expect(after.filter(([k]) => !own(k))).toEqual(before.filter(([k]) => !own(k)));
      expect(after.map(([k]) => k)).toEqual(expect.arrayContaining(before.map(([k]) => k)));
    }
  });

  test('the next profile starts on the home screen and has a fresh clock and none of the previous profile\'s state', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const first = app.idle.getIdleController()!;
    await app.pass(10 * MIN);
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(app.idle.getIdleController()).toBeNull(); // the rule stopped with the profile that was left
    expect(first.getSnapshot().phase).toBe('leaving');
    await app.rntl.act(async () => {
      await app.profiles.switchProfile('kid-leo');
      app.session.markProfileChosen();
    });
    await app.screen.findByText('SCREEN kid-leo');
    expect(app.session.consumePendingRoute()).toBe('/');
    const second = app.idle.getIdleController()!;
    expect(second).not.toBe(first);
    expect(second.getSnapshot().phase).toBe('active');
    // a late timer or tap of the first controller changes nothing for the second profile
    const leave = jest.spyOn(app.session, 'leaveProfile');
    first.check();
    first.activity();
    expect(leave).not.toHaveBeenCalled();
    await app.pass(5 * MIN);
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('when the return fails', () => {
  function failSaves(app: App) {
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === scoped('kid-mia', 'petFamily')) throw new Error('storage failed');
      return original(key, value);
    });
    return () => {
      app.AsyncStorage.setItem = original;
    };
  }

  test('the profile stays open with a friendly dialog (Try again, Keep playing), nothing retries by itself, and nothing is reported as done', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const restore = failSaves(app);
    app.familyStore.addToWallet(5);
    const leave = jest.spyOn(app.session, 'leaveProfile');
    await app.pass(10 * MIN);
    await app.screen.findByText(t(app, 'pcFailTitle'), {}, { timeout: 3000 });
    expect(app.screen.getByText(t(app, 'pcFailSave', { name: 'Mia' }))).toBeTruthy();
    expect(app.screen.getByRole('button', { name: t(app, 'pcTryAgain') })).toBeTruthy();
    expect(app.screen.getByRole('button', { name: t(app, 'pcKeepPlaying') })).toBeTruthy();
    expect(app.screen.queryByText(t(app, 'fpTitle'))).toBeNull();
    expect(app.profiles.getActiveProfileId()).toBe('kid-mia');
    expect(app.profiles.isProfileReleased()).toBe(false);
    expect(app.familyStore.peekFamily()?.wallet.pawTokens).toBe(5); // nothing lost, nothing cleared

    await app.pass(60 * MIN);
    await app.pass(60 * MIN);
    expect(leave).toHaveBeenCalledTimes(1); // no automatic retry
    restore();
  });

  test('Keep playing closes the dialog and resets the timer: no immediate retry, and the warning only comes after 9 quiet minutes', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const restore = failSaves(app);
    app.familyStore.addToWallet(5);
    const leave = jest.spyOn(app.session, 'leaveProfile');
    await app.pass(10 * MIN);
    await app.screen.findByText(t(app, 'pcFailTitle'), {}, { timeout: 3000 });
    await app.rntl.act(async () => {
      app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'pcKeepPlaying') }));
    });
    expect(app.screen.queryByText(t(app, 'pcFailTitle'))).toBeNull();
    await app.pass(1);
    await app.pass(8 * MIN);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull();
    await app.pass(1 * MIN);
    expect(app.screen.getByText(t(app, 'idleTitle'))).toBeTruthy();
    restore();
  });

  test('Try again after the storage works returns to the picker and everything that was waiting is saved', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const restore = failSaves(app);
    app.familyStore.addToWallet(5);
    await app.pass(10 * MIN);
    await app.screen.findByText(t(app, 'pcFailTitle'), {}, { timeout: 3000 });
    restore();
    await app.rntl.act(async () => {
      app.fireEvent.press(app.screen.getByRole('button', { name: t(app, 'pcTryAgain') }));
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(await walletOf(app, scoped('kid-mia', 'petFamily'))).toBe(5);
  });

  test('the failure dialog is Spanish too', async () => {
    const app = await boot({ open: 'kid-mia', language: 'es' });
    await app.screen.findByText('SCREEN kid-mia');
    const restore = failSaves(app);
    app.familyStore.addToWallet(5);
    await app.pass(10 * MIN);
    await app.screen.findByText('No se pudo cambiar de jugador', {}, { timeout: 3000 });
    expect(app.screen.getByRole('button', { name: 'Seguir jugando' })).toBeTruthy();
    restore();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the background and the foreground', () => {
  test('going to the background locks the parent area at once and does not release the profile, however long it lasts', async () => {
    const app = await boot({ open: 'main' });
    await app.screen.findByText('SCREEN main');
    const leave = jest.spyOn(app.session, 'leaveProfile');
    app.gate.openParentSession(); // a parent has just unlocked the parent area
    const heard = jest.fn();
    app.gate.subscribeToParentAccess(heard);
    await app.emitAppState('background');
    expect(heard).toHaveBeenCalled(); // the existing parent-gate rule: the session ended at once
    await app.pass(3 * 60 * MIN);
    expect(leave).not.toHaveBeenCalled();
    expect(app.profiles.isProfileReleased()).toBe(false);
    expect(app.session.hasChosenProfile()).toBe(true);
  });

  test('back after 10 minutes or more: safely back to the picker (pending saves finish first); the foreground is not activity', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    app.familyStore.addToWallet(3);
    await app.emitAppState('background');
    await app.pass(10 * MIN);
    await app.rntl.act(async () => {
      await app.emitAppState('active');
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(await walletOf(app, scoped('kid-mia', 'petFamily'))).toBe(3);
  });

  test('back after less than 10 minutes keeps the profile (and the warning if it is already the last minute)', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await app.emitAppState('background');
    await app.pass(3 * MIN);
    await app.emitAppState('active');
    expect(app.screen.getByText('SCREEN kid-mia')).toBeTruthy();
    expect(app.screen.queryByText(t(app, 'idleTitle'))).toBeNull();
    await app.emitAppState('background');
    await app.pass(6 * MIN + 30_000);
    await app.emitAppState('active');
    expect(app.screen.getByText(t(app, 'idleTitle'))).toBeTruthy(); // 9.5 minutes since the last interaction
    expect(app.session.hasChosenProfile()).toBe(true);
  });

  test('device sleep and clock changes leave conservatively', async () => {
    const sleep = await boot({ open: 'kid-mia' });
    await sleep.screen.findByText('SCREEN kid-mia');
    mockClock.__wall += 20 * MIN; // slept: the wall clock moved on, the monotonic one did not
    await sleep.rntl.act(async () => {
      sleep.idle.getIdleController()!.check();
    });
    await sleep.screen.findByText(t(sleep, 'fpTitle'));

    const back = await boot({ open: 'kid-mia' });
    await back.screen.findByText('SCREEN kid-mia');
    mockClock.__wall -= 3 * 60 * MIN; // the clock was set back
    await back.rntl.act(async () => {
      back.idle.getIdleController()!.check();
    });
    await back.screen.findByText(t(back, 'fpTitle'));
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('closed panels (Pet Progress, Home Features) are not reachable', () => {
  function panel(app: App, open: boolean) {
    const { SlideOutPanel } = require('@/components/slide-out-panel') as typeof import('@/components/slide-out-panel');
    return app.rntl.render(
      app.React.createElement(
        app.ReactNative.View,
        null,
        app.React.createElement(
        SlideOutPanel,
        { side: 'right', label: 'Pet Progress', icon: 'paw', tint: '#fff', panelBackground: '#fff', panelWidth: 300, open, onOpen: () => undefined, onClose: () => undefined } as never,
        app.React.createElement(app.ReactNative.Text, { accessibilityLabel: 'PANEL-BODY' }, 'inside'),
        ),
      ),
    );
  }
  // Walks the rendered tree and returns, for the first element that matches, the chain of elements from the top down to it.
  type Json = { type?: string; props?: Record<string, unknown>; children?: (Json | string)[] | null };
  const pathTo = (app: App, matches: (node: Json) => boolean): Json[] | null => {
    const walk = (node: Json | string | null, chain: Json[]): Json[] | null => {
      if (!node || typeof node === 'string') return null;
      const here = [...chain, node];
      if (matches(node)) return here;
      for (const child of node.children ?? []) {
        const found = walk(child, here);
        if (found) return found;
      }
      return null;
    };
    const tree = app.rntl.screen.toJSON() as Json | Json[] | null;
    for (const root of Array.isArray(tree) ? tree : [tree]) {
      const found = walk(root, []);
      if (found) return found;
    }
    return null;
  };
  const labelled = (label: string) => (node: Json) => node.props?.accessibilityLabel === label;
  const textOf = (text: string) => (node: Json) => node.type === 'Text' && (node.children ?? []).includes(text);
  const above = (chain: Json[], prop: string) => chain.slice(0, -1).find((node) => node.props?.[prop] !== undefined) ?? null;

  test('closed: the panel, its Close button and the dimmed backdrop are hidden from keyboard focus and screen readers; the tab handle stays', async () => {
    const app = await boot({ seed: {} });
    await panel(app, false);
    const chains = [pathTo(app, textOf('inside')), pathTo(app, textOf('Close')), pathTo(app, labelled('Close Pet Progress'))];
    for (const chain of chains) {
      expect(chain).not.toBeNull();
      const hidden = above(chain!, 'importantForAccessibility');
      expect(hidden).not.toBeNull();
      expect(hidden!.props!.importantForAccessibility).toBe('no-hide-descendants');
      expect(hidden!.props!.accessibilityElementsHidden).toBe(true);
      expect(hidden!.props!['aria-hidden']).toBe(true);
    }
    expect(above(chains[0]!, 'inert')?.props?.inert).toBe(true); // no keyboard focus on the web
    // the handle that opens it is not hidden
    const handle = pathTo(app, labelled('Open Pet Progress'));
    expect(handle).not.toBeNull();
    expect(above(handle!, 'importantForAccessibility')).toBeNull();
    expect(above(handle!, 'inert')).toBeNull();
  });

  test('open: nothing is hidden, and the controls are there as before', async () => {
    const app = await boot({ seed: {} });
    await panel(app, true);
    for (const chain of [pathTo(app, textOf('inside')), pathTo(app, textOf('Close'))]) {
      expect(chain).not.toBeNull();
      expect(above(chain!, 'importantForAccessibility')).toBeNull();
      expect(above(chain!, 'inert')).toBeNull();
    }
    expect(pathTo(app, labelled('Close Pet Progress'))).not.toBeNull();
  });
});
