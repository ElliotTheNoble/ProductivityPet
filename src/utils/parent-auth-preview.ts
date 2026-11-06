import type { AuthBackend } from '@/utils/parent-auth-backend';

// The development-only, non-persistent backend for looking at the Parent PIN screens in a browser. Everything lives in
// variables inside this one object: reloading the page throws it all away. It cannot touch real data: it imports no storage
// module at all (no AsyncStorage, no secure storage), so a PIN made here protects nothing real and no family data can be read
// or changed through it. It is only ever installed by startParentAuth() when the development flag is on, the platform is
// the web and __DEV__ is true (see @/utils/dev-flags.ts).
export function createPreviewBackend(): AuthBackend {
  const secure = new Map<string, string>();
  let marker: string | null = null;
  return {
    name: 'dev-preview',
    secureAvailable: async () => true,
    secureRead: async (key) => ({ ok: true, value: secure.has(key) ? (secure.get(key) as string) : null }),
    secureWrite: async (key, value) => {
      secure.set(key, value);
      return true;
    },
    markerRead: async () => marker,
    markerWrite: async (value) => {
      marker = value;
      return true;
    },
  };
}
