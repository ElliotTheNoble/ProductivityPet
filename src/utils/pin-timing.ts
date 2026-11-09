import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';

// TEMPORARY, development only: how long a Parent PIN check takes on this phone. It exists to decide whether the key-derivation
// cost (scrypt, see @/utils/kdf-params.ts) is what makes a PIN check slow. It records ONLY durations and the scrypt N setting:
// never a PIN, a recovery code, a salt, a hash or anything else about the secret, and it logs nothing. It records and shows
// nothing unless this is a development build (`__DEV__`) with family mode on; a release build never records or renders it.
// Remove this file, `dev-pin-timing.tsx` and their three call sites when the measurement has been taken (see FEATURE-104).

export type PinTiming = { totalMs: number | null; deriveMs: number | null; n: number | null; checks: number };

let last: PinTiming = { totalMs: null, deriveMs: null, n: null, checks: 0 };
const listeners = new Set<() => void>();

export const pinTimingEnabled = (): boolean => __DEV__ && FAMILY_MODE_ENABLED;

function publish(next: PinTiming) {
  last = next;
  listeners.forEach((listener) => listener());
}

// The scrypt step alone (called from @/utils/pin-crypto.ts).
export function recordDeriveTime(ms: number, n: number): void {
  if (!pinTimingEnabled()) return;
  publish({ ...last, deriveMs: Math.round(ms), n });
}

// The whole check as the person waits for it, from pressing Unlock to the answer (called from the unlock screens).
export function recordCheckTime(ms: number): void {
  if (!pinTimingEnabled()) return;
  publish({ ...last, totalMs: Math.round(ms), checks: last.checks + 1 });
}

export function getPinTiming(): PinTiming {
  return last;
}

export function subscribeToPinTiming(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// For tests.
export function resetPinTimingForTests(): void {
  last = { totalMs: null, deriveMs: null, n: null, checks: 0 };
  listeners.clear();
}
