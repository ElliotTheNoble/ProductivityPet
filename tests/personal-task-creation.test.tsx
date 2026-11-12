import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, configurePin, flush, freezeClock, loadApp, unfreezeClock, type App } from './helpers';

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
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/tasks', useLocalSearchParams: () => ({}), Link: 'Link' }));

// Who may create tasks of their own. A child (by default) may not: no button anywhere, no handler that works, and no save of a new task by
// any route. Main (an adult's or the single player's profile) keeps everything, and nothing that is saved already is touched.
const P = '@ProductivityPet:';
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
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
const policy = () => require('@/utils/task-creation-policy') as typeof import('@/utils/task-creation-policy');
const storage = () => require('@/utils/task-storage') as typeof import('@/utils/task-storage');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string) => i18n().translate('en', key as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 25; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });

const personal = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: `Task ${id}`, category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: false, ...extra });

async function boot(familyMode = true) {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  if (familyMode) process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  else delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  const app: App = await loadApp();
  await app.profiles.ensureProfilesReady();
  const ids: Record<string, string> = {};
  if (familyMode) {
    await configurePin(app, { unlocked: true });
    for (const name of ['Billy', 'Sarah']) {
      const added = await H().addChild(name);
      if (!added.ok || !added.id) throw new Error('child not added');
      ids[name] = added.id;
    }
    await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  }
  return { app, ids };
}

describe('the rule', () => {
  test('family mode off (every user today): nobody is restricted', async () => {
    await boot(false);
    expect(policy().canCreatePersonalTasksNow()).toBe(true);
    expect(policy().mayCreatePersonalTasks(null, 'anyone')).toBe(true);
  });

  test('Main is never restricted; a child is not allowed by default; the later parent permission switches it on for that child only', async () => {
    const { app, ids } = await boot();
    const household = H().peekHousehold();
    expect(policy().mayCreatePersonalTasks(household, 'main')).toBe(true);
    expect(policy().mayCreatePersonalTasks(household, ids.Billy)).toBe(false);
    expect(policy().mayCreatePersonalTasks(household, ids.Sarah)).toBe(false);
    expect(await H().updateChildSettings(ids.Billy, { allowPersonalTasks: true })).toMatchObject({ ok: true }); // what the future setting will write
    const allowed = H().peekHousehold();
    expect(policy().mayCreatePersonalTasks(allowed, ids.Billy)).toBe(true);
    expect(policy().mayCreatePersonalTasks(allowed, ids.Sarah)).toBe(false);
    await app.profiles.switchProfile(ids.Billy);
    expect(policy().canCreatePersonalTasksNow()).toBe(true);
    await app.profiles.switchProfile(ids.Sarah);
    expect(policy().canCreatePersonalTasksNow()).toBe(false);
  });

  test('anything unknown is refused: nobody open, an unknown profile, an archived child, a duplicated id, no household yet', async () => {
    const { ids } = await boot();
    const household = H().peekHousehold();
    expect(policy().mayCreatePersonalTasks(household, null)).toBe(false);
    expect(policy().mayCreatePersonalTasks(household, 'stranger')).toBe(false);
    expect(policy().mayCreatePersonalTasks(null, ids.Billy)).toBe(false);
    expect(policy().mayCreatePersonalTasks(household, ids.Billy, [ids.Billy])).toBe(false);
    await H().updateChildSettings(ids.Billy, { allowPersonalTasks: true });
    await H().setChildArchived(ids.Billy, true);
    expect(policy().mayCreatePersonalTasks(H().peekHousehold(), ids.Billy)).toBe(false);
  });

  test('the permission is saved compatibly: absent for every existing child, and kept when set', async () => {
    const { ids } = await boot();
    expect(H().peekHousehold()!.children[0].settings).toEqual({ canCreateTasks: false, requireApproval: true, petSafety: 'gentle' });
    await H().updateChildSettings(ids.Billy, { allowPersonalTasks: true });
    const raw = JSON.parse((await (await loadAppStorage()).getItem(`${P}household`))!);
    expect(raw.children.find((c: { id: string }) => c.id === ids.Billy).settings.allowPersonalTasks).toBe(true);
  });
});
async function loadAppStorage() {
  const mod = require('@react-native-async-storage/async-storage');
  return (mod.default ?? mod) as { getItem(key: string): Promise<string | null> };
}

describe('no way to save a new task as a child, by any route', () => {
  test('a new task handed to the save is dropped for a child; existing tasks, edits, completions and deletions are saved as before', async () => {
    const { app, ids } = await boot();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify([personal('a'), personal('b', { completed: true, completedAt: '2026-03-10T16:00:00.000Z' })]));
    await app.profiles.switchProfile(ids.Billy);
    const loaded = await storage().getCachedTasks();
    // an alternate route tries to add a task
    storage().persistCachedTasks([...loaded, { ...loaded[0], id: 'sneaky', text: 'Sneaked in' }]);
    await flush();
    expect(JSON.parse((await app.AsyncStorage.getItem(scoped(ids.Billy, 'tasks')))!).map((t: { id: string }) => t.id)).toEqual(['a', 'b']);
    expect((await storage().getCachedTasks()).map((t) => t.id)).toEqual(['a', 'b']);
    // but an ordinary change to existing tasks still saves: completing one, and deleting one
    storage().persistCachedTasks(loaded.map((t) => (t.id === 'a' ? { ...t, completed: true } : t)));
    await flush();
    expect(JSON.parse((await app.AsyncStorage.getItem(scoped(ids.Billy, 'tasks')))!).find((t: { id: string }) => t.id === 'a').completed).toBe(true);
    storage().persistCachedTasks(loaded.filter((t) => t.id !== 'b'));
    await flush();
    expect(JSON.parse((await app.AsyncStorage.getItem(scoped(ids.Billy, 'tasks')))!).map((t: { id: string }) => t.id)).toEqual(['a']);
  });

  test('once the parent allows it, that child can save new tasks again; nobody else can', async () => {
    const { app, ids } = await boot();
    await H().updateChildSettings(ids.Billy, { allowPersonalTasks: true });
    await app.profiles.switchProfile(ids.Billy);
    const loaded = await storage().getCachedTasks();
    storage().persistCachedTasks([...loaded, personal('new-one') as never]);
    await flush();
    expect(JSON.parse((await app.AsyncStorage.getItem(scoped(ids.Billy, 'tasks')))!).map((t: { id: string }) => t.id)).toEqual(['new-one']);
  });

  test('Main (the original adult profile) can still add tasks, and its saved tasks are never touched', async () => {
    const { app } = await boot();
    const original = [personal('m1'), personal('m2', { completed: true })];
    await app.AsyncStorage.setItem(`${P}tasks`, JSON.stringify(original));
    const before = (await app.dump()).get(`${P}tasks`);
    const loaded = await storage().getCachedTasks();
    expect(JSON.stringify(loaded.map((t) => t.id))).toBe(JSON.stringify(['m1', 'm2']));
    storage().persistCachedTasks([...loaded, personal('m3') as never]);
    await flush();
    expect(JSON.parse((await app.AsyncStorage.getItem(`${P}tasks`))!).map((t: { id: string }) => t.id)).toEqual(['m1', 'm2', 'm3']);
    expect(before).toBe(JSON.stringify(original)); // what was saved before was exactly the original
  });

  test('with family mode off the save is exactly as it always was', async () => {
    const { app } = await boot(false);
    const loaded = await storage().getCachedTasks();
    storage().persistCachedTasks([...loaded, personal('free') as never]);
    await flush();
    expect(JSON.parse((await app.AsyncStorage.getItem(`${P}tasks`))!).map((t: { id: string }) => t.id)).toEqual(['free']);
  });

  test('existing child tasks are untouched by all of this: same records, still completable', async () => {
    const { app, ids } = await boot();
    const mine = [personal('a'), personal('b', { completed: true, completedAt: '2026-03-10T16:00:00.000Z' })];
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify(mine));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tokenEarnings'), JSON.stringify({ startedAt: '2026-03-01T00:00:00.000Z', events: [] }));
    const before = new Map((await app.dump()).entries());
    await app.profiles.switchProfile(ids.Billy);
    const loaded = await storage().getCachedTasks();
    expect(loaded.map((t) => t.id)).toEqual(['a', 'b']);
    storage().persistCachedTasks([...loaded, personal('x') as never]); // refused
    await flush();
    const after = await app.dump();
    expect(after.get(scoped(ids.Billy, 'tasks'))).toBe(before.get(scoped(ids.Billy, 'tasks')));
    expect(after.get(scoped(ids.Billy, 'tokenEarnings'))).toBe(before.get(scoped(ids.Billy, 'tokenEarnings')));
    expect(after.get(`${P}tasks`)).toBe(before.get(`${P}tasks`));
    expect(app.tasks.getCompletedTaskCount(await storage().getCachedTasks())).toBe(1);
  });
});

describe('no way to add a task on screen as a child', () => {
  test('the room panel: no add field and no Add button when not allowed; both there when allowed', async () => {
    await boot();
    const { RoomTaskPanel } = require('@/components/room-task-panel') as typeof import('@/components/room-task-panel');
    const noop = () => undefined;
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 1000, height: 700, scale: 1, fontScale: 1 });
    await RNTL.render(<RoomTaskPanel roomName="gym" tasks={[]} onToggleTask={noop} onAddTask={noop} canAdd={false} />);
    await settle();
    expect(RNTL.screen.queryByPlaceholderText(en('panelPlaceholder'))).toBeNull();
    expect(RNTL.screen.queryByText(en('panelAdd'))).toBeNull();
    await RNTL.cleanup();
    await RNTL.render(<RoomTaskPanel roomName="gym" tasks={[]} onToggleTask={noop} onAddTask={noop} />);
    await settle();
    expect(RNTL.screen.getByPlaceholderText(en('panelPlaceholder'))).toBeTruthy();
    expect(RNTL.screen.getByText(en('panelAdd'))).toBeTruthy();
  });

  test('the Tasks screen: a child sees no Add button; Main does', async () => {
    const { app, ids } = await boot();
    const TasksScreen = (require('@/app/tasks') as typeof import('@/app/tasks')).default;
    await app.profiles.switchProfile(ids.Billy);
    await RNTL.render(<TasksScreen />);
    await settle();
    expect(RNTL.screen.queryByText(en('addButton'))).toBeNull();
    await RNTL.cleanup();
    await app.profiles.switchProfile('main');
    await RNTL.render(<TasksScreen />);
    await settle();
    expect(RNTL.screen.getByText(en('addButton'))).toBeTruthy();
  });

  test('the creating handlers refuse by themselves, not only through hidden buttons (source check)', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8');
    expect(read('src/app/tasks.tsx')).toMatch(/function handleAdd\(\) \{\s*if \(!canCreatePersonalTasksNow\(\)\) return;/);
    expect(read('src/components/room-detail-screen.tsx')).toMatch(/function handleAddRoomTask\(text: string\) \{\s*if \(!canCreatePersonalTasksNow\(\)\) return;/);
    expect(read('src/components/room-task-panel.tsx')).toMatch(/function handleAdd\(\) \{\s*if \(!canAdd\) return;/);
    expect(read('src/utils/task-storage.ts')).toMatch(/withoutDisallowedAdditions\(cachedTasks, tasks\)/);
    // the only places a personal task is created, so a new one cannot be missed
    const creators = ['src/app/tasks.tsx', 'src/components/room-detail-screen.tsx'];
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.resolve(dir), { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) => {
        const rel = `${dir}/${e.name}`;
        return e.isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
      });
    const found = walk('src').filter((f) => /\bcreateTask\(/.test(read(f)) && f !== 'src/utils/tasks.ts');
    expect(found.sort()).toEqual(creators.sort());
  });
});
