import type { PetProfile } from '@/utils/pet-profile-model';
import type { PetRecord } from '@/utils/pet-lifecycle-core';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// All times below are real instants. Tests run with TZ=America/Chicago (see
// global-setup.js): in March 2026 daylight saving began on the 8th (CDT, UTC-5).
export const T0 = Date.parse('2026-03-10T15:00:00.000Z'); // 10:00 AM local, awake
export const iso = (ms: number) => new Date(ms).toISOString();
export const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

export const UNITS = 27720;

export function profile(over: Partial<PetProfile> = {}): PetProfile {
  return {
    hunger: 100, cleanliness: 100, happiness: 100, energy: 100, pawTokens: 0,
    adoptionDate: iso(T0 - 60 * DAY), lastUpdatedAt: iso(T0), isSleeping: false, isSick: false,
    poopPiles: [], nextPoopEventAt: '', needsBath: false, paidStageIndex: 0, hatchedAt: '', lastBathCompletedAt: '',
    ...over,
  };
}

// A hatched (non-egg) healthy pet, current as of `at`.
export function pet(over: Partial<PetRecord> & { p?: Partial<PetProfile> } = {}, at = T0): PetRecord {
  const { p, ...rest } = over;
  return {
    id: 'pet-test', name: 'Test', profile: profile({ lastUpdatedAt: iso(at), ...p }),
    growthUnits: 20 * UNITS, tasksCounted: 20,
    lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: iso(at) },
    equipped: { hat: null, bow: null }, events: [], peak: { stageIndex: 1, level: 2 }, createdAt: iso(at - 30 * DAY),
    ...rest,
  };
}

// Lets queued microtasks, storage writes and promise chains finish.
export const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

// Only Date is faked: promises, setImmediate and storage keep working normally.
export function freezeClock(ms: number) {
  jest.useFakeTimers({
    now: ms,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
  });
}
export const setClock = (ms: number) => jest.setSystemTime(ms);
export const unfreezeClock = () => jest.useRealTimers();

// Loads a FRESH copy of the app's modules on top of an in-memory AsyncStorage
// holding `seed` (values are JSON-encoded exactly like real saves). Passing the
// previous run's `dump()` as `keepStorage` simulates closing and reopening the
// app with the same storage.
export async function loadApp(seed?: Record<string, unknown>, keepStorage?: Map<string, string>) {
  jest.resetModules();
  const storageModule = require('@react-native-async-storage/async-storage');
  const AsyncStorage = storageModule.default ?? storageModule;
  await AsyncStorage.clear();
  if (keepStorage) for (const [k, v] of keepStorage) await AsyncStorage.setItem(k, v);
  for (const [k, v] of Object.entries(seed ?? {})) {
    await AsyncStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return {
    AsyncStorage,
    family: require('@/utils/pet-family') as typeof import('@/utils/pet-family'),
    tokens: require('@/utils/paw-tokens') as typeof import('@/utils/paw-tokens'),
    history: require('@/utils/token-history') as typeof import('@/utils/token-history'),
    tasks: require('@/utils/tasks') as typeof import('@/utils/tasks'),
    profiles: require('@/utils/profiles') as typeof import('@/utils/profiles'),
    // Loaded only when a test asks for them (they pull in notifications and the Pawadise art).
    get taskStorage() {
      return require('@/utils/task-storage') as typeof import('@/utils/task-storage');
    },
    get shop() {
      return require('@/utils/shop-inventory') as typeof import('@/utils/shop-inventory');
    },
    get moodLog() {
      return require('@/utils/mood-log') as typeof import('@/utils/mood-log');
    },
    get journal() {
      return require('@/utils/journal') as typeof import('@/utils/journal');
    },
    get postcards() {
      return require('@/utils/pawadise-postcards') as typeof import('@/utils/pawadise-postcards');
    },
    get mail() {
      return require('@/utils/pawadise-mail') as typeof import('@/utils/pawadise-mail');
    },
    get kitty() {
      return require('@/utils/kitty-catch-rewards') as typeof import('@/utils/kitty-catch-rewards');
    },
    get memory() {
      return require('@/utils/memory-match-rewards') as typeof import('@/utils/memory-match-rewards');
    },
    get alerts() {
      return require('@/utils/pet-alerts') as typeof import('@/utils/pet-alerts');
    },
    get pin() {
      return require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
    },
    get gate() {
      return require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
    },
    get onboarding() {
      return require('@/utils/onboarding') as typeof import('@/utils/onboarding');
    },
    get reactNative() {
      return require('react-native') as typeof import('react-native');
    },
    get toySession() {
      return require('@/utils/pet-toy-session') as typeof import('@/utils/pet-toy-session');
    },
    async dump(): Promise<Map<string, string>> {
      const keys: string[] = await AsyncStorage.getAllKeys();
      const out = new Map<string, string>();
      for (const k of keys) out.set(k, (await AsyncStorage.getItem(k)) as string);
      return out;
    },
    async read(key: string) {
      const raw = await AsyncStorage.getItem(`@ProductivityPet:${key}`);
      return raw ? JSON.parse(raw) : null;
    },
  };
}
export type App = Awaited<ReturnType<typeof loadApp>>;

// Deep copy of a saved-data fixture, so a test can never alter the file's data.
// The in-memory stand-in for native secure storage (see tests/setup.ts). It survives jest.resetModules() like real
// secure storage survives an app restart; call resetSecure() to simulate a device that never had a PIN.
export type SecureTestState = {
  map: Map<string, string>;
  available: boolean;
  failGet: boolean;
  failSet: boolean;
  failKeys: Set<string>;
  loaded: number;
  sets: { key: string; options: unknown }[];
  deletes: number;
};
export const secureTest = (): SecureTestState => {
  const g = globalThis as unknown as { __secure?: SecureTestState };
  g.__secure ??= { map: new Map(), available: true, failGet: false, failSet: false, failKeys: new Set(), loaded: 0, sets: [], deletes: 0 };
  return g.__secure;
};
export function resetSecure() {
  const s = secureTest();
  s.map.clear();
  s.available = true;
  s.failGet = false;
  s.failSet = false;
  s.failKeys = new Set();
  s.loaded = 0;
  s.sets = [];
  s.deletes = 0;
}

export const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(JSON.stringify(require(`./fixtures/${name}.json`)));
