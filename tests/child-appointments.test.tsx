import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, configurePin, freezeClock, loadApp, unfreezeClock, type App } from './helpers';

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
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/', useLocalSearchParams: () => ({}), Link: 'Link' }));

// A child's Home "Today's Tasks" card and Tasks tab: ONE list of the parent's tasks and the child's own, no empty sections, a legend only for what
// is shown. Main (and anyone who is not a child of the household) keeps both screens exactly as they were.
const P = '@ProductivityPet:';
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;

beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const H = () => require('@/utils/household') as typeof import('@/utils/household');
const views = () => require('@/components/assigned-task-views') as typeof import('@/components/assigned-task-views');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: `Mine ${id}`, category: 'Personal', important: false, kind: 'task', date: '2026-03-10', completed: false, ...extra });
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');

async function boot() {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app: App = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const added = await H().addChild('Billy');
  if (!added.ok || !added.id) throw new Error('child not added');
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  i18n().setCurrentLanguage('en');
  return { app, billy: added.id };
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
const appointment = (id: string, text: string) => ({ id, text, category: 'Personal', important: false, kind: 'event', date: '2026-03-10', time: '3:00 PM', completed: false });
const HomeScreen = () => (require('@/app/index') as typeof import('@/app/index')).default;
const heading = () => en('todaysAppointments');
const seed = (app: App, key: string, items: unknown[]) => app.AsyncStorage.setItem(key, JSON.stringify(items));

describe('Home: the appointments card for a child', () => {
  async function home(profile: string, app: App) {
    await app.profiles.switchProfile(profile);
    const Home = HomeScreen();
    await RNTL.render(<Home />);
    await settle();
  }

  test('no appointment today: the whole card is gone (heading and empty message), for a child', async () => {
    const { app, billy } = await boot();
    await home(billy, app);
    expect(words()).not.toContain(heading());
    expect(words()).not.toContain(en('noAppointmentsToday'));
    expect(words()).toContain(en('todaysTasks')); // the rest of the panel is untouched
  });

  test('an appointment today shows the card with it', async () => {
    const { app, billy } = await boot();
    const key = `@ProductivityPet:p:${billy}:tasks`;
    await seed(app, key, [appointment('a1', 'Dentist')]);
    await home(billy, app);
    expect(words()).toContain(heading());
    expect(words()).toContain('Dentist');
    expect(JSON.parse((await app.AsyncStorage.getItem(key))!)).toHaveLength(1); // the record is untouched
  });

  test('an appointment on another day is not for today: the card stays hidden, and the record stays saved', async () => {
    const { app, billy } = await boot();
    const key = `@ProductivityPet:p:${billy}:tasks`;
    await seed(app, key, [{ ...appointment('a2', 'Next week'), date: '2026-03-20' }]);
    await home(billy, app);
    expect(words()).not.toContain(heading());
    expect(JSON.parse((await app.AsyncStorage.getItem(key))!)).toHaveLength(1);
  });

  test('only the selected child\'s appointments: another child\'s appointment does not show the card', async () => {
    const { app, billy } = await boot();
    const other = await H().addChild('Sarah');
    if (!other.ok || !other.id) throw new Error('no child');
    await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
    await seed(app, `@ProductivityPet:p:${other.id}:tasks`, [appointment('s1', 'Sarah-only visit')]);
    await home(billy, app);
    expect(words()).not.toContain(heading());
    expect(words()).not.toContain('Sarah-only visit');
  });

  test('Main keeps the card always, empty message included', async () => {
    const { app } = await boot();
    await home('main', app);
    expect(words()).toContain(heading());
    expect(words()).toContain(en('noAppointmentsToday'));
  });

  test('wiring (source check): only a child profile hides it, and nothing is removed from the data', () => {
    const source = read('src/app/index.tsx');
    expect(source).toMatch(/isChildProfile && todaysDisplayAppointments\.length === 0 \? null : appointmentsCard/);
    expect(source).toMatch(/const isChildProfile = useIsChildProfile\(\)/);
  });
});
