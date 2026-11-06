import { useSyncExternalStore } from 'react';

import { lockParentArea } from '@/utils/parent-gate';
import { releaseActiveProfile, type ReleaseResult } from '@/utils/profiles';

// Whether someone has chosen a profile on the family picker in THIS run of the app (family mode only). Memory only: it is never saved,
// so every cold start begins at the picker, whatever profile was used last (the profile registry's "active profile" is only a
// last-used pointer, see @/utils/profiles.ts). While no profile is chosen the app shell is not mounted, so no game store loads, no
// pet catch-up runs and nothing is scheduled for anybody.
//
// `pendingRoute` is where the app opens once a profile has been chosen (set only by the picker's parent-only "Add a child" entry,
// which first needs the parent PIN, and then leads to the existing protected parent dashboard; the route is still guarded by the
// Parent Gate itself). It is never read from an address.

let chosen = false;
let pendingRoute: '/parent' | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function hasChosenProfile(): boolean {
  return chosen;
}

export function markProfileChosen(options: { then?: '/parent' } = {}): void {
  pendingRoute = options.then ?? null;
  chosen = true;
  emit();
}

// The one-time route to open after the profile was chosen (null for none). Reading it clears it.
export function consumePendingRoute(): '/parent' | null {
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

// Back to the picker: the active profile is released FIRST (pending saves finish, every store lets go, notifications of the
// profile being left are cleared, the parent area locks); only when that has really happened does the picker take over. If the
// release fails nothing changes and the person stays in their profile. (A visible way to call this comes later; tests use it now.)
export async function returnToPicker(): Promise<ReleaseResult> {
  const result = await releaseActiveProfile();
  if (result.ok) {
    lockParentArea(); // the release already locks it through the profile listeners; this does not depend on them
    pendingRoute = null;
    chosen = false;
    emit();
  }
  return result;
}

// For tests.
export function resetFamilySession(): void {
  chosen = false;
  pendingRoute = null;
  emit();
}
