import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ReactNative from 'react-native';



jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
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

// Stage 4.4c: nothing that can read or write private family data runs before the tab owns the family storage. This file checks the
// import-time side effects of every storage module, the order of the root layout, and that a blocked tab touches no storage at all.

const P = '@ProductivityPet:';
const METHODS = ['getItem', 'setItem', 'multiGet', 'multiSet', 'getAllKeys', 'removeItem', 'mergeItem', 'multiRemove', 'clear'] as const;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
const originalOS = ReactNative.Platform.OS;
afterEach(() => {
  (ReactNative.Platform as { OS: string }).OS = originalOS;
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const read = (rel: string) => require('fs').readFileSync(require('path').resolve(rel), 'utf8') as string;

// ---------------------------------------------------------------------------------------------------------
describe('import-time side effects', () => {
  // Every module that can reach private family data. Importing one must not touch storage by itself: work starts only when the
  // application calls it, and in family mode on the web that happens only after the tab owns the storage.
  const MODULES = [
    'profiles',
    'household',
    'onboarding',
    'pet-family',
    'pet-profile',
    'pet-needs',
    'pet-alerts',
    'task-storage',
    'tasks',
    'paw-tokens',
    'token-history',
    'shop-inventory',
    'mood-log',
    'journal',
    'kitty-catch-rewards',
    'memory-match-rewards',
    'pawadise-mail',
    'pawadise-postcards',
    'notifications',
    'parent-gate',
    'parent-pin',
    'parent-auth-backend',
    'family-profiles',
    'family-picker-model',
    'family-session',
    'family-management',
    'idle-session',
    'unfinished-work',
    'web-tab-lock',
    'storage-fence',
    'family-tab',
  ];

  test.each(MODULES)('importing @/utils/%s reads and writes nothing', async (name) => {
    const calls: string[] = [];
    const spies = METHODS.map((method) => jest.spyOn(AsyncStorage, method).mockImplementation((async (...args: unknown[]) => {
      calls.push(`${method}(${String(args[0])})`);
      return null;
    }) as never));
    try {
      jest.isolateModules(() => {
        require(`@/utils/${name}`);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    expect(calls).toEqual([]);
  });

  test('the root layout has exactly three statements that run at import time, and the storage-touching one is skipped in family mode on the web', () => {
    const code = read('src/app/_layout.tsx');
    const topLevel = code
      .split('\n')
      .filter((line) => /^[A-Za-z(]/.test(line) && !/^(import|export|const|let|type|function|async|if \(FAMILY_WEB\) \{)\b/.test(line))
      .map((line) => line.trim());
    expect(topLevel).toEqual([
      'SplashScreen.preventAutoHideAsync();',
      "if (FAMILY_WEB) (require('@/utils/family-tab') as typeof import('@/utils/family-tab')).installFamilyTabProtection();",
      'if (!FAMILY_WEB) void ensureOnboardingLoaded().catch(() => {});',
    ]);
    // the fence goes in before the (guarded) onboarding load
    expect(code.indexOf('installFamilyTabProtection()')).toBeLessThan(code.indexOf('void ensureOnboardingLoaded()'));
    expect(code).toMatch(/const FAMILY_WEB = FAMILY_MODE_ENABLED && Platform\.OS === 'web';/);
  });

  test('every startup operation (onboarding, profiles, parent PIN, reconciliation, parent-gate locking) lives in RootLayoutContent, behind the gate', () => {
    const code = read('src/app/_layout.tsx');
    const content = code.slice(code.indexOf('function RootLayoutContent'));
    const outer = code.slice(code.indexOf('export default function RootLayout()'), code.indexOf('function RootLayoutContent'));
    for (const call of ['ensureOnboardingLoaded()', 'ensureProfilesReady()', 'startParentAuth()', 'reconcileFamilyProfiles()', 'startParentGateAutoLock()']) {
      expect(content).toContain(call);
      expect(outer).not.toContain(call);
    }
    expect(outer).toMatch(/<WebTabGate>\s*<RootLayoutContent gated \/>\s*<\/WebTabGate>/);
    expect(outer).toMatch(/return <RootLayoutContent \/>;/);
    // the onboarding decision is made on the first render after ownership, before any screen can create a first pet
    expect(content).toMatch(/useState\(\(\) => \{\s*if \(gated\) void ensureOnboardingLoaded\(\)/);
  });

  test('nothing else in the app reaches the gate or the lock: only the layout (behind the family-web flag) and the family tab module', () => {
    const fs = require('fs');
    const path = require('path');
    const files = ['src/app', 'src/components', 'src/hooks', 'src/utils'].flatMap((dir) =>
      (fs.readdirSync(path.resolve(dir), { recursive: true }) as string[]).map((f) => `${dir}/${f}`.split('\\').join('/'))
    );
    const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const users = (needle: RegExp) => files.filter((f) => /\.(ts|tsx)$/.test(f) && needle.test(code(f))).sort();
    expect(users(/@\/components\/web-tab-gate/)).toEqual(['src/app/_layout.tsx']);
    expect(users(/@\/utils\/family-tab/)).toEqual(['src/app/_layout.tsx', 'src/components/web-tab-gate.tsx']);
    expect(users(/storage-fence/)).toEqual(['src/utils/family-tab.ts']);
    expect(users(/web-tab-lock/)).toEqual(['src/components/web-tab-gate.tsx', 'src/utils/family-tab.ts']);
    const layout = read('src/app/_layout.tsx');
    expect(layout).not.toMatch(/^import .*(web-tab-gate|family-tab)/m); // only ever required behind the flag
  });
});

// ---------------------------------------------------------------------------------------------------------
// the fence is in before any write

describe('the fence goes in before anything can write', () => {
  async function protectedWorld() {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    jest.resetModules();
    jest.doMock('react-native', () => ReactNative);
    (ReactNative.Platform as { OS: string }).OS = 'web';
    const tab = require('@/utils/family-tab') as typeof import('@/utils/family-tab');
    const real = require('@react-native-async-storage/async-storage');
    const storage = real.default ?? real;
    return { tab, storage };
  }

  test('in family mode on the web the lock exists but owns nothing, and every protected write is refused until it is started and won', async () => {
    const { tab, storage } = await protectedWorld();
    const lock = tab.installFamilyTabProtection();
    expect(lock).not.toBeNull();
    expect(lock!.getSnapshot().status).toBe('checking');
    await expect(storage.setItem(`${P}anything`, '1')).rejects.toThrow('tab-not-owner');
    await storage.setItem('some-library-key', 'fine'); // not ours: untouched
    expect(await storage.getItem(`${P}anything`)).toBeNull();
    expect(tab.installFamilyTabProtection()).toBe(lock); // installing again changes nothing
  });

  test('with the flag off, or off the web, nothing is created or installed and the storage object is untouched', async () => {
    delete process.env.EXPO_PUBLIC_FAMILY_MODE;
    jest.resetModules();
    jest.doMock('react-native', () => ReactNative);
    (ReactNative.Platform as { OS: string }).OS = 'web';
    const off = require('@/utils/family-tab') as typeof import('@/utils/family-tab');
    const storage = (require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage')) as typeof AsyncStorage;
    const methods = [storage.setItem, storage.multiSet, storage.removeItem, storage.clear];
    expect(off.installFamilyTabProtection()).toBeNull();
    expect(off.getFamilyTabLock()).toBeNull();
    expect([storage.setItem, storage.multiSet, storage.removeItem, storage.clear]).toEqual(methods);
    await storage.setItem(`${P}family-off`, 'ok');
    expect(await storage.getItem(`${P}family-off`)).toBe('ok');

    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    jest.resetModules();
    jest.doMock('react-native', () => ReactNative);
    (ReactNative.Platform as { OS: string }).OS = 'ios';
    const phone = require('@/utils/family-tab') as typeof import('@/utils/family-tab');
    expect(phone.installFamilyTabProtection()).toBeNull();
  });

  test('family mode off: the root layout does what it always did (the onboarding load at import, no gate)', () => {
    const code = read('src/app/_layout.tsx');
    expect(code).toMatch(/return <RootLayoutContent \/>;/);
    expect(code).toMatch(/if \(!FAMILY_WEB\) void ensureOnboardingLoaded/);
  });
});
