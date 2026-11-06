import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  isSecureStorageAvailable as nativeSecureAvailable,
  readSecret as nativeReadSecret,
  writeSecret as nativeWriteSecret,
  type SecureRead,
} from '@/utils/parent-secrets';

// Where the parent authentication records live. There are exactly two backends:
//  - 'native' (the only one a real user can ever have): native secure storage for the secret record and the guess counter,
//    AsyncStorage for the small marker (@/utils/parent-pin.ts explains why).
//  - 'dev-preview': plain memory, used ONLY by a development build on the web with the development flag on, so the screens can
//    be looked at in a browser. It is never persisted, never reads or writes AsyncStorage, secure storage or any family data,
//    and a production build can never select it (the flag requires __DEV__). See @/utils/parent-auth-preview.ts.
export type AuthBackend = {
  name: 'native' | 'dev-preview';
  secureAvailable(): Promise<boolean>;
  secureRead(key: string): Promise<SecureRead>;
  secureWrite(key: string, value: string): Promise<boolean>;
  // Throws when the marker cannot be read (that is not the same as "no marker", which is null).
  markerRead(): Promise<string | null>;
  markerWrite(value: string): Promise<boolean>;
};

const MARKER_KEY = '@ProductivityPet:parentAuth';

const nativeBackend: AuthBackend = {
  name: 'native',
  secureAvailable: nativeSecureAvailable,
  secureRead: nativeReadSecret,
  secureWrite: nativeWriteSecret,
  markerRead: () => AsyncStorage.getItem(MARKER_KEY),
  async markerWrite(value) {
    try {
      await AsyncStorage.setItem(MARKER_KEY, value);
      return true;
    } catch {
      return false;
    }
  },
};

let backend: AuthBackend = nativeBackend;

export function getAuthBackend(): AuthBackend {
  return backend;
}

export function setAuthBackend(next: AuthBackend): void {
  backend = next;
}

// Goes back to the real (native) backend. Used by tests and by nothing in the app.
export function selectNativeAuthBackend(): void {
  backend = nativeBackend;
}

// True while the in-memory development preview is the backend (the screens show a banner then).
export function isDevAuthPreview(): boolean {
  return backend.name === 'dev-preview';
}

export const isSecureStorageAvailable = () => backend.secureAvailable();
export const readSecret = (key: string) => backend.secureRead(key);
export const writeSecret = (key: string, value: string) => backend.secureWrite(key, value);
