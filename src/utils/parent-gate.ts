import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { subscribeToActiveProfile } from '@/utils/profiles';

// Parent Gate (M2 Stage 2A-0): the access barrier in front of the parent-only areas (the Parent Dashboard and the
// onboarding / family set-up flow). It decides whether the parent area is OPEN, LOCKED or in a COOLDOWN, limits wrong
// guesses (also across app restarts), and locks again when the app goes to the background, when the profile changes
// and after a period without use.
//
// WHAT THIS IS, AND IS NOT. It is a temporary access barrier that keeps children out of the parent area by normal
// navigation on a shared device. It is NOT verified parental identity and NOT full security: it cannot tell who is
// holding the device, the attempt limits depend on the device clock and on data stored on the device, and nothing here
// can protect against someone who can read or change the app's storage. Never describe it as secure to a user.
//
// THE PIN ITSELF IS NOT STORED HERE. Checking a PIN is delegated to a PinVerifier (see @/utils/parent-pin.ts, which
// keeps it in native secure storage). A verifier is only registered when family mode is enabled (FAMILY_MODE_ENABLED in
// @/utils/dev-flags.ts, off by default). With no verifier registered no PIN can exist, the parent area is
// "unprotected" exactly as it always was, and nothing changes for any user.

// Why a PIN that should exist cannot be used. 'verifier-missing': family data says a PIN protects it but the secret
// record is gone or damaged (a restore, a new device). The area then stays LOCKED, nothing is reset, and nothing can
// create a new PIN here; only guardian-account recovery (not built yet) will be able to.
export type ParentAuthIssue = 'verifier-missing';

export type PinVerifier = {
  // True when a PIN has been set up (or should exist) on this device.
  isConfigured(): Promise<boolean>;
  // Checks a PIN. Must never throw for a wrong PIN (return false) and must never reveal or log the PIN.
  verify(pin: string): Promise<boolean>;
  // Set while a PIN should exist but cannot be used. The area then stays locked and no guess is counted or checked.
  issue?(): Promise<ParentAuthIssue | null>;
};

const NO_PIN: PinVerifier = { isConfigured: async () => false, verify: async () => false };
let verifier: PinVerifier = NO_PIN;

// True when a PIN checker has been registered (false for every install while family mode is off).
export function hasPinVerifier(): boolean {
  return verifier !== NO_PIN;
}

export type Attempts = { version: 1; failures: number; lockedUntil: number; lastSeen: number };

// Where the guess counter is kept. The default is AsyncStorage; the PIN module keeps it in native secure storage.
export type AttemptStore = {
  // null = the record could not be read (the caller must then refuse to check anything: fail closed).
  read(): Promise<Attempts | null>;
  write(attempts: Attempts): Promise<boolean>;
};

const ATTEMPTS_KEY = '@ProductivityPet:parentGate';
const FRESH: Attempts = { version: 1, failures: 0, lockedUntil: 0, lastSeen: 0 };
export const FREE_TRIES = 3;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

// Reads/parses a stored counter. A damaged record is NEVER a free reset: it becomes a pause, and the replacement is saved
// so the pause ends on time instead of being renewed on every read.
export async function parseAttempts(raw: string | null, save: (a: Attempts) => Promise<boolean>): Promise<Attempts> {
  if (raw === null) return { ...FRESH };
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    return { version: 1, failures: Math.floor(num(r.failures)), lockedUntil: num(r.lockedUntil), lastSeen: num(r.lastSeen) };
  } catch {
    const now = Date.now();
    const replacement: Attempts = { version: 1, failures: FREE_TRIES, lockedUntil: now + cooldownForFailures(FREE_TRIES), lastSeen: now };
    await save(replacement);
    return replacement;
  }
}

const asyncStorageAttempts: AttemptStore = {
  async read() {
    let raw: string | null;
    try {
      raw = await AsyncStorage.getItem(ATTEMPTS_KEY);
    } catch {
      return null;
    }
    return parseAttempts(raw, (a) => asyncStorageAttempts.write(a));
  },
  async write(attempts) {
    try {
      await AsyncStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
      return true;
    } catch {
      return false;
    }
  },
};
let attemptStore: AttemptStore = asyncStorageAttempts;

// Called by whatever module implements PIN storage. Locks the parent area. `attemptStore` is where the guess counter lives.
export function registerPinVerifier(next: PinVerifier, options: { attemptStore?: AttemptStore } = {}): void {
  verifier = next;
  attemptStore = options.attemptStore ?? asyncStorageAttempts;
  session = null;
  notify();
}

// How long the parent area stays open without use, and the longest it can stay open in total.
export const PARENT_IDLE_LOCK_MS = 5 * 60 * 1000;
export const PARENT_MAX_SESSION_MS = 30 * 60 * 1000;

// Wrong guesses in a row -> pause before the next try. Persisted, so closing and reopening the app does not reset it.
export function cooldownForFailures(failures: number): number {
  if (failures >= 9) return 60 * 60 * 1000;
  if (failures >= 7) return 15 * 60 * 1000;
  if (failures >= 5) return 5 * 60 * 1000;
  if (failures >= 3) return 30 * 1000;
  return 0;
}

// A clock moved BACKWARDS never shortens a pause: time is measured from the latest moment ever seen. (A clock moved
// forwards still shortens it; that cannot be prevented without a trusted time source.)
function effectiveNow(attempts: Attempts): number {
  return Math.max(Date.now(), attempts.lastSeen);
}

// ---------------------------------------------------------------------------------------------------------
// guess limiting (shared by PIN checks and recovery-code checks)

export type AttemptOutcome =
  | { kind: 'ok' }
  | { kind: 'unavailable' }
  | { kind: 'cooldown'; remainingMs: number }
  | { kind: 'wrong'; triesLeft: number; cooldownMs: number };

let attemptChain: Promise<unknown> = Promise.resolve();

// Runs one guess under the limits. The guess is COUNTED AND SAVED BEFORE it is checked, so closing the app in the middle
// of a check gives no free guess; if the counter cannot be saved or read, nothing is checked at all. Guesses (a double
// tap, or a PIN and a recovery code at once) are handled one after another and share one counter. A correct guess
// resets the counter. `afterOk` runs only for a correct guess, still inside the queue.
export function limitedAttempt(check: () => Promise<boolean>, afterOk?: () => Promise<boolean>): Promise<AttemptOutcome> {
  const run = () => doLimitedAttempt(check, afterOk);
  const next = attemptChain.then(run, run);
  attemptChain = next.catch(() => {});
  return next;
}

async function doLimitedAttempt(check: () => Promise<boolean>, afterOk?: () => Promise<boolean>): Promise<AttemptOutcome> {
  const attempts = await attemptStore.read();
  if (!attempts) return { kind: 'unavailable' };
  const now = effectiveNow(attempts);
  if (attempts.lockedUntil > now) return { kind: 'cooldown', remainingMs: attempts.lockedUntil - now };

  const counted: Attempts = {
    version: 1,
    failures: attempts.failures + 1,
    lockedUntil: now + cooldownForFailures(attempts.failures + 1),
    lastSeen: now,
  };
  if (!(await attemptStore.write(counted))) return { kind: 'unavailable' };

  let correct = false;
  try {
    correct = await check();
  } catch {
    return { kind: 'unavailable' }; // the guess stays counted
  }
  if (!correct) {
    return {
      kind: 'wrong',
      triesLeft: Math.max(0, FREE_TRIES - counted.failures),
      cooldownMs: cooldownForFailures(counted.failures),
    };
  }
  if (afterOk) {
    let finished = false;
    try {
      finished = await afterOk();
    } catch {
      finished = false;
    }
    if (!finished) return { kind: 'unavailable' }; // a correct guess whose follow-up could not be saved changes nothing
  }
  await attemptStore.write({ version: 1, failures: 0, lockedUntil: 0, lastSeen: now }); // best effort; the safe direction if it fails
  return { kind: 'ok' };
}

// ---------------------------------------------------------------------------------------------------------
// the open session (memory only: a restart always starts locked)

let session: { startedAt: number; lastActivityAt: number } | null = null;

function sessionValid(now = Date.now()): boolean {
  if (!session) return false;
  // A clock moved backwards locks the area instead of extending the session.
  if (now < session.lastActivityAt || now < session.startedAt) return false;
  return now - session.lastActivityAt < PARENT_IDLE_LOCK_MS && now - session.startedAt < PARENT_MAX_SESSION_MS;
}

// Milliseconds until the open session would lock by itself (0 when it is not open).
export function getSessionRemainingMs(now = Date.now()): number {
  if (!session || !sessionValid(now)) return 0;
  return Math.min(PARENT_IDLE_LOCK_MS - (now - session.lastActivityAt), PARENT_MAX_SESSION_MS - (now - session.startedAt));
}

// Call on every use of the parent area; keeps an open session open (up to the total limit).
export function touchParentSession(): void {
  if (session && sessionValid()) session.lastActivityAt = Date.now();
}

// Tells listeners to re-read the access state (for example after a PIN was created or changed).
export function refreshParentAccess(): void {
  notify();
}

export function lockParentArea(): void {
  if (!session) return;
  session = null;
  notify();
}

const listeners = new Set<() => void>();
function notify(): void {
  listeners.forEach((l) => l());
}
export function subscribeToParentAccess(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Starts the automatic locking: the app leaving the foreground, and the active profile changing. Returns a clean-up.
export function startParentGateAutoLock(): () => void {
  const sub = AppState.addEventListener('change', (next) => {
    if (next !== 'active') lockParentArea();
  });
  const off = subscribeToActiveProfile(() => lockParentArea());
  return () => {
    sub?.remove();
    off();
  };
}

// ---------------------------------------------------------------------------------------------------------
// access

export type ParentAccess =
  | { state: 'checking' }
  // No PIN exists, so nothing protects the parent area (today's behavior for every user).
  | { state: 'unprotected' }
  | { state: 'locked'; reason?: ParentAuthIssue }
  | { state: 'cooldown'; remainingMs: number }
  | { state: 'unlocked' };

async function currentIssue(): Promise<ParentAuthIssue | null> {
  try {
    return (await verifier.issue?.()) ?? null;
  } catch {
    return null;
  }
}

export async function getParentAccess(): Promise<ParentAccess> {
  if (!(await verifier.isConfigured().catch(() => true))) return { state: 'unprotected' }; // unknown = keep it protected
  const issue = await currentIssue();
  if (issue) return { state: 'locked', reason: issue };
  if (sessionValid()) return { state: 'unlocked' };
  if (session) {
    session = null; // expired
  }
  const attempts = await attemptStore.read();
  if (!attempts) return { state: 'locked' };
  const remaining = attempts.lockedUntil - effectiveNow(attempts);
  return remaining > 0 ? { state: 'cooldown', remainingMs: remaining } : { state: 'locked' };
}

// True when the parent area may be used right now (open, or there is no PIN). Used to guard actions that live outside
// the parent screens, for example restarting the family set-up.
export async function isParentAccessAllowed(): Promise<boolean> {
  const access = await getParentAccess();
  return access.state === 'unprotected' || access.state === 'unlocked';
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-format' | 'unavailable' | 'verifier-missing' }
  | { ok: false; reason: 'cooldown'; remainingMs: number }
  | { ok: false; reason: 'wrong'; triesLeft: number; cooldownMs: number };

// A PIN must be 6 to 8 digits (see @/utils/parent-pin.ts); entering anything else is refused without a guess.
export const PIN_FORMAT = /^\d{6,8}$/;

// Checks a PIN and opens the parent area (see limitedAttempt for how guesses are counted).
export async function unlockParentArea(pin: string): Promise<UnlockResult> {
  if (typeof pin !== 'string' || !PIN_FORMAT.test(pin)) return { ok: false, reason: 'invalid-format' };
  if (!(await verifier.isConfigured().catch(() => true))) return { ok: true }; // no PIN exists: nothing to unlock
  if (await currentIssue()) return { ok: false, reason: 'verifier-missing' }; // nothing to check, nothing counted
  const outcome = await limitedAttempt(() => verifier.verify(pin));
  switch (outcome.kind) {
    case 'ok': {
      const at = Date.now();
      session = { startedAt: at, lastActivityAt: at };
      notify();
      return { ok: true };
    }
    case 'cooldown':
      return { ok: false, reason: 'cooldown', remainingMs: outcome.remainingMs };
    case 'unavailable':
      return { ok: false, reason: 'unavailable' };
    default:
      notify();
      return { ok: false, reason: 'wrong', triesLeft: outcome.triesLeft, cooldownMs: outcome.cooldownMs };
  }
}

// "0:30", "5:00", "1:00:00" for a pause message.
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
