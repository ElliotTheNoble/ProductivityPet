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

describe('the Pet Care "Family" card', () => {
  const seed = { [`${P}household`]: HOUSEHOLD, [`${P}onboarding`]: onboarding({ status: 'completed' }) };

  test('is not shown with family mode off, and reads no household or onboarding data', async () => {
    const app = await boot({ family: false, seed });
    const view = await render('@/components/family-mode-card', 'FamilyModeCard');
    expect(view.toJSON()).toBeNull();
    expect(app.reads.filter((k) => k === `${P}household` || k === `${P}onboarding`)).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  test('is shown with family mode on', async () => {
    const app = await boot({ family: true, seed });
    const view = await render('@/components/family-mode-card', 'FamilyModeCard');
    await view.findByText(t(app, 'familyModeTitle'));
  });
});

describe('the first-run welcome flow (/welcome)', () => {
  test('with family mode off it is only the language choice, even if an older run saved a later step', async () => {
    const app = await boot({ family: false, seed: { [`${P}household`]: HOUSEHOLD, [`${P}onboarding`]: onboarding() } });
    const view = await render('@/components/welcome-screen', 'WelcomeScreen');
    await view.findByText(t(app, 'welcomeLanguageTitle'));
    expect(view.queryByText(t(app, 'parentSetupTitle'))).toBeNull();
    expect(view.queryByText(t(app, 'modeTitle'))).toBeNull();
    expect(view.queryByRole('button', { name: t(app, 'finishSetup') })).toBeNull();
    expect(view.queryByLabelText(t(app, 'parentNameLabel'))).toBeNull();
  });

  test('Continue and Skip for now both finish the flow and go to the app, changing no household data', async () => {
    for (const label of ['continue', 'skipForNow'] as const) {
      const seed = { [`${P}household`]: HOUSEHOLD, [`${P}onboarding`]: onboarding({ step: 'language', mode: null }) };
      const app = await boot({ family: false, seed });
      const before = await snapshot(app);
      const view = await render('@/components/welcome-screen', 'WelcomeScreen');
      await view.findByText(t(app, 'welcomeLanguageTitle'));
      await RNTL.fireEvent.press(view.getByRole('button', { name: t(app, label) }));
      await RNTL.waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(label === 'skipForNow' ? '/' : '/'));
      const after = await snapshot(app);
      expect(JSON.parse(after[`${P}onboarding`] as string).status).toBe('skipped');
      expect(after[`${P}household`]).toBe(before[`${P}household`]);
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      view.unmount();
    }
  });

  test('the language choice still works and is kept (a brand-new install can pick Spanish)', async () => {
    const app = await boot({ family: false, seed: { [`${P}onboarding`]: onboarding({ step: 'language', mode: null }) } });
    const view = await render('@/components/welcome-screen', 'WelcomeScreen');
    await view.findByText(t(app, 'welcomeLanguageTitle'));
    await RNTL.fireEvent.press(view.getByText('Español'));
    await RNTL.waitFor(async () => expect(JSON.parse((await app.AsyncStorage.getItem(`${P}onboarding`)) as string).language).toBe('es'));
  });

  test('with family mode on the later steps are still there', async () => {
    const app = await boot({ family: true, seed: { [`${P}onboarding`]: onboarding() } });
    const view = await render('@/components/welcome-screen', 'WelcomeScreen');
    await view.findByText(t(app, 'parentSetupTitle'));
    expect(view.getByRole('button', { name: t(app, 'finishSetup') })).toBeTruthy();
  });

  test('is still rendered only inside the Parent Gate', () => {
    expect(require('fs').readFileSync('src/app/welcome.tsx', 'utf8')).toMatch(/<ParentGate>[\s\S]*<WelcomeScreen \/>[\s\S]*<\/ParentGate>/);
  });
});

describe('the "Skip for now" touch target', () => {
  const heights = (node: { props: { style?: unknown }; parent: unknown }): number[] => {
    const found: number[] = [];
    let cursor = node as { props: { style?: unknown }; parent: unknown } | null;
    while (cursor) {
      const flat = ReactNative.StyleSheet.flatten(cursor.props.style as never) as { minHeight?: number } | undefined;
      if (flat && typeof flat.minHeight === 'number') found.push(flat.minHeight);
      cursor = cursor.parent as typeof cursor;
    }
    return found;
  };

  test.each([false, true])('is at least 44 high (family mode %s)', async (family) => {
    const app = await boot({ family, seed: { [`${P}onboarding`]: onboarding({ step: 'language', mode: null }) } });
    const view = await render('@/components/welcome-screen', 'WelcomeScreen');
    await view.findByText(t(app, 'skipForNow'));
    const found = heights(view.getByText(t(app, 'skipForNow')) as never);
    expect(found.length).toBeGreaterThan(0);
    expect(Math.max(...found)).toBeGreaterThanOrEqual(44);
  });

  test('no family button style is smaller than 44 high', () => {
    const text = require('fs').readFileSync('src/components/family-ui.tsx', 'utf8') as string;
    for (const match of text.matchAll(/(button\w*): \{ minHeight: (\d+)/g)) expect([match[1], Number(match[2]) >= 44]).toEqual([match[1], true]);
  });
});
