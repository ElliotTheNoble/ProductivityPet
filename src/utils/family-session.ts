import { useSyncExternalStore } from 'react';

import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { lockParentArea } from '@/utils/parent-gate';
import { releaseActiveProfile, whenProfileCleanupDone, type ReleaseResult } from '@/utils/profiles';

// Whether someone has chosen a profile on the family picker in THIS run of the app (family mode only). Memory only: it is never saved,
// so every cold start begins at the picker, whatever profile was used last (the profile registry's "active profile" is only a
// last-used pointer, see @/utils/profiles.ts). While no profile is chosen the app shell is not mounted, so no game store loads, no
// pet catch-up runs and nothing is scheduled for anybody.
//
// `pendingRoute` is where the app opens once a profile has been chosen (set by the picker's parent-only "Add a child" entry, which
// first needs the parent PIN, and then leads to the existing protected parent dashboard; the route is still guarded by the Parent
// Gate itself). After someone LEFT a profile it is '/', so the next person never lands on the screen the previous one was using
// (the address outlives the app shell). It is never read from an address.

let chosen = false;
let pendingRoute: '/parent' | '/' | null = null;
// True after a profile was left: the next profile chosen starts on the home screen.
let routeResetNeeded = false;
// True while a profile is being left (see leaveProfile). The gate covers the app with a neutral screen for that time.
let leaving = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function hasChosenProfile(): boolean {
  return chosen;
}

export function markProfileChosen(options: { then?: '/parent' } = {}): void {
  pendingRoute = options.then ?? (routeResetNeeded ? '/' : null);
  routeResetNeeded = false;
  chosen = true;
  emit();
}

// The one-time route to open after the profile was chosen (null for none). Reading it clears it.
export function consumePendingRoute(): '/parent' | '/' | null {
  const route = pendingRoute;
  pendingRoute = null;
  return route;
}

export function subscribeToFamilySession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProfileChosen(): boolean {
  return useSyncExternalStore(subscribeToFamilySession, hasChosenProfile, hasChosenProfile);
}

export function isLeavingProfile(): boolean {
  return leaving;
}

export function useLeavingProfile(): boolean {
  return useSyncExternalStore(subscribeToFamilySession, isLeavingProfile, isLeavingProfile);
}

// Why a profile could not be left (the same reasons as releasing it), plus 'not-available' when family mode is off (there is no
// picker to go back to, and nothing is touched).
// What is known about the private notifications (task reminders, detailed pet alerts) of the profile that was left, when the leave
// answers: 'verified' = listed, cancelled and listed again, none left; 'unsupported' = this device has no notification system;
// 'unverified' = it could not be confirmed (a phone call failed or timed out, something private is still there, or a notification of
// an unknown kind exists), so NOTHING may be claimed about them; a parent is told on the dashboard and the clean-up is retried.
// The data of the profile was released safely either way (that is what `ok` says), and the answer waits for the clean-up for at most
// ten seconds. Absent when family mode is off or the leave failed.
export type NotificationCleanup = 'verified' | 'unsupported' | 'unverified';
export type LeaveResult =
  | { ok: true; changed: boolean; notificationCleanup?: NotificationCleanup }
  | Extract<ReleaseResult, { ok: false }>
  | { ok: false; reason: 'not-available'; keys?: undefined };

let inFlight: Promise<LeaveResult> | null = null;

// THE way back to the "Who's playing today?" picker, for a person tapping the switch button and (later) for the inactivity rule. In
// this order:
//   1. `leaving` is raised, so the gate covers the app with a neutral screen at once: nothing of the profile can be tapped or read
//      while it is being saved, and no emptied screen can be seen in the moment after the stores let go;
//   2. the parent area is locked BEFORE anything that can fail, so a release that fails (or hangs) can never leave a parent session
//      open behind it. A parent who was working loses the session and has to enter the PIN again, the safe direction;
//   3. the active profile is released (see releaseActiveProfile in @/utils/profiles.ts): pending saves finish (one that cannot be
//      saved cancels the whole thing), every store lets go, and the private notifications of the profile are cleaned up and CHECKED (see
//      @/utils/notification-cleanup.ts); the answer says whether that was verified, it never assumes so;
//   4. only after that has really happened does the picker take over, and the next profile starts on the home screen.
// If the release fails, nothing changes: the person stays in their profile with every saved and unsaved value as it was, the cover
// goes away, and the failure is returned for the screen to explain (never reported as a success). Only one leave runs at a time:
// a second request while one is running gets the same answer.
export function leaveProfile(options: { timeoutMs?: number } = {}): Promise<LeaveResult> {
  if (!FAMILY_MODE_ENABLED) return Promise.resolve({ ok: false, reason: 'not-available' });
  if (inFlight) return inFlight;
  inFlight = doLeave(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doLeave(options: { timeoutMs?: number }): Promise<LeaveResult> {
  leaving = true;
  emit();
  let result: ReleaseResult;
  try {
    lockParentArea();
    result = await releaseActiveProfile(options);
  } catch {
    result = { ok: false, reason: 'storage' };
  }
  if (result.ok) {
    lockParentArea(); // the release already locks it through the profile listeners; this does not depend on them
    pendingRoute = null;
    routeResetNeeded = true;
    chosen = false;
  }
  leaving = false;
  emit();
  if (!result.ok) return result;
  // The picker is already showing; now wait (bounded) for the clean-up of the private notifications and report what is KNOWN.
  await whenProfileCleanupDone();
  const state = (require('@/utils/notification-cleanup') as typeof import('@/utils/notification-cleanup')).getCleanupSnapshot().state;
  const notificationCleanup: NotificationCleanup = state === 'verified' ? 'verified' : state === 'unsupported' ? 'unsupported' : 'unverified';
  return { ...result, notificationCleanup };
}

// Kept for the tests and earlier callers: the same as leaveProfile.
export const returnToPicker = leaveProfile;

// For tests.
export function resetFamilySession(): void {
  chosen = false;
  pendingRoute = null;
  routeResetNeeded = false;
  leaving = false;
  inFlight = null;
  emit();
}
