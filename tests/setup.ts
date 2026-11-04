// Every test file gets an in-memory AsyncStorage; it never touches real saves.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// An in-memory stand-in for native secure storage (expo-secure-store). Its state lives on globalThis so it survives
// jest.resetModules() the way real secure storage survives an app restart; tests clear or change it through
// secureTest() in helpers.ts. It records what was loaded and called so tests can check what the app does with it.
jest.mock('expo-secure-store', () => {
  const g = globalThis as unknown as { __secure?: Record<string, any> };
  const state = (g.__secure ??= {
    map: new Map<string, string>(),
    available: true,
    failGet: false,
    failSet: false,
    failKeys: new Set<string>(),
    loaded: 0,
    sets: [] as { key: string; options: unknown }[],
    deletes: 0,
  });
  state.loaded += 1;
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    isAvailableAsync: async () => state.available,
    getItemAsync: async (key: string) => {
      if (state.failGet) throw new Error('secure store read failed');
      return state.map.has(key) ? state.map.get(key) : null;
    },
    setItemAsync: async (key: string, value: string, options?: unknown) => {
      state.sets.push({ key, options });
      if (state.failSet || state.failKeys.has(key)) throw new Error('secure store write failed');
      state.map.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      state.deletes += 1;
      state.map.delete(key);
    },
  };
});

// Secure random bytes from Node's own generator (the real module asks the phone's operating system).
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (count: number) => new Uint8Array(require('crypto').randomBytes(count)),
}));
