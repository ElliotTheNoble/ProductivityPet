import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { HOUR, T0, configurePin, freezeClock, iso, loadApp, pet, unfreezeClock, type App } from './helpers';

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

// The Parent Dashboard (Main in family mode): which shell Main gets, what the dashboard and the child overview show, and what they never
// touch. The router is a stand-in: its Slot shows the real dashboard route for /dashboard and a marker for Family Settings (/parent).
const mockRouter = { push: jest.fn(), replace: jest.fn() };
let mockPath = '/dashboard';
jest.mock('expo-router', () => {
  const R = require('react');
  const { Text: T } = require('react-native');
  return {
    useRouter: () => mockRouter,
    usePathname: () => mockPath,
    Redirect: ({ href }: { href: string }) => R.createElement(T, null, `REDIRECT:${href}`),
    Slot: () => {
      if (mockPath === '/dashboard') {
        const Page = require('@/app/dashboard').default;
        return R.createElement(Page);
      }
      return R.createElement(T, null, `ROUTE:${mockPath}`);
    },
    ThemeProvider: ({ children }: { children: unknown }) => children,
    DarkTheme: {},
    DefaultTheme: {},
  };
});

const P = '@ProductivityPet:';
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;

beforeEach(() => {
  freezeClock(T0);
  mockPath = '/dashboard';
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
});
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const family = (pets: object[]) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens: 0 } });

// Everything Main has saved today (its own pet, tasks, journal, purchases, mood and tokens): none of it may be read or changed.
const MAIN_KEYS: Record<string, unknown> = {
  [`${P}petFamily`]: JSON.parse(family([pet({ id: 'main-pet', name: 'MainPet' })])),
  [`${P}petProfile`]: { hunger: 80 },
  [`${P}tasks`]: [{ id: 'mt', text: 'MAIN-TASK' }],
  [`${P}journal`]: [{ id: 'mj', dateISO: '2026-03-01', text: 'MAIN-JOURNAL', createdAt: iso(T0), updatedAt: iso(T0), visibility: 'shared' }],
  [`${P}ownedShopItems`]: ['bow-1'],
  [`${P}mood`]: 'Happy',
  [`${P}moodLog`]: [],
  [`${P}tokenEarnings`]: { events: [] },
};
const MAIN_KEY_NAMES = Object.keys(MAIN_KEYS);

type Options = { children?: string[]; language?: 'en' | 'es'; unlocked?: boolean; seedMain?: boolean };

async function boot(options: Options = {}) {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app: App = await loadApp(options.seedMain === false ? undefined : MAIN_KEYS);
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const household = require('@/utils/household') as typeof import('@/utils/household');
  const ids: Record<string, string> = {};
  for (const name of options.children ?? ['Billy', 'Sarah']) {
    const added = await household.addChild(name);
    if (!added.ok || !added.id) throw new Error('child not added');
    ids[name] = added.id;
  }
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  (require('@/i18n') as typeof import('@/i18n')).setCurrentLanguage(options.language ?? 'en');
  if (options.unlocked === false) app.gate.lockParentArea();
  return { app, ids, household };
}

async function renderChooser(renderGame = () => <ReactNative.Text>GAME-SHELL</ReactNative.Text>) {
  const { ShellChooser } = require('@/components/shell-chooser') as typeof import('@/components/shell-chooser');
  const view = await RNTL.render(<ShellChooser renderGame={renderGame} />);
  await settle();
  return view;
}
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 25; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const text = (key: string) => (require('@/i18n') as typeof import('@/i18n')).translate('en', key as never);
const textEs = (key: string) => (require('@/i18n') as typeof import('@/i18n')).translate('es', key as never);
const press = (name: string | RegExp) => RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name }));

// ---------------------------------------------------------------------------------------------------------
describe('which shell Main gets', () => {
  test('Main with children is the Parent Dashboard: the game is never mounted', async () => {
    await boot();
    const game = jest.fn(() => <ReactNative.Text>GAME-SHELL</ReactNative.Text>);
    await renderChooser(game);
    expect(game).not.toHaveBeenCalled();
    expect(RNTL.screen.queryByText('GAME-SHELL')).toBeNull();
    expect((await RNTL.screen.findAllByText(text('phTitle'), { exact: false })).length).toBeGreaterThan(0);
  });

  test('Main with no child record at all is the ordinary game, exactly as before', async () => {
    await boot({ children: [] });
    await renderChooser();
    expect(RNTL.screen.getByText('GAME-SHELL')).toBeTruthy();
    expect(RNTL.screen.queryByText(text('phNavDashboard'))).toBeNull();
  });

  test('a child profile gets the game, never the dashboard', async () => {
    const { app, ids } = await boot();
    expect(await app.profiles.switchProfile(ids.Billy)).toMatchObject({ ok: true });
    await renderChooser();
    expect(RNTL.screen.getByText('GAME-SHELL')).toBeTruthy();
    expect(RNTL.screen.queryByText(text('phNavDashboard'))).toBeNull();
  });

  test('switching from Main to a child gives the child the normal game, and back again gives Main the dashboard', async () => {
    const { app, ids } = await boot();
    const { ShellChooser } = require('@/components/shell-chooser') as typeof import('@/components/shell-chooser');
    const useId = (require('@/hooks/use-active-profile') as typeof import('@/hooks/use-active-profile')).useActiveProfileId;
    function Host() {
      const id = useId();
      return <ShellChooser key={id} renderGame={() => <ReactNative.Text>{`GAME:${id}`}</ReactNative.Text>} />;
    }
    await RNTL.render(<Host />);
    await settle();
    expect(RNTL.screen.queryByText(/^GAME:/)).toBeNull();
    await RNTL.act(async () => {
      expect(await app.profiles.switchProfile(ids.Billy)).toMatchObject({ ok: true });
    });
    await settle();
    expect(RNTL.screen.getByText(`GAME:${ids.Billy}`)).toBeTruthy();
    expect(RNTL.screen.queryByText(text('phNavDashboard'))).toBeNull();
    await RNTL.act(async () => {
      expect(await app.profiles.switchProfile('main')).toMatchObject({ ok: true });
    });
    await settle();
    expect(RNTL.screen.queryByText(/^GAME:/)).toBeNull();
    expect(RNTL.screen.getByText(text('phNavDashboard'))).toBeTruthy();
  });

  test('adding the first child while Main is the ordinary game does not swap the screen under the person', async () => {
    const { household } = await boot({ children: [] });
    await renderChooser();
    expect(RNTL.screen.getByText('GAME-SHELL')).toBeTruthy();
    await RNTL.act(async () => {
      await household.addChild('Late');
    });
    await settle();
    expect(RNTL.screen.getByText('GAME-SHELL')).toBeTruthy(); // it takes effect the next time Main is entered
  });

  test('a route that belongs to the game is not rendered at all inside the parent shell: it is sent to the dashboard', async () => {
    await boot();
    mockPath = '/tasks';
    await renderChooser();
    expect(RNTL.screen.queryByText('ROUTE:/tasks')).toBeNull();
    expect(mockRouter.replace).toHaveBeenCalledWith('/dashboard');
    for (const route of ['/', '/shop', '/rooms', '/stats', '/pet-alerts', '/mini-games', '/welcome']) {
      mockPath = route;
      await RNTL.cleanup();
      mockRouter.replace.mockClear();
      await renderChooser();
      expect(RNTL.screen.queryByText(`ROUTE:${route}`)).toBeNull();
      expect(mockRouter.replace).toHaveBeenCalledWith('/dashboard');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the dashboard', () => {
  test('lists the real active children with their pets, and nothing invented', async () => {
    const { app, ids } = await boot();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), family([pet({ id: 'p1', name: 'Biscuit' }), pet({ id: 'p2', name: 'Luna', p: { hunger: 20 } })]));
    await renderChooser();
    expect(await RNTL.screen.findByText('Billy')).toBeTruthy();
    expect(RNTL.screen.getByText('Sarah')).toBeTruthy();
    expect(await RNTL.screen.findByText(`2 pets · ${text('phStateNeedsCare')}`)).toBeTruthy();
    expect(await RNTL.screen.findByText(text('phNotStarted'))).toBeTruthy(); // Sarah has not played yet
    expect(RNTL.screen.getByRole('button', { name: text('phOpenChild').replace('{name}', 'Billy') })).toBeTruthy();
  });

  test('an archived child is not listed; no child at all says so and still offers Family Settings', async () => {
    const { household, ids } = await boot();
    await household.setChildArchived(ids.Sarah, true);
    await renderChooser();
    expect(await RNTL.screen.findByText('Billy')).toBeTruthy();
    expect(RNTL.screen.queryByText('Sarah')).toBeNull();
    await RNTL.cleanup();
    await household.setChildArchived(ids.Billy, true);
    await renderChooser();
    expect(await RNTL.screen.findByText(text('phNoChildren'))).toBeTruthy();
    expect(RNTL.screen.getByRole('button', { name: text('phSettingsOpen') })).toBeTruthy();
  });

  test('Family Settings opens the existing /parent screen', async () => {
    await boot();
    await renderChooser();
    await RNTL.screen.findByText('Billy');
    await press(text('phSettingsOpen'));
    expect(mockRouter.push).toHaveBeenCalledWith('/parent');
  });

  test('the header always offers the way to the dashboard, Family Settings and switching profile', async () => {
    await boot();
    await renderChooser();
    expect(RNTL.screen.getByRole('button', { name: text('phNavDashboard') })).toBeTruthy();
    expect(RNTL.screen.getByRole('button', { name: text('phSettings') })).toBeTruthy();
    await press(text('phSettings'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/parent');
    expect(RNTL.screen.getByRole('button', { name: /Switch player/ })).toBeTruthy(); // the profile chip
  });
});

describe('the child overview', () => {
  async function openBilly() {
    const view = await boot();
    await view.app.AsyncStorage.setItem(scoped(view.ids.Billy, 'petFamily'), family([pet({ id: 'p1', name: 'Biscuit' })]));
    await renderChooser();
    await RNTL.screen.findByText('Billy');
    await press(text('phOpenChild').replace('{name}', 'Billy'));
    return view;
  }

  test('shows the child, their pets, a look-only note and clearly labelled "coming soon" sections with no statistics', async () => {
    await openBilly();
    expect(await RNTL.screen.findByText(text('phReadOnly'))).toBeTruthy();
    expect(await RNTL.screen.findByText('Biscuit')).toBeTruthy();
    for (const key of ['phTasks', 'phAchievements', 'phJournals', 'phProgress']) expect(RNTL.screen.getByText(text(key))).toBeTruthy();
    expect(RNTL.screen.getAllByText(text('phSoon'))).toHaveLength(4);
    expect(RNTL.screen.getAllByText(text('phSoonNote'))).toHaveLength(4);
    // nothing numeric is invented: not one number appears in the overview's words
    const strings: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const n = node as { children?: unknown[] };
      for (const child of n.children ?? []) {
        if (typeof child === 'string') strings.push(child);
        else walk(child);
      }
    };
    const tree = RNTL.screen.toJSON();
    for (const root of Array.isArray(tree) ? tree : [tree]) walk(root);
    expect(strings.length).toBeGreaterThan(8);
    expect(strings.filter((s) => /\d/.test(s))).toEqual([]);
  });

  test('there is nothing to edit: only Back, the header and the profile switch are buttons', async () => {
    await openBilly();
    await RNTL.screen.findByText('Biscuit');
    const names = RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
    // exactly: the profile switch, the two header pills, the parent area's own "Lock now", and Back. Nothing that changes anything.
    expect([...names].sort()).toEqual(
      [`Switch player. Playing as Main.`, text('phNavDashboard'), text('phSettings'), 'Lock now', `‹ ${text('phBack')}`].sort()
    );
    expect(RNTL.screen.queryByPlaceholderText(/./)).toBeNull(); // no text field at all
    expect(RNTL.screen.getByRole('button', { name: `‹ ${text('phBack')}` })).toBeTruthy();
  });

  test('Back returns to the list of children', async () => {
    await openBilly();
    await RNTL.screen.findByText('Biscuit');
    await press(`‹ ${text('phBack')}`);
    expect(await RNTL.screen.findByText(text('phChildren'))).toBeTruthy();
    expect(RNTL.screen.getByText('Sarah')).toBeTruthy();
  });

  test('journal content is never shown, private or shared', async () => {
    const view = await boot();
    await view.app.AsyncStorage.setItem(
      scoped(view.ids.Billy, 'journal'),
      JSON.stringify([
        { id: 'a', dateISO: '2026-03-01', text: 'PRIVATE-WORDS', createdAt: iso(T0), updatedAt: iso(T0) },
        { id: 'b', dateISO: '2026-03-02', text: 'SHARED-WORDS', createdAt: iso(T0), updatedAt: iso(T0), visibility: 'shared' },
      ])
    );
    await renderChooser();
    await RNTL.screen.findByText('Billy');
    await press(text('phOpenChild').replace('{name}', 'Billy'));
    await settle();
    const rendered = JSON.stringify(RNTL.screen.toJSON());
    expect(rendered).not.toMatch(/PRIVATE-WORDS|SHARED-WORDS|MAIN-JOURNAL/);
  });

  test('the same in Spanish', async () => {
    const view = await boot({ language: 'es' });
    await view.app.AsyncStorage.setItem(scoped(view.ids.Billy, 'petFamily'), family([pet({ id: 'p1', name: 'Biscuit' })]));
    await renderChooser();
    expect((await RNTL.screen.findAllByText(textEs('phTitle'), { exact: false })).length).toBeGreaterThan(0);
    await RNTL.screen.findByText('Billy');
    await press(textEs('phOpenChild').replace('{name}', 'Billy'));
    expect(await RNTL.screen.findByText(textEs('phReadOnly'))).toBeTruthy();
    expect(RNTL.screen.getAllByText(textEs('phSoon'))).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the Parent PIN still protects everything', () => {
  test('a locked parent area shows the PIN screen instead of the dashboard: no child name, no pet', async () => {
    const { app, ids } = await boot({ unlocked: false });
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), family([pet({ id: 'p1', name: 'Biscuit' })]));
    await renderChooser();
    expect(await RNTL.screen.findByText(new RegExp(text('pgTitle')))).toBeTruthy();
    expect(RNTL.screen.queryByText('Billy')).toBeNull();
    expect(RNTL.screen.queryByText('Biscuit')).toBeNull();
    expect(RNTL.screen.queryByText(text('phChildren'))).toBeNull();
  });

  test('when the session ends (background, idle, a profile change) the dashboard is replaced by the PIN screen', async () => {
    const { app } = await boot();
    await renderChooser();
    expect(await RNTL.screen.findByText('Billy')).toBeTruthy();
    await RNTL.act(async () => {
      app.gate.lockParentArea();
    });
    await settle();
    expect(RNTL.screen.queryByText('Billy')).toBeNull();
    expect(await RNTL.screen.findByText(new RegExp(text('pgTitle')))).toBeTruthy();
    // the header stays, so a parent can still switch profile
    expect(RNTL.screen.getByRole('button', { name: /Switch player/ })).toBeTruthy();
  });

  test('the dashboard address renders nothing of the dashboard for a child profile or without family mode (source and behaviour)', async () => {
    const { app, ids } = await boot();
    await app.profiles.switchProfile(ids.Billy);
    const Page = (require('@/app/dashboard') as typeof import('@/app/dashboard')).default;
    await RNTL.render(<Page />);
    expect(RNTL.screen.getByText('REDIRECT:/')).toBeTruthy();
    expect(RNTL.screen.queryByText('Billy')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('Main\'s own data is untouched', () => {
  const MAIN_RE = new RegExp(`^${P}(${['petFamily', 'petProfile', 'tasks', 'journal', 'ownedShopItems', 'mood', 'moodLog', 'tokenEarnings'].join('|')})$`);

  test('through the dashboard, the overview and Family Settings navigation: not one Main game record is read, written or removed', async () => {
    const { app, ids } = await boot();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), family([pet({ id: 'p1', name: 'Biscuit' })]));
    await settle();
    const before = await app.dump();
    for (const key of MAIN_KEY_NAMES) expect(before.has(key)).toBe(true);
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    const removeItem = jest.spyOn(app.AsyncStorage, 'removeItem');
    for (const spy of [getItem, setItem, removeItem]) spy.mockClear();

    await renderChooser();
    await RNTL.screen.findByText('Billy');
    await press(text('phOpenChild').replace('{name}', 'Billy'));
    await RNTL.screen.findByText('Biscuit');
    await press(`‹ ${text('phBack')}`);
    await press(text('phSettings')); // navigation only (the router is a stand-in)
    await settle();

    const readKeys = getItem.mock.calls.map(([key]) => String(key)); // before this test's own dump below reads everything
    expect(readKeys.filter((key) => MAIN_RE.test(key))).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    const after = await app.dump();
    for (const key of MAIN_KEY_NAMES) expect(after.get(key)).toBe(before.get(key)); // byte for byte
    expect(after).toEqual(before);
  });

  test('no game system starts for Main: no pet catch-up, alerts, mail or token history is loaded', async () => {
    const { app } = await boot();
    await renderChooser();
    await RNTL.screen.findByText('Billy');
    await settle();
    // the stores a game shell would load were never asked for anything: their saved records were not touched by this session
    const keys = [...(await app.dump()).keys()];
    expect(keys.filter((key) => /pawadiseMail|pawadisePostcards|petAlertSchedule|kittyCatch|memoryMatch/.test(key))).toEqual([]);
  });
});

describe('where the dashboard code may reach', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8').replace(/\/\/.*$/gm, '');

  test('the dashboard, the parent shell and the shell chooser never import a game store, a journal or a task list', () => {
    const forbidden = /@\/utils\/(journal|journal-sharing|task-storage|tasks|pet-family|pet-profile|paw-tokens|shop-inventory|mood-log|token-history|pet-alerts|pawadise)|@\/hooks\/use-pet-family/;
    for (const file of ['src/components/parent-home.tsx', 'src/components/parent-shell.tsx', 'src/components/shell-chooser.tsx', 'src/app/dashboard.tsx']) {
      expect([file, forbidden.test(read(file))]).toEqual([file, false]);
    }
  });

  test('the dashboard screens never call a function that changes a child or household record', () => {
    const code = read('src/components/parent-home.tsx');
    expect(code).not.toMatch(/\b(addChild|renameChild|setChildArchived|addTask|approveTask|sendTaskBack|deleteTask|markTaskDone|updateChildSettings|selectChild|switchProfile|setItem|writeScoped)\b/);
  });

  test('the parent shell mounts the game systems nowhere, and the only routes it shows are the three parent screens', () => {
    const shell = read('src/components/parent-shell.tsx');
    expect(shell).not.toMatch(/AppHeader|PetFamilyBar|ResurrectionOverlay|CriticalAlertEffects|startPetAlerts|startPawadiseMail|advanceAllPets|loadPetProfile/);
    expect(shell).toMatch(/\['\/dashboard', '\/parent', '\/parent-security'\]/);
    expect(shell).toMatch(/allowed \? <Slot \/> :/);
  });
});
