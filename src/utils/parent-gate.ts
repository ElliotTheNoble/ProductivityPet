import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { subscribeToActiveProfile } from '@/utils/profiles';

// Parent Gate (M2 Stage 2A-0): the access barrier in front of the parent-only areas (the Parent Dashboard and the
// onboarding / family set-up flow). It decides whether the parent area is OPEN or LOCKED, limits wrong PIN guesses (also
// across app restarts: after five wrong PINs in a row the phone's own screen-lock check is needed before more tries; there is
// NO waiting period), and locks again when the app goes to the background, when the profile changes and after a period without use.
//
// WHAT THIS IS, AND IS NOT. It is a temporary access barrier that keeps children out of the parent area by normal
// navigation on a shared device. It is NOT verified parental identity and NOT full security: it cannot tell who is
// holding the device, the attempt limit depends on data stored on the device, and nothing here can protect against someone
// who can read or change the app's storage. Never describe it as secure to a user.
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
// Wrong PINs in a row before the phone's own screen-lock check is needed. There is no waiting period: the fifth wrong PIN does not
// start a pause, it just means the next try has to be preceded by the check (see passDeviceCheck). The count is kept in secure
// storage, so closing and reopening the app does not reset it; only a correct PIN or a passed check does.
export const PIN_TRIES_BEFORE_DEVICE_CHECK = 5;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

// Reads/parses a stored counter. `lockedUntil` is a leftover of the old waiting periods: it is read but IGNORED (and written as 0),
// so nobody stays locked after the update. A damaged record is NEVER a free reset: it counts as five wrong tries (the screen-lock
// check is needed), and the replacement is saved.
export async function parseAttempts(raw: string | null, save: (a: Attempts) => Promise<boolean>): Promise<Attempts> {
  if (raw === null) return { ...FRESH };
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    return { version: 1, failures: Math.floor(num(r.failures)), lockedUntil: 0, lastSeen: num(r.lastSeen) };
  } catch {
    const replacement: Attempts = { version: 1, failures: PIN_TRIES_BEFORE_DEVICE_CHECK, lockedUntil: 0, lastSeen: Date.now() };
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

// The checker that is registered right now (used to tell whether it is still the one a caller registered earlier).
export function getRegisteredPinVerifier(): PinVerifier {
  return verifier;
}

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

// ---------------------------------------------------------------------------------------------------------
// guess limiting (shared by PIN checks and recovery-code checks)

// Why a guess could not be checked. Plain constants (never anything about a PIN or code): they are shown in the error message and in the
// development trace, so a failure on a phone can be told apart from another one.
export type AttemptFailureDetail = 'attempts-read' | 'attempts-write' | 'check-failed' | 'follow-up-failed';

export type AttemptOutcome =
  | { kind: 'ok' }
  | { kind: 'unavailable'; detail: AttemptFailureDetail }
  // Five wrong PINs in a row: nothing was checked or counted; the phone's screen-lock check (passDeviceCheck) is needed first.
  | { kind: 'device-check' }
  | { kind: 'wrong'; triesLeft: number };

// 'pin': a Parent PIN guess (counted; the sixth in a row needs the device check). 'code': a recovery-code guess (never counted and never
// held back: the code has 50 bits or more, so guessing it is not a practical way in, and it is the way out for a parent who forgot the PIN).
export type AttemptKind = 'pin' | 'code';

let attemptChain: Promise<unknown> = Promise.resolve();

// Runs one guess under the limit. A PIN guess is COUNTED AND SAVED BEFORE it is checked, so closing the app in the middle of a check
// gives no free guess; if the counter cannot be saved or read, nothing is checked at all. Guesses (a double tap, or a PIN and a
// recovery code at once) are handled one after another and share one counter. A correct guess resets the counter. `afterOk` runs only
// for a correct guess, still inside the queue.
export function limitedAttempt(
  check: () => Promise<boolean>,
  afterOk?: () => Promise<boolean>,
  kind: AttemptKind = 'pin'
): Promise<AttemptOutcome> {
  const run = () => doLimitedAttempt(check, afterOk, kind);
  const next = attemptChain.then(run, run);
  attemptChain = next.catch(() => {});
  return next;
}

async function doLimitedAttempt(check: () => Promise<boolean>, afterOk: (() => Promise<boolean>) | undefined, kind: AttemptKind): Promise<AttemptOutcome> {
  const attempts = await attemptStore.read();
  if (!attempts) return { kind: 'unavailable', detail: 'attempts-read' };
  const now = Math.max(Date.now(), attempts.lastSeen);

  let failures = attempts.failures;
  if (kind === 'pin') {
    if (failures >= PIN_TRIES_BEFORE_DEVICE_CHECK) return { kind: 'device-check' };
    failures += 1;
    if (!(await attemptStore.write({ version: 1, failures, lockedUntil: 0, lastSeen: now }))) return { kind: 'unavailable', detail: 'attempts-write' };
  }

  let correct = false;
  try {
    correct = await check();
  } catch {
    return { kind: 'unavailable', detail: 'check-failed' }; // a PIN guess stays counted
  }
  if (!correct) return { kind: 'wrong', triesLeft: kind === 'pin' ? Math.max(0, PIN_TRIES_BEFORE_DEVICE_CHECK - failures) : 0 };
  if (afterOk) {
    let finished = false;
    try {
      finished = await afterOk();
    } catch {
      finished = false;
    }
    if (!finished) return { kind: 'unavailable', detail: 'follow-up-failed' }; // a correct guess whose follow-up could not be saved changes nothing
  }
  await attemptStore.write({ version: 1, failures: 0, lockedUntil: 0, lastSeen: now }); // best effort; the safe direction if it fails
  return { kind: 'ok' };
}

export type DeviceCheckResult = 'passed' | 'no-device-lock' | 'cancelled' | 'failed' | 'unavailable';

// After five wrong PINs: asks the operating system to confirm the phone's own screen lock (PIN, pattern, password, fingerprint or face),
// and only then lets the next PIN tries happen (the counter is set back to zero). Fails closed: a cancelled or failed check, or a check that
// could not be opened, changes nothing. A phone with NO screen lock (or one that cannot do the check) has nothing to ask, so there the PIN
// tries stay stopped ('no-device-lock'): no waiting period and no reset of the counter. The way on is the recovery code, which is never
// counted or held back and sets a new PIN (which resets the counter). The count lives in secure storage, so restarting the app does not
// skip the check. This never opens the parent area and never replaces or reveals a PIN: it only lifts the limit on further tries.
export async function passDeviceCheck(promptMessage: string, cancelLabel: string): Promise<DeviceCheckResult> {
  let outcome: DeviceCheckResult;
  try {
    const { authenticateDevice } = require('@/utils/device-auth') as typeof import('@/utils/device-auth');
    const result = await authenticateDevice(promptMessage, cancelLabel);
    if (result.ok) outcome = 'passed';
    else if (result.reason === 'not-secured' || result.reason === 'unsupported') outcome = 'no-device-lock';
    else if (result.reason === 'cancelled') outcome = 'cancelled';
    else if (result.reason === 'unavailable') outcome = 'unavailable';
    else outcome = 'failed';
  } catch {
    outcome = 'unavailable';
  }
  if (outcome === 'passed') {
    const ok = await attemptStore.write({ version: 1, failures: 0, lockedUntil: 0, lastSeen: Date.now() });
    if (!ok) return 'unavailable'; // the counter could not be reset: the tries stay held back
    notify();
  }
  return outcome;
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

// Opens the parent area for a fresh session. Only the Parent PIN module calls this, right after a parent has just proved
// they hold the secrets (finishing the first setup with both the PIN and the recovery code). It is NEVER called by recovery:
// after a recovery the parent must unlock with the new PIN.
export function openParentSession(): void {
  const at = Date.now();
  session = { startedAt: at, lastActivityAt: at };
  notify();
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
  // `deviceCheck`: five wrong PINs in a row, so the phone's screen-lock check is needed before the next try.
  | { state: 'locked'; reason?: ParentAuthIssue; deviceCheck?: boolean }
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
  return attempts.failures >= PIN_TRIES_BEFORE_DEVICE_CHECK ? { state: 'locked', deviceCheck: true } : { state: 'locked' };
}

// True when the parent area may be used right now (open, or there is no PIN). Used to guard actions that live outside
// the parent screens, for example restarting the family set-up.
export async function isParentAccessAllowed(): Promise<boolean> {
  const access = await getParentAccess();
  return access.state === 'unprotected' || access.state === 'unlocked';
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-format' | 'verifier-missing' | 'device-check' }
  | { ok: false; reason: 'unavailable'; detail: AttemptFailureDetail }
  | { ok: false; reason: 'wrong'; triesLeft: number };

// A PIN must be 4 to 8 digits (see @/utils/parent-pin.ts); entering anything else is refused without a guess.
export const PIN_FORMAT = /^\d{4,8}$/;

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
    case 'device-check':
      notify();
      return { ok: false, reason: 'device-check' };
    case 'unavailable':
      return { ok: false, reason: 'unavailable', detail: outcome.detail };
    default:
      notify();
      return { ok: false, reason: 'wrong', triesLeft: outcome.triesLeft };
  }
}
