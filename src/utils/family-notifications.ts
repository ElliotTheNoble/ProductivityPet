import { AppState, Platform } from 'react-native';

import { subscribeToLanguage } from '@/i18n';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { syncFamilyCare } from '@/utils/family-care';
import { ensureNotificationHandler } from '@/utils/notifications';
import { cleanPrivateNotifications, retryCleanupIfNeeded, subscribeToCleanup, getCleanupSnapshot, whenCleanupSettled } from '@/utils/notification-cleanup';
import { trackCleanup } from '@/utils/profiles';

// Connects the notification pieces to the life of the app (Stage 4.5e, family mode only, native only). It is started once, from the
// root layout, before any profile is chosen:
//
//   cold start    the private notifications left on the phone by an earlier run (a profile that was never left properly, the app having
//                 been closed by the system) are cleaned up and verified FIRST, and everything that schedules waits for it (it is
//                 registered with the profile layer like a swap's clean-up). JavaScript cannot run while the app is closed, so
//                 this is the earliest moment there is; a notification that fires before it is out of reach (see BUG-072).
//   afterwards    the family-care reminders are recomputed when: the picker or a profile appears or goes (the family session changes),
//                 the app comes back to the foreground, the children change (add, rename, archive, restore), a profile's alert setting
//                 changes, the language changes, or the clean-up becomes verified. Requests are collected for half a second and made
//                 one at a time (see syncFamilyCare).
//
// Nothing here handles a notification TAP: there is no listener, a tap only opens or brings forward the app, which shows the picker on
// a cold start and otherwise leaves things as they were (the idle rule and the Parent Gate lock work as for any return to the app).

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

export function scheduleFamilyCareSync(): void {
  if (!FAMILY_MODE_ENABLED || Platform.OS === 'web') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncFamilyCare();
  }, DEBOUNCE_MS);
}

export function startFamilyNotifications(): void {
  if (started || !FAMILY_MODE_ENABLED || Platform.OS === 'web') return;
  started = true;
  ensureNotificationHandler();

  // 1. cold start: clean up first, and make everything else wait for it
  trackCleanup(cleanPrivateNotifications());

  // 2. keep the family-care reminders current
  const { subscribeToFamilySession } = require('@/utils/family-session') as typeof import('@/utils/family-session');
  subscribeToFamilySession(scheduleFamilyCareSync);
  subscribeToLanguage(scheduleFamilyCareSync);
  subscribeToCleanup(() => {
    const state = getCleanupSnapshot().state;
    if (state === 'verified' || state === 'unsupported') scheduleFamilyCareSync();
  });
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    void retryCleanupIfNeeded(); // does nothing unless the clean-up is unverified and nobody has a profile open
    scheduleFamilyCareSync();
  });
  try {
    (require('@/utils/household') as typeof import('@/utils/household')).subscribeToHousehold(scheduleFamilyCareSync);
    (require('@/utils/pet-alerts') as typeof import('@/utils/pet-alerts')).subscribeToAlertSettings(scheduleFamilyCareSync);
  } catch {
    // a module that could not load: the other triggers still work
  }
  scheduleFamilyCareSync();
}

// Called right before a profile is entered from the picker (nobody has a profile open yet, so this cannot touch anyone's reminders):
// a clean-up that is running is waited for, and if the last one is not verified a guarded retry is made, all for at most three seconds,
// so the profile being entered never starts next to stale private reminders when that can be avoided. It never blocks the entry: if the
// clean-up still cannot be verified the state stays "unverified" and the parent is told on the dashboard.
export const ENTRY_WAIT_MS = 3000;
export async function prepareForProfileEntry(): Promise<void> {
  if (!FAMILY_MODE_ENABLED || Platform.OS === 'web') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A clean-up that is already running is waited for (so entering a profile never overlaps one); otherwise a guarded retry is made.
    // Either way for at most three seconds: a phone that does not answer must not hold up the entry.
    const work = getCleanupSnapshot().state === 'running' ? whenCleanupSettled() : retryCleanupIfNeeded().then(() => undefined);
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ENTRY_WAIT_MS);
      }),
    ]);
  } catch {
    // never blocks
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// For tests.
export function resetFamilyNotificationsForTests(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
