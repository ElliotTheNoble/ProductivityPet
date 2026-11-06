import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, freezeClock, iso, pet, resetSecure, unfreezeClock } from './helpers';

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));

// Stage 4.2: the profile switch chip in the app header, the unfinished-work tracking behind its confirmation, and what happens when
// leaving works and when it does not. Each test starts from a fresh copy of every module over an in-memory storage and renders the
// real family gate, the real chip and the real unfinished-work hook around small stand-ins for the screens.

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

const P = '@ProductivityPet:';
const HOUSEHOLD = `${P}household`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;

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

const LONG = 'Maximilian Alexander Fitzgerald-Hartwell'; // 40 characters, the longest nickname there can be
const kids = () => ({
  [HOUSEHOLD]: household([child('kid-mia', 'Mia'), child('kid-long', LONG)]),
  [scoped('kid-mia', 'petFamily')]: family([pet({ id: 'a' })]),
  [scoped('kid-long', 'petFamily')]: family([pet({ id: 'l' })]),
});

type Options = { seed?: Record<string, string>; open?: string; language?: 'en' | 'es'; family?: boolean };

async function boot(options: Options = {}) {
  jest.resetModules();
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  resetSecure();
  const AsyncStorage = (require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage')) as typeof import('@react-native-async-storage/async-storage').default;
  await AsyncStorage.clear();
  for (const [key, value] of Object.entries(options.seed ?? kids())) await AsyncStorage.setItem(key, value);
  const React = ReactTop;
  const rntl = RNTL;
  const { Text, Pressable, View, TextInput } = ReactNative;
  const i18n = require('@/i18n') as typeof import('@/i18n');
  i18n.setCurrentLanguage(options.language ?? 'en');
  const profiles = require('@/utils/profiles') as typeof import('@/utils/profiles');
  const session = require('@/utils/family-session') as typeof import('@/utils/family-session');
  const unfinished = require('@/utils/unfinished-work') as typeof import('@/utils/unfinished-work');
  const familyStore = require('@/utils/pet-family') as typeof import('@/utils/pet-family');
  const { useUnfinishedWork } = require('@/hooks/use-unfinished-work') as typeof import('@/hooks/use-unfinished-work');
  const { FamilyGate } = require('@/components/family-gate') as typeof import('@/components/family-gate');
  const { ProfileChip } = require('@/components/profile-chip') as typeof import('@/components/profile-chip');
  const pinModule = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
  const household_ = require('@/utils/household') as typeof import('@/utils/household');
  pinModule.startParentAuth({ enabled: true, platformOS: 'ios' });
  await profiles.ensureProfilesReady();
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  await household_.ensureHouseholdLoaded();
  if (options.open) {
    expect(await profiles.switchProfile(options.open)).toMatchObject({ ok: true });
    session.markProfileChosen();
    session.consumePendingRoute();
  }

  // a screen that holds an unfinished game round, a task draft and a bath, and that the test can switch on and off
  function Screen() {
    const [round, setRound] = React.useState(false);
    const [draft, setDraft] = React.useState('');
    useUnfinishedWork('kitty-catch', round);
    useUnfinishedWork('task-draft', draft.trim().length > 0);
    const [loaded, setLoaded] = React.useState('loading');
    React.useEffect(() => {
      void familyStore.ensureFamilyLoaded().then(() => setLoaded(`SCREEN ${profiles.getActiveProfileId()}`));
    }, []);
    return React.createElement(
      View,
      null,
      React.createElement(Text, null, loaded),
      React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'start-round', onPress: () => setRound(true) }, React.createElement(Text, null, 'r')),
      React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'end-round', onPress: () => setRound(false) }, React.createElement(Text, null, 'e')),
      React.createElement(TextInput, { accessibilityLabel: 'draft', value: draft, onChangeText: setDraft }),
    );
  }
  const view = await rntl.render(
    React.createElement(FamilyGate, null, React.createElement(View, null, React.createElement(ProfileChip), React.createElement(Screen))),
  );
  return { AsyncStorage, rntl, screen: rntl.screen, fireEvent: rntl.fireEvent, i18n, profiles, session, unfinished, familyStore, household: household_, view, React, ReactNative, useUnfinishedWork };
}
type App = Awaited<ReturnType<typeof boot>>;

const t = (app: App, key: Parameters<App['i18n']['translate']>[1], params?: Parameters<App['i18n']['translate']>[2]) =>
  app.i18n.translate(app.i18n.getCurrentLanguage(), key, params);
const chip = (app: App, name: string) => app.screen.getByRole('button', { name: t(app, 'pcLabel', { name }) });
const noChip = (app: App) => app.screen.queryByRole('button', { name: /^Switch player|^Cambiar de jugador/ });
const press = (app: App, label: string) => app.fireEvent.press(app.screen.getByRole('button', { name: label }));
const dialogButton = (app: App, key: Parameters<App['i18n']['translate']>[1]) => app.screen.getByRole('button', { name: t(app, key) });

// ---------------------------------------------------------------------------------------------------------
describe('when the chip is shown', () => {
  test('a child profile: the chip names the child and says it switches players', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    expect(chip(app, 'Mia')).toBeTruthy();
    expect(app.screen.getByText('Mia')).toBeTruthy();
  });

  test('the Main profile is called Main (Principal in Spanish)', async () => {
    const en = await boot({ open: 'main' });
    await en.screen.findByText('SCREEN main');
    expect(chip(en, 'Main')).toBeTruthy();
    const es = await boot({ open: 'main', language: 'es' });
    await es.screen.findByText('SCREEN main');
    expect(es.screen.getByRole('button', { name: 'Cambiar de jugador. Jugando como Principal.' })).toBeTruthy();
  });

  test('Spanish: label and hint are Spanish, and the child name is shown exactly as typed', async () => {
    const app = await boot({ open: 'kid-mia', language: 'es' });
    await app.screen.findByText('SCREEN kid-mia');
    const button = app.screen.getByRole('button', { name: 'Cambiar de jugador. Jugando como Mia.' });
    expect(button.props.accessibilityHint).toBe('Vuelve a la lista de jugadores. Antes se guardan tus mascotas y tu progreso.');
  });

  test('a household with no child record at all has no picker, so there is no chip (the single-user app is unchanged)', async () => {
    const app = await boot({ seed: {}, open: 'main' });
    await app.screen.findByText('SCREEN main');
    expect(noChip(app)).toBeNull();
  });

  test('a profile that is not in the family list is never labelled as someone else', async () => {
    const app = await boot({ open: 'main' });
    await app.screen.findByText('SCREEN main');
    expect(chip(app, 'Main')).toBeTruthy();
    // switch the household under the chip to one that does not contain the open profile
    app.profiles.getActiveProfileId();
    const other = await boot({ seed: { [HOUSEHOLD]: household([child('someone-else', 'Zed')]) }, open: 'main' });
    await other.screen.findByText('SCREEN main');
    expect(chip(other, 'Main')).toBeTruthy(); // Main always has its own name
  });

  test('the chip is not on the picker (nobody has been chosen: the app, header and chip are not even mounted)', async () => {
    const app = await boot();
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(noChip(app)).toBeNull();
    expect(app.screen.queryByText(/SCREEN/)).toBeNull();
  });

  test('family mode off: the header does not even load the chip, and the chip file is only reached behind the flag', async () => {
    const fs = require('fs');
    const path = require('path');
    const header = fs.readFileSync(path.resolve('src/components/app-header.tsx'), 'utf8') as string;
    expect(header).toMatch(/FAMILY_MODE_ENABLED \? \(require\('@\/components\/profile-chip'\)/);
    expect(header).not.toMatch(/^import .*profile-chip/m);
    // and with the flag off nothing is switchable at all
    const app = await boot({ family: false, open: 'main' });
    expect(await app.session.leaveProfile()).toEqual({ ok: false, reason: 'not-available' });
  });

  test('the welcome and setup screens have no header, so no chip (the header is not drawn on /welcome)', () => {
    const fs = require('fs');
    const path = require('path');
    const layout = fs.readFileSync(path.resolve('src/app/_layout.tsx'), 'utf8') as string;
    expect(layout).toMatch(/\{isWelcome \? null : <AppHeader \/>\}/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('size and layout', () => {
  test('the chip is at least 44px tall and a long nickname is cut with an ellipsis instead of growing it', async () => {
    const app = await boot({ open: 'kid-long' });
    await app.screen.findByText('SCREEN kid-long');
    const button = chip(app, LONG);
    const body = app.screen.getByText(LONG);
    expect(body.props.numberOfLines).toBe(1);
    const flat = app.ReactNative.StyleSheet.flatten(body.props.style);
    expect(flat.flexShrink).toBe(1);
    // the row inside the button: minHeight 44 and a maximum width that always leaves room on a phone
    let row = body.parent;
    while (row && !(app.ReactNative.StyleSheet.flatten(row.props.style)?.minHeight >= 44)) row = row.parent;
    const rowStyle = app.ReactNative.StyleSheet.flatten(row!.props.style);
    expect(rowStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(rowStyle.maxWidth).toBeLessThanOrEqual(240);
    expect(button).toBeTruthy();
  });

  test('the source keeps the 44px minimum and the width cap, and the chip is the first item of the header row (before the Paw Tokens)', () => {
    const fs = require('fs');
    const path = require('path');
    const code = fs.readFileSync(path.resolve('src/components/profile-chip.tsx'), 'utf8') as string;
    expect(code).toMatch(/minHeight: 44/);
    expect(code).toMatch(/Math\.min\(240/);
    const header = fs.readFileSync(path.resolve('src/components/app-header.tsx'), 'utf8') as string;
    expect(header.indexOf('<ProfileChip />')).toBeGreaterThan(0);
    expect(header.indexOf('<ProfileChip />')).toBeLessThan(header.indexOf('styles.pawTokenPill'));
  });

  test('the two dialog buttons are at least 44px tall (the shared dialog)', () => {
    const fs = require('fs');
    const path = require('path');
    expect(fs.readFileSync(path.resolve('src/components/confirm-modal.tsx'), 'utf8')).toMatch(/minHeight: 44/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('unfinished-work tracking', () => {
  test('a screen registers while it holds something unfinished, lets go when it is finished, and the list is stable', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    expect(app.unfinished.listUnfinishedWork()).toEqual([]);
    await press(app, 'start-round');
    expect(app.unfinished.listUnfinishedWork()).toEqual(['kitty-catch']);
    const same = app.unfinished.listUnfinishedWork();
    expect(app.unfinished.listUnfinishedWork()).toBe(same); // the same array until something changes
    await app.fireEvent.changeText(app.screen.getByLabelText('draft'), 'buy milk');
    expect(app.unfinished.listUnfinishedWork()).toEqual(['kitty-catch', 'task-draft']);
    await press(app, 'end-round');
    expect(app.unfinished.listUnfinishedWork()).toEqual(['task-draft']);
    await app.fireEvent.changeText(app.screen.getByLabelText('draft'), '   ');
    expect(app.unfinished.listUnfinishedWork()).toEqual([]); // an empty draft is nothing to lose
  });

  test('it is released when the screen goes away (unmount) and never counts one thing twice', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const off1 = app.unfinished.registerUnfinishedWork('bathing');
    const off2 = app.unfinished.registerUnfinishedWork('bathing');
    expect(app.unfinished.listUnfinishedWork()).toEqual(['bathing']);
    off1();
    expect(app.unfinished.listUnfinishedWork()).toEqual(['bathing']); // the second one still holds it
    off2();
    off2(); // letting go twice is harmless
    expect(app.unfinished.listUnfinishedWork()).toEqual([]);
    await press(app, 'start-round');
    await app.view.unmount();
    expect(app.unfinished.listUnfinishedWork()).toEqual([]);
  });

  test('every kind is listed in a fixed order', async () => {
    const app = await boot({ open: 'kid-mia' });
    const kinds = ['journal', 'task-edit', 'task-draft', 'bathing', 'memory-match', 'kitty-catch'] as const;
    for (const kind of kinds) app.unfinished.registerUnfinishedWork(kind);
    expect(app.unfinished.listUnfinishedWork()).toEqual(['kitty-catch', 'memory-match', 'bathing', 'task-draft', 'task-edit', 'journal']);
  });

  test('nothing carries over to the next profile: it is emptied when the profile is left', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await press(app, 'start-round');
    await app.fireEvent.changeText(app.screen.getByLabelText('draft'), 'Mia is writing');
    expect(app.unfinished.listUnfinishedWork()).toHaveLength(2);
    await app.rntl.act(async () => {
      expect(await app.session.leaveProfile()).toEqual({ ok: true, changed: true });
    });
    expect(app.unfinished.listUnfinishedWork()).toEqual([]);
    await app.screen.findByText(t(app, 'fpTitle'));
    await app.rntl.act(async () => {
      await app.profiles.switchProfile('kid-long');
      app.session.markProfileChosen();
    });
    await app.screen.findByText('SCREEN kid-long');
    expect(app.unfinished.listUnfinishedWork()).toEqual([]); // Leo/Max starts with nothing of Mia's
    expect(app.screen.getByLabelText('draft').props.value).toBe(''); // and none of her text
  });

  test('a REAL screen reports it: typing in the room task panel is unfinished work until it is added or cleared, and closing the screen lets go', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const { RoomTaskPanel } = require('@/components/room-task-panel') as typeof import('@/components/room-task-panel');
    const added: string[] = [];
    const panel = await app.rntl.render(
      app.React.createElement(RoomTaskPanel, { roomName: 'kitchen', tasks: [], onToggleTask: () => undefined, onAddTask: (text: string) => added.push(text) } as never),
    );
    const open = panel.queryByPlaceholderText(t(app, 'panelPlaceholder'));
    if (!open) await app.fireEvent.press(panel.getAllByRole('button')[0]); // a narrow screen starts with the panel folded
    const input = panel.getByPlaceholderText(t(app, 'panelPlaceholder'));
    expect(app.unfinished.listUnfinishedWork()).toEqual([]);
    await app.fireEvent.changeText(input, 'wash the cups');
    expect(app.unfinished.listUnfinishedWork()).toEqual(['task-draft']);
    await app.fireEvent.changeText(input, '');
    expect(app.unfinished.listUnfinishedWork()).toEqual([]);
    await app.fireEvent.changeText(input, 'again');
    expect(app.unfinished.listUnfinishedWork()).toEqual(['task-draft']);
    await panel.unmount();
    expect(app.unfinished.listUnfinishedWork()).toEqual([]);
  });

  test('the screens that can hold unfinished work are wired to it (and the ones that cannot report it are listed)', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8') as string;
    expect(read('src/components/mini-games/kitty-catch-game.tsx')).toMatch(/useUnfinishedWork\('kitty-catch', phase === 'playing'\)/);
    expect(read('src/components/mini-games/memory-match-game.tsx')).toMatch(/useUnfinishedWork\('memory-match', phase === 'playing'\)/);
    expect(read('src/components/room-detail-screen.tsx')).toMatch(/useUnfinishedWork\(\s*'bathing'/);
    expect(read('src/app/tasks.tsx')).toMatch(/useUnfinishedWork\('task-draft'/);
    expect(read('src/components/room-task-panel.tsx')).toMatch(/useUnfinishedWork\('task-draft'/);
    expect(read('src/components/task-edit-modal.tsx')).toMatch(/useUnfinishedWork\(\s*'task-edit'/);
    expect(read('src/components/mood-journey-screen.tsx')).toMatch(/useUnfinishedWork\('journal'/);
    // never stored anywhere
    expect(read('src/utils/unfinished-work.ts')).not.toMatch(/AsyncStorage|writeScoped|setItem|localStorage/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('tapping the chip', () => {
  test('with nothing unfinished it switches at once, with no confirmation, and the picker shows', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const leave = jest.spyOn(app.session, 'leaveProfile');
    await app.rntl.act(async () => {
      app.fireEvent.press(chip(app, 'Mia'));
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(leave).toHaveBeenCalledTimes(1);
    expect(app.screen.queryByText(t(app, 'pcConfirmTitle'))).toBeNull();
    expect(app.screen.queryByText(/SCREEN/)).toBeNull();
    expect(app.profiles.isProfileReleased()).toBe(true);
  });

  test('with unfinished work it asks first, naming exactly what would be lost, and Cancel changes nothing', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await press(app, 'start-round');
    await app.fireEvent.changeText(app.screen.getByLabelText('draft'), 'half a thought');
    const leave = jest.spyOn(app.session, 'leaveProfile');
    await app.fireEvent.press(chip(app, 'Mia'));

    expect(app.screen.getByText(t(app, 'pcConfirmTitle'))).toBeTruthy();
    expect(app.screen.getByText(t(app, 'pcConfirmIntro'))).toBeTruthy();
    expect(app.screen.getByText(`• ${t(app, 'pcKindKitty')}`)).toBeTruthy();
    expect(app.screen.getByText(`• ${t(app, 'pcKindTaskDraft')}`)).toBeTruthy();
    expect(app.screen.queryByText(`• ${t(app, 'pcKindBathing')}`)).toBeNull(); // only what really exists
    expect(app.screen.getByText(t(app, 'pcConfirmSaved'))).toBeTruthy();
    expect(leave).not.toHaveBeenCalled(); // asking is not leaving

    await app.fireEvent.press(dialogButton(app, 'pcCancel'));
    expect(app.screen.queryByText(t(app, 'pcConfirmTitle'))).toBeNull();
    expect(leave).not.toHaveBeenCalled();
    expect(app.session.hasChosenProfile()).toBe(true);
    expect(app.screen.getByLabelText('draft').props.value).toBe('half a thought'); // nothing was touched
    expect(app.unfinished.listUnfinishedWork()).toEqual(['kitty-catch', 'task-draft']);
  });

  test('the confirmation names every kind of unfinished work, including the task editor', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    for (const kind of ['kitty-catch', 'memory-match', 'bathing', 'task-draft', 'task-edit', 'journal'] as const) app.unfinished.registerUnfinishedWork(kind);
    await app.fireEvent.press(chip(app, 'Mia'));
    for (const key of ['pcKindKitty', 'pcKindMemory', 'pcKindBathing', 'pcKindTaskDraft', 'pcKindTaskEdit', 'pcKindJournal'] as const) {
      expect(app.screen.getByText(`• ${t(app, key)}`)).toBeTruthy();
    }
  });

  test('Switch player in the confirmation leaves through leaveProfile, and the unfinished work is gone with the profile', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await app.fireEvent.changeText(app.screen.getByLabelText('draft'), 'half a thought');
    const leave = jest.spyOn(app.session, 'leaveProfile');
    await app.fireEvent.press(chip(app, 'Mia'));
    await app.rntl.act(async () => {
      app.fireEvent.press(dialogButton(app, 'pcConfirmSwitch'));
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(leave).toHaveBeenCalledTimes(1);
    expect(app.unfinished.listUnfinishedWork()).toEqual([]);
  });

  test('the confirmation is in Spanish too', async () => {
    const app = await boot({ open: 'kid-mia', language: 'es' });
    await app.screen.findByText('SCREEN kid-mia');
    await press(app, 'start-round');
    await app.fireEvent.press(chip(app, 'Mia'));
    expect(app.screen.getByText('¿Cambiar de jugador?')).toBeTruthy();
    expect(app.screen.getByText('• Tu ronda de Kitty Catch')).toBeTruthy();
    expect(app.screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(app.screen.getByRole('button', { name: 'Cambiar de jugador' })).toBeTruthy();
  });

  test('the parent area is locked before the release, and the chip never opens Main or any parent screen itself', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const lock = jest.spyOn(require('@/utils/parent-gate') as typeof import('@/utils/parent-gate'), 'lockParentArea');
    const original = app.profiles.releaseActiveProfile;
    let lockedBeforeRelease = false;
    jest.spyOn(app.profiles, 'releaseActiveProfile').mockImplementation(async (...args) => {
      lockedBeforeRelease = lock.mock.calls.length > 0;
      return original(...args);
    });
    await app.rntl.act(async () => {
      app.fireEvent.press(chip(app, 'Mia'));
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(lockedBeforeRelease).toBe(true);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(app.screen.queryByText('DASHBOARD-CONTENT')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('when leaving does not work', () => {
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

  test('a friendly message says nothing was lost, the profile stays open, and Keep playing closes it with nothing changed', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await app.fireEvent.changeText(app.screen.getByLabelText('draft'), 'still here');
    const restore = failSaves(app);
    app.familyStore.addToWallet(5);

    await app.fireEvent.press(chip(app, 'Mia'));
    await app.rntl.act(async () => {
      app.fireEvent.press(dialogButton(app, 'pcConfirmSwitch'));
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    await app.screen.findByText(t(app, 'pcFailTitle'));
    expect(app.screen.getByText(t(app, 'pcFailSave', { name: 'Mia' }))).toBeTruthy();
    expect(app.screen.getByRole('button', { name: t(app, 'pcTryAgain') })).toBeTruthy();
    expect(app.screen.queryByText(t(app, 'fpTitle'))).toBeNull(); // no success, no picker
    expect(app.session.hasChosenProfile()).toBe(true);
    expect(app.profiles.getActiveProfileId()).toBe('kid-mia');
    expect(app.profiles.isProfileReleased()).toBe(false);

    await app.fireEvent.press(dialogButton(app, 'pcKeepPlaying'));
    expect(app.screen.queryByText(t(app, 'pcFailTitle'))).toBeNull();
    expect(app.screen.getByLabelText('draft').props.value).toBe('still here'); // exactly as it was
    expect(app.familyStore.peekFamily()?.wallet.pawTokens).toBe(5);
    expect(app.screen.queryByRole('progressbar', { name: t(app, 'fpLeaving') })).toBeNull(); // the cover is gone
    restore();
  });

  test('Try again after the storage works switches for real, and everything that was waiting is saved', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const restore = failSaves(app);
    app.familyStore.addToWallet(5);

    await app.rntl.act(async () => {
      app.fireEvent.press(chip(app, 'Mia'));
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await app.screen.findByText(t(app, 'pcFailTitle'));
    restore();
    await app.rntl.act(async () => {
      app.fireEvent.press(dialogButton(app, 'pcTryAgain'));
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(JSON.parse((await app.AsyncStorage.getItem(scoped('kid-mia', 'petFamily')))!).wallet.pawTokens).toBe(5);
    expect(app.profiles.isProfileReleased()).toBe(true);
  });

  test('the failure message is in Spanish too', async () => {
    const app = await boot({ open: 'kid-mia', language: 'es' });
    await app.screen.findByText('SCREEN kid-mia');
    const restore = failSaves(app);
    app.familyStore.addToWallet(5);
    await app.rntl.act(async () => {
      app.fireEvent.press(chip(app, 'Mia'));
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await app.screen.findByText('No se pudo cambiar de jugador');
    expect(app.screen.getByText('Algunos cambios todavía no se pudieron guardar, así que sigues en el perfil de Mia. No se perdió nada. Inténtalo de nuevo en un momento.')).toBeTruthy();
    expect(app.screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy();
    expect(app.screen.getByRole('button', { name: 'Seguir jugando' })).toBeTruthy();
    restore();
  });

  test('a second tap while leaving is running does nothing', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const leave = jest.spyOn(app.session, 'leaveProfile');
    await app.rntl.act(async () => {
      app.fireEvent.press(chip(app, 'Mia'));
      app.fireEvent.press(chip(app, 'Mia'));
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    expect(leave).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('profile sessions and data leakage', () => {
  test('the chip of the next profile shows only that profile, and a late save from the one that was left changes nothing', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    const owner = app.profiles.captureProfileOwner();
    const profileFromMia = await app.familyStore.getPetProfileForSelectedPet();
    await app.rntl.act(async () => {
      app.fireEvent.press(chip(app, 'Mia'));
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    await app.rntl.act(async () => {
      await app.profiles.switchProfile('kid-long');
      app.session.markProfileChosen();
    });
    await app.screen.findByText('SCREEN kid-long');
    expect(chip(app, LONG)).toBeTruthy();
    expect(app.screen.queryByText('Mia')).toBeNull();
    expect(app.profiles.isProfileOwner(owner)).toBe(false);

    const before = app.familyStore.peekFamily();
    app.familyStore.savePetProfileForSelectedPet({ ...profileFromMia, pawTokens: 4242 });
    expect(app.familyStore.peekFamily()).toEqual(before);
  });

  test('the next screen after switching starts on the home screen (the route is reset once)', async () => {
    const app = await boot({ open: 'kid-mia' });
    await app.screen.findByText('SCREEN kid-mia');
    await app.rntl.act(async () => {
      app.fireEvent.press(chip(app, 'Mia'));
    });
    await app.screen.findByText(t(app, 'fpTitle'));
    await app.rntl.act(async () => {
      await app.profiles.switchProfile('kid-mia');
      app.session.markProfileChosen();
    });
    expect(app.session.consumePendingRoute()).toBe('/');
  });
});
