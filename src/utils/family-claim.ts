import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { subscribeToActiveProfile } from '@/utils/profiles';

// The "setup claim": permission to START the Parent PIN setup in a household that already has children but no Parent PIN (older or
// development data; a new household has to set the PIN up before it can add a child). Without it anyone holding the device could
// create the PIN first and lock the real parent out of Main and the parent area (BUG-077).
//
// The claim is granted only after the operating system's device security check really succeeded (@/utils/device-auth.ts) and only
// while no PIN exists (an unfinished setup protects nothing). It lives in memory only, ends after ten minutes, when the app goes
// to the background, when the profile changes, when the setup screen is left (so the browser history cannot resume it) and once the
// PIN exists. It is never needed in a household without children, and never in family mode off.
//
// It is single-use: starting the setup (beginPinSetup) spends it, and so does finishing it, so a second setup attempt needs the device
// check again.
//
// It is enforced where the PIN is created (beginPinSetup in @/utils/parent-pin.ts), not only on the screen. It can never be used to
// open anything: an existing PIN is never replaced, reset or bypassed by it.
export const CLAIM_MS = 10 * 60 * 1000;

let claimedAt: number | null = null;
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  listeners.forEach((l) => l());
}

export function hasSetupClaim(now: number = Date.now()): boolean {
  if (claimedAt === null) return false;
  if (now - claimedAt >= CLAIM_MS || now < claimedAt) {
    claimedAt = null; // expired (or the clock went backwards: never extended by changing it)
    return false;
  }
  return true;
}

export function clearSetupClaim(): void {
  const had = claimedAt !== null;
  claimedAt = null;
  stopWatching?.();
  stopWatching = null;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (had) emit();
}

// Grants the claim, after a successful device check. Refuses (and grants nothing) unless family mode is on, this is a phone or tablet
// app, and no Parent PIN exists or should exist (an existing PIN is NEVER replaced or bypassed this way).
export async function grantSetupClaim(): Promise<boolean> {
  if (!FAMILY_MODE_ENABLED || Platform.OS === 'web') return false;
  try {
    const pin = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
    const state = await pin.getAuthState();
    if (state.kind !== 'none') return false;
  } catch {
    return false;
  }
  claimedAt = Date.now();
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => clearSetupClaim(), CLAIM_MS);
  if (!stopWatching) {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') clearSetupClaim();
    });
    const off = subscribeToActiveProfile(() => clearSetupClaim());
    stopWatching = () => {
      sub?.remove();
      off();
    };
  }
  emit();
  return true;
}

// May the PIN setup start right now? A household with no child record at all (and family mode off) needs no claim.
export async function setupClaimSatisfied(): Promise<boolean> {
  if (!FAMILY_MODE_ENABLED) return true;
  try {
    const { householdHasChildren } = require('@/utils/household') as typeof import('@/utils/household');
    if (!(await householdHasChildren())) return true;
  } catch {
    return false; // unknown: not satisfied
  }
  return hasSetupClaim();
}

export function subscribeToSetupClaim(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSetupClaim(): boolean {
  return useSyncExternalStore(subscribeToSetupClaim, () => hasSetupClaim(), () => false);
}
