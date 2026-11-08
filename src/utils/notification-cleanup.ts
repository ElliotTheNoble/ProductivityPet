import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { classifyNotification, isPrivateClass, type NotificationLike } from '@/utils/notification-ownership';

// The private-notification clean-up (Stage 4.5e, family mode only). When a profile is left, or the app starts, the notifications that
// carry a profile's private text (task reminders and detailed pet alerts) must be gone. This does it in a way that can be CHECKED:
//
//   1. list what the phone has scheduled and classify each one (see @/utils/notification-ownership.ts);
//   2. cancel exactly the ones positively identified as private, one by one;
//   3. list again and check that none of them is left;
//   4. do the same for the notification tray (delivered notifications): dismiss the private ones one by one, list again, check.
//
// The result is a state that is never optimistic:
//   verified     everything private is gone AND nothing unknown is left over. The only state that may be called "cleared".
//   unsupported  there is no notification system here (the web, Expo Go on Android): nothing private can exist.
//   unverified   anything else: a list or a cancel failed or timed out, a private notification is still there, or a notification of an
//                unknown kind exists (it is NEVER cancelled or dismissed, so someone has to look at it).
// Nothing here ever cancels "everything", cancels by guessing an id, or dismisses the whole tray: unrelated and family-care
// notifications are left exactly as they are. Every phone call has a deadline, the whole clean-up has a bound, and the function never
// throws. A late answer after the bound can still improve the state if no newer clean-up has started.
//
// Retries (2, 10 and 60 seconds after an unverified result) run only while nobody has a profile open: a retry must never cancel the
// private reminders of the profile that is being used now. Later triggers (the picker opening, the app coming back, entering a profile)
// run it again.

export type CleanupState = 'idle' | 'running' | 'verified' | 'unsupported' | 'unverified';
export type CleanupReason = 'list-failed' | 'cancel-failed' | 'still-scheduled' | 'unknown-notification' | 'tray-failed' | 'tray-remaining' | 'timeout';
export type CleanupSnapshot = { state: CleanupState; reason: CleanupReason | null; remaining: number; unknown: number };

// The parts of expo-notifications used here (and what tests replace).
export type NativeNotifications = {
  getAllScheduledNotificationsAsync(): Promise<NotificationLike[]>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  getPresentedNotificationsAsync(): Promise<{ request: NotificationLike }[]>;
  dismissNotificationAsync(identifier: string): Promise<void>;
};

export const CALL_DEADLINE_MS = 4000;
export const CLEANUP_BOUND_MS = 10_000;
export const RETRY_DELAYS_MS: readonly number[] = [2000, 10_000, 60_000];

type Hooks = {
  api: () => NativeNotifications | null;
  canRun: () => boolean;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

function defaultApi(): NativeNotifications | null {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-notifications') as NativeNotifications;
  } catch {
    return null;
  }
}

// "Nobody has a profile open": the picker is showing (released), or the app just started and nothing was chosen yet.
function defaultCanRun(): boolean {
  try {
    const { isProfileReleased } = require('@/utils/profiles') as typeof import('@/utils/profiles');
    const { hasChosenProfile } = require('@/utils/family-session') as typeof import('@/utils/family-session');
    return isProfileReleased() || !hasChosenProfile();
  } catch {
    return false;
  }
}

const defaultHooks: Hooks = {
  api: defaultApi,
  canRun: defaultCanRun,
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
let hooks: Hooks = defaultHooks;

let snapshot: CleanupSnapshot = { state: 'idle', reason: null, remaining: 0, unknown: 0 };
const listeners = new Set<() => void>();
let generation = 0;
let running: Promise<CleanupSnapshot> | null = null;
let retryHandle: unknown = null;
let retryCount = 0;

function publish(next: CleanupSnapshot): void {
  const same = next.state === snapshot.state && next.reason === snapshot.reason && next.remaining === snapshot.remaining && next.unknown === snapshot.unknown;
  if (same) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function getCleanupSnapshot(): CleanupSnapshot {
  return snapshot;
}
export function subscribeToCleanup(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useCleanupSnapshot(): CleanupSnapshot {
  return useSyncExternalStore(subscribeToCleanup, getCleanupSnapshot, getCleanupSnapshot);
}

// ---------------------------------------------------------------------------------------------------------
// the clean-up itself

function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('deadline')), ms);
  });
  return Promise.race([work, late]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// "There is no notification system here" is recognised ONLY from two confirmed signs: the descriptive error Expo Go on Android gives (it
// names "Expo Go"), and the exact module-unavailable error code (`ERR_UNAVAILABLE`, set by expo's UnavailabilityError) on the error itself.
// Wording alone ("isn't available", "not available on this device"...) proves nothing: a real, passing native failure can say that, and
// then the clean-up must be unverified, not unsupported. Anything else is a failure.
function looksUnsupported(error: unknown): boolean {
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'ERR_UNAVAILABLE') return true;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /\bexpo go\b/i.test(message);
}

type Outcome = { state: 'verified' | 'unsupported' | 'unverified'; reason: CleanupReason | null; remaining: number; unknown: number };
const unverified = (reason: CleanupReason, remaining = 0, unknown = 0): Outcome => ({ state: 'unverified', reason, remaining, unknown });
// A guarded run gave up because a profile opened while it was waiting for the phone: it cancelled nothing more and verified nothing.
const ABANDONED = Symbol('abandoned');

// `guard` is given to the runs that nobody is waiting for (retries, the app coming back, entering a profile). They list the phone, and the
// phone may answer late: by then a profile may have opened and scheduled its own reminders, which the list would then contain. So they
// ask again, right after every list and before cancelling or dismissing anything, whether nobody has a profile open, and give up if
// somebody does. The runs started by a leave or by the app starting are not guarded: the next profile waits for them (see
// whenProfileCleanupDone), so they cannot overlap with its reminders.
async function cleanOnce(api: NativeNotifications, guard: (() => boolean) | null): Promise<Outcome | typeof ABANDONED> {
  const call = <T,>(work: Promise<T>) => deadline(work, CALL_DEADLINE_MS);

  let scheduled: NotificationLike[];
  try {
    scheduled = await call(api.getAllScheduledNotificationsAsync());
  } catch (error) {
    return looksUnsupported(error) ? { state: 'unsupported', reason: null, remaining: 0, unknown: 0 } : unverified('list-failed');
  }

  if (guard && !guard()) return ABANDONED;
  const targets = scheduled.filter((item) => isPrivateClass(classifyNotification(item)));
  const outcomes = await Promise.allSettled(targets.map((item) => call(api.cancelScheduledNotificationAsync(String(item.identifier)))));
  const cancelFailed = outcomes.some((outcome) => outcome.status === 'rejected');

  let after: NotificationLike[];
  try {
    after = await call(api.getAllScheduledNotificationsAsync());
  } catch {
    return unverified('list-failed');
  }
  const classes = after.map((item) => classifyNotification(item));
  const remaining = classes.filter((kind) => isPrivateClass(kind)).length;
  let unknown = classes.filter((kind) => kind === 'unknown').length;

  // The tray: delivered notifications that are still showing.
  let trayProblem: CleanupReason | null = null;
  let trayRemaining = 0;
  try {
    const presented = await call(api.getPresentedNotificationsAsync());
    if (guard && !guard()) return ABANDONED;
    const trayTargets = presented.filter((item) => isPrivateClass(classifyNotification(item.request)));
    await Promise.allSettled(trayTargets.map((item) => call(api.dismissNotificationAsync(String(item.request.identifier)))));
    const left = await call(api.getPresentedNotificationsAsync());
    const leftClasses = left.map((item) => classifyNotification(item.request));
    trayRemaining = leftClasses.filter((kind) => isPrivateClass(kind)).length;
    unknown += leftClasses.filter((kind) => kind === 'unknown').length;
  } catch (error) {
    if (!looksUnsupported(error)) trayProblem = 'tray-failed';
  }

  if (remaining > 0) return unverified(cancelFailed ? 'cancel-failed' : 'still-scheduled', remaining + trayRemaining, unknown);
  if (trayProblem) return unverified(trayProblem, trayRemaining, unknown);
  if (trayRemaining > 0) return unverified('tray-remaining', trayRemaining, unknown);
  if (unknown > 0) return unverified('unknown-notification', 0, unknown);
  return { state: 'verified', reason: null, remaining: 0, unknown: 0 };
}

function stopRetry(): void {
  if (retryHandle !== null) hooks.clearTimer(retryHandle);
  retryHandle = null;
}

function armRetry(): void {
  stopRetry();
  if (retryCount >= RETRY_DELAYS_MS.length) return; // the later triggers take over
  const delay = RETRY_DELAYS_MS[retryCount];
  retryCount += 1;
  retryHandle = hooks.setTimer(() => {
    retryHandle = null;
    if (!hooks.canRun()) return; // somebody has a profile open: a retry could cancel THEIR reminders
    void cleanPrivateNotifications({ fromRetry: true, guarded: true });
  }, delay);
}

// Cleans up. Never throws. A request made while a clean-up is already running does NOT simply join it (that run listed the phone before
// the request, so it cannot vouch for what was scheduled since, for example by the profile that was just left): exactly one more run is
// queued behind it and every such request gets that one. A GUARDED request (a retry, the app coming back, entering a profile) joins the run
// in progress instead, and its own run gives up if a profile opens while it waits for the phone (see cleanOnce). A gave-up run puts the
// state back as it was: it never counts as verified.
let queued: Promise<CleanupSnapshot> | null = null;
export function cleanPrivateNotifications(options: { fromRetry?: boolean; guarded?: boolean } = {}): Promise<CleanupSnapshot> {
  if (running) {
    if (options.fromRetry || options.guarded) return running;
    if (!queued) {
      queued = running.then(() => {
        queued = null;
        return startCleanup({});
      });
    }
    return queued;
  }
  return startCleanup(options);
}

function startCleanup(options: { fromRetry?: boolean; guarded?: boolean }): Promise<CleanupSnapshot> {
  if (!options.fromRetry) retryCount = 0;
  const guard = options.guarded || options.fromRetry ? () => hooks.canRun() : null;
  const before: CleanupSnapshot = snapshot.state === 'running' ? { state: 'unverified', reason: null, remaining: 0, unknown: 0 } : snapshot;
  const api = hooks.api();
  if (!api) {
    publish({ state: 'unsupported', reason: null, remaining: 0, unknown: 0 });
    return Promise.resolve(snapshot);
  }
  stopRetry();
  const mine = ++generation;
  publish({ state: 'running', reason: null, remaining: snapshot.remaining, unknown: snapshot.unknown });

  const work = cleanOnce(api, guard).catch((): Outcome => unverified('list-failed'));
  const apply = (outcome: Outcome | typeof ABANDONED) => {
    if (mine !== generation) return; // a newer clean-up has started: its answer is the one that counts
    if (outcome === ABANDONED) {
      publish(before); // a profile opened meanwhile: nothing was cancelled or checked, so nothing new is claimed
      return;
    }
    publish({ state: outcome.state, reason: outcome.reason, remaining: outcome.remaining, unknown: outcome.unknown });
    if (outcome.state === 'unverified') armRetry();
    else {
      retryCount = 0;
      stopRetry();
    }
  };
  let bound: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Outcome | typeof ABANDONED>((resolve) => {
    bound = setTimeout(() => resolve(unverified('timeout')), CLEANUP_BOUND_MS);
  });
  const finished = Promise.race([work, timedOut]).then((outcome) => {
    if (bound) clearTimeout(bound);
    apply(outcome);
    return snapshot;
  });
  // A late answer (after the bound) may still improve the state.
  void work.then((outcome) => {
    if (snapshot.state === 'unverified' && snapshot.reason === 'timeout') apply(outcome);
  });
  running = finished.finally(() => {
    running = null;
  });
  return running;
}

// Retries a clean-up that is still unverified, if nobody has a profile open (the picker opened, the app came back, a profile is about
// to be entered). Does nothing when the state is fine.
export function retryCleanupIfNeeded(): Promise<CleanupSnapshot> {
  if (snapshot.state !== 'unverified' && snapshot.state !== 'idle') return Promise.resolve(snapshot);
  if (!hooks.canRun()) return Promise.resolve(snapshot);
  return cleanPrivateNotifications({ guarded: true });
}

// Resolves when the clean-up that is running (and the one queued behind it) has finished; at once when none is. Never rejects.
export function whenCleanupSettled(): Promise<void> {
  const work = queued ?? running;
  return work ? work.then(() => undefined, () => undefined) : Promise.resolve();
}

// For tests: swap the phone, the "nobody has a profile open" rule and the timers; reset everything.
export function configureCleanupForTests(overrides: Partial<Hooks> | null): void {
  stopRetry();
  hooks = overrides ? { ...defaultHooks, ...overrides } : defaultHooks;
  snapshot = { state: 'idle', reason: null, remaining: 0, unknown: 0 };
  generation += 1;
  running = null;
  queued = null;
  retryCount = 0;
  listeners.clear();
}
