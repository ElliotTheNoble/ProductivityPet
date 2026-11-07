import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

// Stage 4.5b: with family mode OFF (every real user, and every release build) nothing of the household set-up or management is
// reachable: not the Pet Care card, not the addresses /parent and /parent-security, and not the parent steps of /welcome (which stays
// the first-run language choice). Saved household and onboarding data is never touched. With family mode ON the same screens work as
// before. Real routes and screens; only the heavy dashboard / gate content is replaced by a marker where a test only needs to know
// whether it was rendered.

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockRedirects: string[] = [];
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    useRouter: () => mockRouter,
    Redirect: ({ href }: { href: string }) => {
      mockRedirects.push(href);
      return R.createElement(require('react-native').Text, null, `REDIRECT:${href}`);
    },
  };
});

const loaded: string[] = [];
jest.mock('@/components/parent-dashboard', () => {
  const R = require('react');
  (globalThis as unknown as { __loaded: string[] }).__loaded.push('dashboard');
  return { ParentDashboard: () => R.createElement(require('react-native').Text, null, 'DASHBOARD-CONTENT') };
});
jest.mock('@/components/parent-security-screen', () => {
  const R = require('react');
  (globalThis as unknown as { __loaded: string[] }).__loaded.push('security');
  return { ParentSecurityScreen: () => R.createElement(require('react-native').Text, null, 'SECURITY-CONTENT') };
});
jest.mock('@/components/parent-gate', () => {
  const R = require('react');
  (globalThis as unknown as { __loaded: string[] }).__loaded.push('gate');
  return { ParentGate: ({ children }: { children: unknown }) => R.createElement(R.Fragment, null, children) };
});
(globalThis as unknown as { __loaded: string[] }).__loaded = loaded;

const P = '@ProductivityPet:';
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
const originalDev = (globalThis as unknown as { __DEV__: boolean }).__DEV__;

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRedirects.length = 0;
  loaded.length = 0;
});
afterEach(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = originalDev;
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const kid = { id: 'kid-mia', nickname: 'Mia', createdAt: '2026-01-01T00:00:00.000Z', settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' }, tasks: [] };
const HOUSEHOLD = JSON.stringify({ version: 1, parent: { displayName: 'Pat', familyName: 'Lee' }, children: [kid], selectedChildId: null });
const onboarding = (over: object = {}) =>
  JSON.stringify({ version: 1, status: 'pending', language: 'en', mode: 'parent', step: 'profile', updatedAt: '2026-01-01T00:00:00.000Z', ...over });

async function boot(options: { family: boolean; seed?: Record<string, string>; dev?: boolean }) {
  jest.resetModules();
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = options.dev ?? true;
  if (options.family) process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  else delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  const storageModule = require('@react-native-async-storage/async-storage');
  const AsyncStorage = storageModule.default ?? storageModule;
  await AsyncStorage.clear();
  for (const [key, value] of Object.entries(options.seed ?? {})) await AsyncStorage.setItem(key, value);
  const reads: string[] = [];
  const original = AsyncStorage.getItem.bind(AsyncStorage);
  AsyncStorage.getItem = jest.fn(async (key: string) => {
    reads.push(key);
    return original(key);
  });
  const i18n = require('@/i18n') as typeof import('@/i18n');
  i18n.setCurrentLanguage('en');
  return { AsyncStorage, reads, i18n };
}
type App = Awaited<ReturnType<typeof boot>>;
const t = (app: App, key: Parameters<App['i18n']['translate']>[1]) => app.i18n.translate('en', key);
const render = (module: string, name = 'default') => {
  const Component = (require(module) as Record<string, () => React.ReactElement>)[name];
  return RNTL.render(ReactTop.createElement(Component));
};
async function snapshot(app: App): Promise<Record<string, string | null>> {
  const keys: string[] = (await app.AsyncStorage.getAllKeys()).sort();
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = await app.AsyncStorage.getItem(k);
  return out;
}

describe('the family-mode flag itself', () => {
  test('is off by default', async () => {
    await boot({ family: false });
    expect((require('@/utils/dev-flags') as typeof import('@/utils/dev-flags')).FAMILY_MODE_ENABLED).toBe(false);
  });

  test('cannot be on in a release build, whatever the environment says', async () => {
    await boot({ family: true, dev: false });
    expect((require('@/utils/dev-flags') as typeof import('@/utils/dev-flags')).FAMILY_MODE_ENABLED).toBe(false);
  });

  test('is on only in a development build with the variable set', async () => {
    await boot({ family: true, dev: true });
    expect((require('@/utils/dev-flags') as typeof import('@/utils/dev-flags')).FAMILY_MODE_ENABLED).toBe(true);
  });
});

describe('direct navigation with family mode off', () => {
  const seed = { [`${P}household`]: HOUSEHOLD, [`${P}onboarding`]: onboarding({ status: 'completed' }) };

  test.each(['@/app/parent', '@/app/parent-security'])('%s goes back to the app and loads nothing of the household set-up', async (route) => {
    const app = await boot({ family: false, seed });
    const view = await render(route);
    await view.findByText('REDIRECT:/');
    expect(mockRedirects).toEqual(['/']);
    expect(loaded).toEqual([]); // neither the gate, the dashboard nor the PIN screens were even loaded
    expect(view.queryByText('DASHBOARD-CONTENT')).toBeNull();
    expect(view.queryByText('SECURITY-CONTENT')).toBeNull();
    expect(app.reads.filter((k) => k === `${P}household`)).toEqual([]); // the household was not even read
  });

  test('a release build with the variable set behaves the same (the address cannot switch the flag on)', async () => {
    await boot({ family: true, dev: false, seed });
    // (called directly, not rendered: a renderer must not be started while the global development switch is off)
    for (const route of ['@/app/parent', '@/app/parent-security']) {
      const element = (require(route) as { default: () => React.ReactElement<{ href?: string }> }).default();
      expect(element.props.href).toBe('/');
    }
    expect(loaded).toEqual([]);
  });

  test('the address is never read: there is nothing to pass in', () => {
    const fs = require('fs');
    for (const file of ['src/app/parent.tsx', 'src/app/parent-security.tsx']) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/useLocalSearchParams|useGlobalSearchParams|useSearchParams/);
    }
  });

  test('saved household and onboarding data is untouched by opening them', async () => {
    const app = await boot({ family: false, seed });
    const before = await snapshot(app);
    for (const route of ['@/app/parent', '@/app/parent-security']) {
      const view = await render(route);
      view.unmount();
    }
    expect(await snapshot(app)).toEqual(before);
  });
});

describe('the same addresses with family mode on', () => {
  test('/parent renders the gate and the dashboard', async () => {
    await boot({ family: true });
    const view = await render('@/app/parent');
    await view.findByText('DASHBOARD-CONTENT');
    expect(mockRedirects).toEqual([]);
    expect(loaded).toEqual(expect.arrayContaining(['gate', 'dashboard']));
  });

  test('/parent-security renders the PIN screen', async () => {
    await boot({ family: true });
    // (the page function is called directly: it returns the PIN screen itself, not a redirect)
    const element = (require('@/app/parent-security') as { default: () => React.ReactElement<{ href?: string }> }).default();
    expect(element.props.href).toBeUndefined();
    expect(loaded).toEqual(['security']);
  });
});

