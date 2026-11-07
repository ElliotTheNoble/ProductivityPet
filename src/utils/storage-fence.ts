import { Platform } from 'react-native';

import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';

// The write fence for ProductivityPet storage (web, family mode only; Stage 4.4b). A tab that does not hold the family lock (see
// @/utils/web-tab-lock.ts) must not change ANY ProductivityPet key. Every app module imports the same AsyncStorage object, so the
// fence wraps that one object's mutating methods once, instead of each of the places that write:
//
//   protected: setItem, multiSet, mergeItem, multiMerge, removeItem, multiRemove, clear, for keys that start with '@ProductivityPet:'
//              (profile and Main data, the household, the registry, onboarding, the parent guess counter and PIN marker, and every
//              safety copy). A multi-key call is refused as a whole if ANY key is protected (so nothing is half written). `clear`
//              would delete protected keys, so it is protected too.
//   not touched: reads (the startup gate keeps a blocked tab from reading, see the later stage), and every key that is not ours:
//              a third-party library's own storage keys pass straight through, unchanged.
//
// What the fence is, and is not. The ownership it asks ("does this document hold the Web Lock right now?") is the Web Lock's answer;
// the lock is the exclusive owner. The fence makes the rest of THIS tab's code obey it. It does not make a write atomic across tabs
// and does not try to: a tab only ever owns the lock if no other tab does, and a tab that loses it (a handoff) is refused from that
// moment, before its lock is even let go (see TabLock.handOver). A refused write rejects with TabNotOwnerError, which every existing
// writer already treats as "could not be saved" (a tracked write that failed, never a silent success).
//
// The complete list of places that write, and a static test that fails when a new one appears, is tests/storage-audit.test.ts.

export const PROTECTED_PREFIX = '@ProductivityPet:';

export class TabNotOwnerError extends Error {
  constructor() {
    super('tab-not-owner');
    this.name = 'TabNotOwnerError';
  }
}

// The part of AsyncStorage the fence wraps (kept structural so tests can use any storage with the same shape).
export type FenceableStorage = {
  setItem: (...args: any[]) => Promise<unknown>;
  multiSet: (...args: any[]) => Promise<unknown>;
  mergeItem: (...args: any[]) => Promise<unknown>;
  multiMerge: (...args: any[]) => Promise<unknown>;
  removeItem: (...args: any[]) => Promise<unknown>;
  multiRemove: (...args: any[]) => Promise<unknown>;
  clear: (...args: any[]) => Promise<unknown>;
};

const INSTALLED = new WeakMap<object, { uninstall: () => void }>();

const protectedKey = (key: unknown, prefix: string): boolean => typeof key === 'string' && key.startsWith(prefix);

// Wraps the mutating methods. `isOwner` is asked at the moment of every call. Installing again on the same storage replaces the
// earlier fence (never stacks). Returns the function that puts the original methods back.
export function installStorageFence(storage: FenceableStorage, isOwner: () => boolean, prefix: string = PROTECTED_PREFIX): () => void {
  INSTALLED.get(storage)?.uninstall();
  const originals = {
    setItem: storage.setItem,
    multiSet: storage.multiSet,
    mergeItem: storage.mergeItem,
    multiMerge: storage.multiMerge,
    removeItem: storage.removeItem,
    multiRemove: storage.multiRemove,
    clear: storage.clear,
  };
  const guard = <A extends unknown[]>(original: (...args: A) => Promise<unknown>, touches: (args: A) => boolean) =>
    function fenced(this: unknown, ...args: A): Promise<unknown> {
      if (touches(args) && !isOwner()) return Promise.reject(new TabNotOwnerError());
      return original.apply(storage, args);
    };
  const oneKey = (args: unknown[]) => protectedKey(args[0], prefix);
  const pairs = (args: unknown[]) => Array.isArray(args[0]) && (args[0] as unknown[]).some((pair) => Array.isArray(pair) && protectedKey(pair[0], prefix));
  const keys = (args: unknown[]) => Array.isArray(args[0]) && (args[0] as unknown[]).some((key) => protectedKey(key, prefix));
  storage.setItem = guard(originals.setItem, oneKey);
  storage.mergeItem = guard(originals.mergeItem, oneKey);
  storage.removeItem = guard(originals.removeItem, oneKey);
  storage.multiSet = guard(originals.multiSet, pairs);
  storage.multiMerge = guard(originals.multiMerge, pairs);
  storage.multiRemove = guard(originals.multiRemove, keys);
  storage.clear = guard(originals.clear, () => true); // clearing everything would delete protected keys
  const uninstall = () => {
    if (INSTALLED.get(storage)?.uninstall !== uninstall) return;
    Object.assign(storage, originals);
    INSTALLED.delete(storage);
  };
  INSTALLED.set(storage, { uninstall });
  return uninstall;
}

// The family web fence: installed on the real AsyncStorage only when family mode is on AND this is the web. Everywhere else (every
// real user, release build, phone) it does nothing at all and returns null, and the storage object is left exactly as it was.
export function installFamilyWebStorageFence(isOwner: () => boolean): (() => void) | null {
  if (!FAMILY_MODE_ENABLED || Platform.OS !== 'web') return null;
  const loaded = require('@react-native-async-storage/async-storage') as { default?: FenceableStorage } & Partial<FenceableStorage>;
  const AsyncStorage = (loaded.default ?? loaded) as FenceableStorage | undefined; // the same object every module imports
  if (!AsyncStorage || !('setItem' in AsyncStorage)) return null;
  return installStorageFence(AsyncStorage, isOwner);
}
