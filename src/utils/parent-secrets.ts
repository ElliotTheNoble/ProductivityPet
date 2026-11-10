import { Platform } from 'react-native';

import { errorCodeOf, pinTrace } from '@/utils/pin-trace';

// Native secure storage for the parent's authentication records (Keychain on iOS; Android Keystore-encrypted storage on
// Android), through expo-secure-store. Used instead of AsyncStorage because AsyncStorage is a plain file/database that
// other tools and backups can read.
//
// - expo-secure-store is loaded only when it is needed (never while family mode is off), and a missing native module (an
//   older installed build) is treated as "not available", never as an error.
// - The web has no secure storage: it is always "not available" there (family mode is not supported on the web).
// - Values are kept "when unlocked, this device only": they are not copied to a new device by a backup, and (unlike the
//   passcode-required variant) they do not vanish if the device passcode is removed.
// - Nothing here ever deletes a record. Replacing a record is a single write, so it either fully happens or does not.

type SecureStoreModule = typeof import('expo-secure-store');

function load(): SecureStoreModule | null {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-secure-store') as SecureStoreModule;
  } catch {
    return null;
  }
}

export const RECORD_KEY = 'pp.parentAuth.v1';
export const ATTEMPTS_KEY = 'pp.parentAuth.attempts.v1';

export async function isSecureStorageAvailable(): Promise<boolean> {
  const store = load();
  if (!store) return false;
  try {
    return await store.isAvailableAsync();
  } catch {
    return false;
  }
}

export type SecureRead = { ok: true; value: string | null } | { ok: false };

// ok:false = the storage could not be read (not the same as "nothing there").
export async function readSecret(key: string): Promise<SecureRead> {
  const store = load();
  if (!store) return { ok: false };
  try {
    return { ok: true, value: await store.getItemAsync(key) };
  } catch (error) {
    pinTrace('secure:read-failed', {}, errorCodeOf(error)); // development builds only; the error CODE, never the message or the value
    return { ok: false };
  }
}

export async function writeSecret(key: string, value: string): Promise<boolean> {
  const store = load();
  if (!store) return false;
  try {
    await store.setItemAsync(key, value, { keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    return true;
  } catch (error) {
    pinTrace('secure:write-failed', {}, errorCodeOf(error)); // development builds only; the error CODE, never the message or the value
    return false;
  }
}
