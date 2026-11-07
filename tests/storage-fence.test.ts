import * as ReactNative from 'react-native';

import { T0, configurePin, freezeClock, loadApp, resetSecure, unfreezeClock, type App } from './helpers';
import { createBrowserSim, settle } from './tab-sim';

// Stage 4.4b: the storage write fence. A tab that does not hold the family lock cannot change any ProductivityPet key; keys that are
// not ours and every read pass straight through; with family mode off, or off the web, nothing is installed and nothing changes.

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

const P = '@ProductivityPet:';
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
const originalOS = ReactNative.Platform.OS;
beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  (ReactNative.Platform as { OS: string }).OS = originalOS;
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const fence = () => require('@/utils/storage-fence') as typeof import('@/utils/storage-fence');
const toMap = async (storage: { getAllKeys: () => Promise<readonly string[]>; getItem: (k: string) => Promise<string | null> }) => {
  const out = new Map<string, string | null>();
  for (const key of await storage.getAllKeys()) out.set(key, await storage.getItem(key));
  return out;
};

// ---------------------------------------------------------------------------------------------------------
// the fence on a plain storage

function plainStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    multiGet: async (keys: string[]) => keys.map((k) => [k, data.get(k) ?? null]),
    getAllKeys: async () => [...data.keys()],
    setItem: async (k: string, v: string) => void data.set(k, v),
    multiSet: async (pairs: [string, string][]) => void pairs.forEach(([k, v]) => data.set(k, v)),
    mergeItem: async (k: string, v: string) => void data.set(k, v),
    multiMerge: async (pairs: [string, string][]) => void pairs.forEach(([k, v]) => data.set(k, v)),
    removeItem: async (k: string) => void data.delete(k),
    multiRemove: async (keys: string[]) => void keys.forEach((k) => data.delete(k)),
    clear: async () => data.clear(),
  };
}

describe('the fence itself', () => {
  test('without ownership every write to a protected key is refused with TabNotOwnerError, and nothing lands', async () => {
    const { installStorageFence, TabNotOwnerError } = fence();
    const storage = plainStorage();
    storage.data.set(`${P}tasks`, 'old');
    installStorageFence(storage, () => false);
    for (const call of [
      () => storage.setItem(`${P}tasks`, 'new'),
      () => storage.mergeItem(`${P}tasks`, 'new'),
      () => storage.removeItem(`${P}tasks`),
      () => storage.multiSet([[`${P}a`, '1']]),
      () => storage.multiMerge([[`${P}a`, '1']]),
      () => storage.multiRemove([`${P}tasks`]),
      () => storage.clear(),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(TabNotOwnerError);
    }
    expect([...storage.data]).toEqual([[`${P}tasks`, 'old']]);
  });

  test('with ownership every write goes through exactly as before, and ownership is asked at the moment of each call', async () => {
    const { installStorageFence } = fence();
    const storage = plainStorage();
    let owner = true;
    installStorageFence(storage, () => owner);
    await storage.setItem(`${P}x`, '1');
    await storage.multiSet([[`${P}y`, '2']]);
    expect([...storage.data.keys()]).toEqual([`${P}x`, `${P}y`]);
    owner = false; // the lock is gone: from this very call on, nothing lands
    await expect(storage.setItem(`${P}x`, 'changed')).rejects.toThrow('tab-not-owner');
    expect(storage.data.get(`${P}x`)).toBe('1');
    owner = true;
    await storage.setItem(`${P}x`, 'again');
    expect(storage.data.get(`${P}x`)).toBe('again');
  });

  test('a multi-key call with ANY protected key is refused as a whole, so nothing is half written', async () => {
    const { installStorageFence } = fence();
    const storage = plainStorage();
    installStorageFence(storage, () => false);
    await expect(storage.multiSet([['library:a', '1'], [`${P}b`, '2']])).rejects.toThrow();
    await expect(storage.multiRemove(['library:a', `${P}b`])).rejects.toThrow();
    expect(storage.data.size).toBe(0);
  });

  test('keys that are not ours (a library\'s own) and every read are never affected, owner or not', async () => {
    const { installStorageFence } = fence();
    const storage = plainStorage();
    storage.data.set(`${P}secret`, 'private');
    installStorageFence(storage, () => false);
    await storage.setItem('some-library:setting', 'v');
    await storage.multiSet([['other:1', 'a'], ['other:2', 'b']]);
    await storage.removeItem('other:1');
    await storage.mergeItem('other:2', 'c');
    expect(storage.data.get('other:2')).toBe('c');
    expect(storage.data.get('some-library:setting')).toBe('v');
    expect(await storage.getItem(`${P}secret`)).toBe('private'); // reads are not the fence's business (the startup gate keeps a blocked tab from reading)
    expect(await storage.getAllKeys()).toContain(`${P}secret`);
  });

  test('installing again replaces the fence (never stacks), and uninstalling restores the original methods exactly', async () => {
    const { installStorageFence } = fence();
    const storage = plainStorage();
    const originalSet = storage.setItem;
    const first = installStorageFence(storage, () => false);
    const second = installStorageFence(storage, () => true);
    await storage.setItem(`${P}x`, '1'); // the second fence (owner) is the one in force
    expect(storage.data.get(`${P}x`)).toBe('1');
    first(); // an old uninstall handle does nothing to the newer fence
    await storage.setItem(`${P}x`, '2');
    expect(storage.data.get(`${P}x`)).toBe('2');
    second();
    expect(storage.setItem).toBe(originalSet);
  });
});

// ---------------------------------------------------------------------------------------------------------
// the real application storage, with real modules

async function boot(seed: Record<string, string> = {}): Promise<App> {
  delete process.env.EXPO_PUBLIC_FAMILY_MODE; // the writers themselves behave as for any user; only the fence is under test
  resetSecure();
  const app = await loadApp(seed);
  return app;
}

// A battery that touches every kind of protected write the app has: profile and Main data, the registry, the household, onboarding,
// the parent guess counter and the PIN marker. Each is allowed to fail (that is the point); none may throw out of the battery.
async function battery(app: App): Promise<string[]> {
  const results: string[] = [];
  const attempt = async (name: string, run: () => unknown) => {
    try {
      await run();
      results.push(`${name}: done`);
    } catch (error) {
      results.push(`${name}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  };
  await attempt('profiles', async () => {
    await app.profiles.ensureProfilesReady();
    await app.profiles.registerChildProfile('kid-battery');
  });
  await attempt('family', async () => {
    await app.family.ensureFamilyLoaded();
    app.family.addToWallet(5);
    await app.profiles.trackOperation(Promise.resolve());
  });
  await attempt('tasks', async () => {
    app.taskStorage.persistCachedTasks([]);
  });
  await attempt('household', async () => {
    const household = require('@/utils/household') as typeof import('@/utils/household');
    await household.addChild('Battery');
  });
  await attempt('onboarding', async () => {
    await app.onboarding.ensureOnboardingLoaded();
    await app.onboarding.skipOnboarding();
  });
  await attempt('guess counter', async () => {
    app.gate.registerPinVerifier({ isConfigured: async () => true, verify: async () => false });
    await app.gate.unlockParentArea('123456');
  });
  await attempt('PIN marker', async () => {
    const backend = require('@/utils/parent-auth-backend') as typeof import('@/utils/parent-auth-backend');
    await backend.getAuthBackend().markerWrite('x');
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return results;
}

describe('the fence on the real application storage', () => {
  test('without ownership no write of the whole application lands: profile data, registry, household, onboarding, guess counter, PIN marker', async () => {
    const app = await boot();
    const { installStorageFence } = fence();
    const before = await toMap(app.AsyncStorage);
    installStorageFence(app.AsyncStorage, () => false);
    const results = await battery(app);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = await toMap(app.AsyncStorage);
    expect([...after]).toEqual([...before]); // not one key was created, changed or removed
    expect(results).toHaveLength(7);
    expect(results.some((r) => r.includes('done'))).toBe(true); // nothing hung or crashed: failures were reported the normal way
  });

  test('the same battery with ownership writes, only under the protected prefix (so the fence covers every key the app writes)', async () => {
    const app = await boot();
    const { installStorageFence } = fence();
    installStorageFence(app.AsyncStorage, () => true);
    await battery(app);
    const keys = [...(await toMap(app.AsyncStorage)).keys()];
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((key) => !key.startsWith(P))).toEqual([]);
  });

  test('safety copies of unreadable records are fenced too: a blocked tab neither repairs nor copies anything', async () => {
    const app = await boot({
      [`${P}petFamily`]: '{broken',
      [`${P}household`]: '{"version":1,"parent":null,"children":[{"id":"ok","nickname":"A"},"garbage"],"selectedChildId":null}',
      [`${P}profiles`]: '{broken',
    });
    const { installStorageFence } = fence();
    const before = await toMap(app.AsyncStorage);
    installStorageFence(app.AsyncStorage, () => false);
    await battery(app);
    await app.profiles.ensureProfilesReady();
    await app.family.ensureFamilyLoaded().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = await toMap(app.AsyncStorage);
    expect([...after]).toEqual([...before]);
    expect([...after.keys()].filter((k) => k.includes('.corrupt-'))).toEqual([]);
  });

  test('failed writes are reported as unsaved, never as success: the tracked writer says false and the profile switch refuses', async () => {
    const app = await boot();
    await app.profiles.ensureProfilesReady();
    await app.family.ensureFamilyLoaded();
    const { installStorageFence } = fence();
    installStorageFence(app.AsyncStorage, () => false);
    expect(await app.profiles.writeScoped(`${P}p:x:thing`, '1')).toBe(false);
    app.family.addToWallet(3);
    const released = await app.profiles.releaseActiveProfile({ timeoutMs: 500 });
    expect(released).toMatchObject({ ok: false });
  });

  test('registry and household revision checks still work with ownership (the fence changes nothing for an owner)', async () => {
    const app = await boot();
    const { installStorageFence } = fence();
    installStorageFence(app.AsyncStorage, () => true);
    await app.profiles.ensureProfilesReady();
    const household = require('@/utils/household') as typeof import('@/utils/household');
    const first = await household.addChild('Mia');
    const second = await household.addChild('Leo');
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    const registry = JSON.parse((await app.AsyncStorage.getItem(`${P}profiles`))!);
    expect(Array.isArray(registry.profiles)).toBe(true);
    expect(JSON.parse((await app.AsyncStorage.getItem(`${P}household`))!).children).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------
// two tabs, one origin: each tab's storage is fenced by ITS OWN lock

describe('stale-tab writes after ownership loss', () => {
  async function tabs() {
    const { installStorageFence } = fence();
    const { TabLock } = require('@/utils/web-tab-lock') as typeof import('@/utils/web-tab-lock');
    const sim = createBrowserSim();
    const shared = sim.storage;
    const make = (options: Parameters<typeof sim.newTab>[0] = {}, hooks: ConstructorParameters<typeof TabLock>[1] = {}) => {
      const tab = sim.newTab(options);
      const lock = new TabLock(tab.env, hooks);
      // this tab's view of the shared storage, fenced by this tab's lock
      const storage = {
        setItem: async (k: string, v: string) => void shared.set(k, v),
        multiSet: async (pairs: [string, string][]) => void pairs.forEach(([k, v]) => shared.set(k, v)),
        mergeItem: async (k: string, v: string) => void shared.set(k, v),
        multiMerge: async (pairs: [string, string][]) => void pairs.forEach(([k, v]) => shared.set(k, v)),
        removeItem: async (k: string) => void shared.delete(k),
        multiRemove: async (keys: string[]) => void keys.forEach((k) => shared.delete(k)),
        clear: async () => shared.clear(),
      };
      installStorageFence(storage, lock.isOwner);
      return { tab, lock, storage };
    };
    return { sim, shared, make };
  }
  const write = (t: { storage: { setItem: (k: string, v: string) => Promise<unknown> } }, key: string, value: string) =>
    t.storage.setItem(`${P}${key}`, value).then(
      () => true,
      () => false
    );

  test('only the lock owner\'s writes land, whoever is faster', async () => {
    const { shared, make } = await tabs();
    const a = make();
    const b = make();
    await Promise.all([a.lock.start(), b.lock.start()]);
    const owner = a.lock.isOwner() ? a : b;
    const other = owner === a ? b : a;
    const results = await Promise.all([write(other, 'k1', 'other'), write(owner, 'k1', 'owner'), write(other, 'k2', 'other')]);
    expect(results).toEqual([false, true, false]);
    expect(shared.get(`${P}k1`)).toBe('owner');
    expect(shared.has(`${P}k2`)).toBe(false);
  });

  test('after a cooperative handoff the OLD owner is refused immediately and the NEW document\'s writes land', async () => {
    const { sim, shared, make } = await tabs();
    let fresh: ReturnType<typeof make> | null = null;
    const a = make({}, { consent: async () => 'accept' });
    const b = make({
      onReload: (tab) => {
        sim.crash(tab);
        fresh = make();
        void fresh.lock.start();
      },
    });
    await a.lock.start();
    await b.lock.start();
    expect(await write(a, 'x', 'a-1')).toBe(true);
    expect(await write(b, 'x', 'b-blocked')).toBe(false);
    b.lock.requestHandoff();
    await settle(100);
    expect(await write(a, 'x', 'a-stale')).toBe(false); // the old owner: refused
    expect(await write(b, 'x', 'b-stale-doc')).toBe(false); // the old document of the new owner: still refused, it never owns
    expect(await write(fresh!, 'x', 'fresh')).toBe(true);
    expect(shared.get(`${P}x`)).toBe('fresh');
  });

  test('a frozen owner that wakes up after a crash-free handoff cannot write; a lock taken by something else stops its writes too', async () => {
    const { sim, shared, make } = await tabs();
    const a = make();
    await a.lock.start();
    expect(await write(a, 'y', '1')).toBe(true);
    sim.externalSteal('productivitypet-family-storage-owner'); // not this app: something took the lock away
    await settle(20);
    expect(a.lock.getSnapshot().status).toBe('lost');
    expect(await write(a, 'y', '2')).toBe(false);
    expect(shared.get(`${P}y`)).toBe('1');
  });

  test('a frozen owner keeps the lock: the blocked tab still cannot write, and the owner still can when it thaws', async () => {
    const { sim, shared, make } = await tabs();
    const a = make({}, { consent: async () => 'accept' });
    const b = make();
    await a.lock.start();
    await b.lock.start();
    sim.freeze(a.tab);
    b.lock.requestHandoff();
    await settle(80);
    expect(await write(b, 'z', 'b')).toBe(false);
    sim.thaw(a.tab);
    await settle(10);
    expect(shared.has(`${P}z`)).toBe(false);
  });

  test('a crashed owner: the next document that really acquires the lock is the only writer; the dead tab\'s object is not', async () => {
    const { sim, shared, make } = await tabs();
    const a = make();
    const b = make();
    await a.lock.start();
    await b.lock.start();
    expect(await write(a, 'c', 'a')).toBe(true);
    sim.crash(a.tab);
    await settle(20);
    expect(await write(b, 'c', 'b-before-claim')).toBe(false); // knowing the lock is free is not owning it
    const next = make();
    await next.lock.start();
    expect(await write(next, 'c', 'next')).toBe(true);
    expect(shared.get(`${P}c`)).toBe('next');
  });

  test('unsupported environments never allow a write (no Web Locks, insecure context, storage failing)', async () => {
    const { make } = await tabs();
    for (const options of [{ webLocks: false }, { secure: false }, { storage: 'throws' as const }]) {
      const tab = make(options);
      await tab.lock.start();
      expect(await write(tab, 'u', '1')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('family mode off, and everywhere that is not the family web (nothing is installed)', () => {
  test('with the flag off the real AsyncStorage object is left exactly as it was', async () => {
    const app = await boot();
    const before = { set: app.AsyncStorage.setItem, clear: app.AsyncStorage.clear, multiSet: app.AsyncStorage.multiSet };
    jest.resetModules();
    jest.doMock('react-native', () => ReactNative);
    (ReactNative.Platform as { OS: string }).OS = 'web';
    const storage = require('@react-native-async-storage/async-storage');
    const real = storage.default ?? storage;
    const methodsBefore = [real.setItem, real.multiSet, real.removeItem, real.clear];
    const { installFamilyWebStorageFence } = require('@/utils/storage-fence') as typeof import('@/utils/storage-fence');
    expect(installFamilyWebStorageFence(() => false)).toBeNull();
    expect([real.setItem, real.multiSet, real.removeItem, real.clear]).toEqual(methodsBefore);
    expect(before.set).toBeDefined();
    // and every write works for anyone, exactly as before
    await real.setItem(`${P}family-off`, 'ok');
    expect(await real.getItem(`${P}family-off`)).toBe('ok');
  });

  test('family mode on but NOT the web (a phone): still nothing is installed', () => {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    jest.resetModules();
    jest.doMock('react-native', () => ReactNative);
    (ReactNative.Platform as { OS: string }).OS = 'ios';
    const storage = require('@react-native-async-storage/async-storage');
    const real = storage.default ?? storage;
    const setItem = real.setItem;
    const { installFamilyWebStorageFence } = require('@/utils/storage-fence') as typeof import('@/utils/storage-fence');
    expect(installFamilyWebStorageFence(() => false)).toBeNull();
    expect(real.setItem).toBe(setItem);
  });

  test('family mode on AND the web: the real AsyncStorage object is fenced, and the returned function puts it back', async () => {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    jest.resetModules();
    jest.doMock('react-native', () => ReactNative);
    (ReactNative.Platform as { OS: string }).OS = 'web';
    const storage = require('@react-native-async-storage/async-storage');
    const real = storage.default ?? storage;
    const setItem = real.setItem;
    const { installFamilyWebStorageFence, TabNotOwnerError } = require('@/utils/storage-fence') as typeof import('@/utils/storage-fence');
    const uninstall = installFamilyWebStorageFence(() => false);
    expect(uninstall).toBeInstanceOf(Function);
    await expect(real.setItem(`${P}x`, '1')).rejects.toBeInstanceOf(TabNotOwnerError);
    await real.setItem('unrelated-library-key', 'fine');
    expect(await real.getItem('unrelated-library-key')).toBe('fine');
    uninstall!();
    expect(real.setItem).toBe(setItem);
    await real.setItem(`${P}x`, '1');
    expect(await real.getItem(`${P}x`)).toBe('1');
  });

  test('the application reaches the lock and the fence only through the family tab module and the gate (see startup-gating.test.tsx)', () => {
    const fs = require('fs');
    const path = require('path');
    const users = (needle: RegExp) =>
      ['src/app', 'src/components', 'src/hooks', 'src/utils']
        .flatMap((dir) => (fs.readdirSync(path.resolve(dir), { recursive: true }) as string[]).map((f) => `${dir}/${f}`.replace(/[\\]/g, '/')))
        .filter((f) => /\.(ts|tsx)$/.test(f) && !/web-tab-lock\.ts$|storage-fence\.ts$/.test(f))
        .filter((f) => needle.test(fs.readFileSync(path.resolve(f), 'utf8')));
    expect(users(/storage-fence/)).toEqual(['src/utils/family-tab.ts']);
    expect(users(/web-tab-lock/).sort()).toEqual(['src/components/web-tab-gate.tsx', 'src/utils/family-tab.ts']);
  });
});
