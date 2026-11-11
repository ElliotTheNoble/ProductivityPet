import { bytesToHex } from '@noble/hashes/utils';
import { Platform } from 'react-native';

import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { clearSetupClaim, setupClaimSatisfied } from '@/utils/family-claim';
import {
  limitedAttempt,
  openParentSession,
  parseAttempts,
  refreshParentAccess,
  getRegisteredPinVerifier,
  registerPinVerifier,
  type AttemptFailureDetail,
  type AttemptStore,
  type PinVerifier,
} from '@/utils/parent-gate';
import { pinTrace, type TraceWord } from '@/utils/pin-trace';
import { getAuthBackend, isSecureStorageAvailable, readSecret, setAuthBackend, writeSecret } from '@/utils/parent-auth-backend';
import { ATTEMPTS_KEY, RECORD_KEY } from '@/utils/parent-secrets';
import {
  checkSecret,
  generateRecoveryCode,
  isSecretRecord,
  makeSecretRecord,
  normalizeRecoveryCode,
  validateNewPin,
  type SecretRecord,
} from '@/utils/pin-crypto';
import { secureRandomBytes } from '@/utils/secure-random';

// The parent PIN and its one-time recovery code (M2 Stage 2A-0b). Everything here is behind FAMILY_MODE_ENABLED (see
// @/utils/dev-flags.ts, off for everyone): while it is off none of this runs, the native modules are never loaded, and the
// parent area behaves exactly as it always has. There is no screen for it yet; the "UI contract" below says what the future
// screens must do.
//
// WHAT IS STORED, AND WHERE
//  - Native secure storage (@/utils/parent-secrets.ts), ONE record: an install id, a phase, a scrypt verifier for the PIN and
//    a scrypt verifier for the recovery code. Neither the PIN nor the code is stored in any form that can be read back.
//    Changing the PIN or using the recovery code replaces the whole record in a single write, so there is never a moment
//    with no PIN, and the old recovery code stops working exactly when the new record is saved.
//  - Native secure storage: the guess counter (shared by PIN and recovery-code guesses, see parent-gate.ts limitedAttempt).
//  - AsyncStorage (it is backed up and restored WITH the family data): a small marker saying "a PIN protects this family's
//    data" and the install id it belongs to. No secret. The marker is what turns protection ON.
//
// SETTING UP IS TWO STEPS, so an interruption can never leave a half-finished PIN protecting (or locking) anything:
//   1. beginPinSetup(pin)            writes a PENDING record (phase 'pending'); nothing refers to it, nothing is protected,
//                                    the parent area stays exactly as it was. Returns the recovery code (shown once).
//   2. confirmPinSetup(pin, code)    only when the parent types back BOTH the PIN and the recovery code (so they really have
//                                    the code and did not mistype the PIN): the record becomes 'active' (secure storage first),
//                                    then the marker is written. Only now is the parent area protected.
//  The app closing at any point before step 2 finishes leaves "no PIN" (the pending record is simply replaced by the next
//  begin). The recovery code was never stored, so a parent who closed the app before saving it just starts again.
//
// THE UI CONTRACT (for the setup screens, not built yet)
//   - Show the recovery code ONCE, with a plain warning to keep it somewhere safe and away from children, and do not leave
//     the screen until step 2 succeeds; if the app is closed first, setup starts again from the beginning.
//   - A recovered or regenerated code is NOT confirmed until confirmRecoveryCode(code) succeeds. getRecoveryStatus()
//     returns 'unconfirmed' until then (including after the app was closed before the parent saw the new code). Every time
//     the parent area is opened while it is 'unconfirmed', the UI must immediately make the parent create (regenerate) and
//     confirm a new code before anything else.
//   - When parent access shows 'verifier-missing', show the explanation, offer nothing that creates a PIN, and never
//     suggest the device passcode or the recovery code as a way in.
//
// WHEN THE DATA AND THE SECRET DISAGREE (a restore, a new phone, an old Keychain item surviving a reinstall)
//   marker  | secure record             | meaning                           | result
//   none    | none                      | no PIN                            | no PIN (setup allowed)
//   none    | exists (pending or stale) | unfinished setup / earlier install| treated as no PIN; the next begin replaces it
//   exists  | exists 'active', same id  | normal                            | ready
//   exists  | missing, damaged, other,  | the data came without its secret  | LOCKED: 'verifier-missing'
//           | not 'active', unreadable  |                                   | (rechecked each time)
//  In the locked cases nothing is deleted, nothing is reset, NO new PIN can be created, and the device's own passcode is NOT
//  a way in. Only guardian-account recovery (not built yet) will be able to restore parent access. The children's data is
//  never touched either way.

type Marker = { v: 1; installId: string; configuredAt: string };
type AuthRecord = {
  v: 1;
  installId: string;
  createdAt: string;
  updatedAt: string;
  // 'pending' = created by beginPinSetup and protecting nothing; 'active' = confirmed.
  phase: 'pending' | 'active';
  // False until the parent has typed back the CURRENT recovery code (see the UI contract).
  recoveryConfirmed: boolean;
  recoveryGeneration: number;
  pin: SecretRecord;
  recovery: SecretRecord;
};

const INSTALL_ID = /^[0-9a-f]{32}$/;

function parseRecord(raw: string): AuthRecord | null {
  try {
    const r = JSON.parse(raw) as Partial<AuthRecord>;
    if (
      !r || r.v !== 1 || typeof r.installId !== 'string' || !INSTALL_ID.test(r.installId) ||
      typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string' ||
      (r.phase !== 'pending' && r.phase !== 'active') || typeof r.recoveryConfirmed !== 'boolean' ||
      typeof r.recoveryGeneration !== 'number' || !Number.isInteger(r.recoveryGeneration) || r.recoveryGeneration < 1 ||
      !isSecretRecord(r.pin) || !isSecretRecord(r.recovery)
    ) {
      return null;
    }
    return r as AuthRecord;
  } catch {
    return null;
  }
}

type MarkerRead = { kind: 'none' } | { kind: 'marker'; marker: Marker } | { kind: 'damaged' } | { kind: 'unreadable' };

async function readMarker(): Promise<MarkerRead> {
  let raw: string | null;
  try {
    raw = await getAuthBackend().markerRead();
  } catch {
    return { kind: 'unreadable' };
  }
  if (raw === null) return { kind: 'none' };
  try {
    const m = JSON.parse(raw) as Partial<Marker>;
    if (m && m.v === 1 && typeof m.installId === 'string' && INSTALL_ID.test(m.installId) && typeof m.configuredAt === 'string') {
      return { kind: 'marker', marker: m as Marker };
    }
  } catch {
    // falls through
  }
  return { kind: 'damaged' };
}

export type AuthState =
  // No secure storage here (the web, or a build without the native module) and no marker: nothing to protect with.
  | { kind: 'unsupported' }
  // No PIN protecting anything (setup allowed). `pending` is an unfinished setup, if there is one.
  | { kind: 'none'; pending: AuthRecord | null }
  | { kind: 'ready'; record: AuthRecord }
  // A PIN should exist but cannot be used (see the table above). Parent access stays locked; nothing is changed.
  | { kind: 'verifier-missing'; why: 'missing' | 'damaged' | 'other-install' | 'unreadable' };

export async function getAuthState(): Promise<AuthState> {
  const markerRead = await readMarker();
  const available = await isSecureStorageAvailable();
  if (!available) {
    return markerRead.kind === 'none' ? { kind: 'unsupported' } : { kind: 'verifier-missing', why: 'unreadable' };
  }
  const secret = await readSecret(RECORD_KEY);
  if (!secret.ok) {
    return markerRead.kind === 'none' ? { kind: 'none', pending: null } : { kind: 'verifier-missing', why: 'unreadable' };
  }
  const record = secret.value === null ? null : parseRecord(secret.value);

  // Nothing claims a PIN protects this data: a record that exists is an unfinished setup or a stale item, and is ignored.
  if (markerRead.kind === 'none') return { kind: 'none', pending: record && record.phase === 'pending' ? record : null };
  if (markerRead.kind === 'unreadable') return { kind: 'verifier-missing', why: 'unreadable' };
  if (secret.value === null) return { kind: 'verifier-missing', why: 'missing' };
  if (!record || record.phase !== 'active') return { kind: 'verifier-missing', why: 'damaged' };
  if (markerRead.kind === 'damaged') {
    // The marker is damaged but a valid, active secret record exists: the marker is rebuilt from it (best effort).
    await writeMarker(record.installId, record.createdAt);
    return { kind: 'ready', record };
  }
  if (markerRead.marker.installId !== record.installId) return { kind: 'verifier-missing', why: 'other-install' };
  return { kind: 'ready', record };
}

async function writeMarker(installId: string, configuredAt: string): Promise<boolean> {
  return getAuthBackend().markerWrite(JSON.stringify({ v: 1, installId, configuredAt } satisfies Marker));
}

// ---------------------------------------------------------------------------------------------------------
// the guess counter, in secure storage (so editing the app's ordinary storage cannot reset it)

export const secureAttemptStore: AttemptStore = {
  async read() {
    const r = await readSecret(ATTEMPTS_KEY);
    if (!r.ok) return null; // cannot be read: nothing is checked
    return parseAttempts(r.value, (a) => secureAttemptStore.write(a));
  },
  write(attempts) {
    return writeSecret(ATTEMPTS_KEY, JSON.stringify(attempts));
  },
};

// ---------------------------------------------------------------------------------------------------------
// results

export type BeginSetupResult =
  | { ok: true; recoveryCode: string }
  // 'claim-required': a household with children and no PIN may only start the setup after the device security check (family-claim.ts)
  | { ok: false; reason: 'format' | 'weak' | 'unsupported' | 'already-configured' | 'verifier-missing' | 'unavailable' | 'claim-required' };

export type ConfirmSetupResult =
  | { ok: true }
  | { ok: false; reason: 'format' | 'invalid-code' | 'not-pending' | 'already-configured' | 'verifier-missing' | 'wrong' | 'unavailable' };

// Why a Parent PIN change (or a recovery step) could not be done, as plain constants: they are shown in the error message and in the development
// trace, so a failure on a phone can be told apart from another one. Never anything about a PIN or code.
export type PinFailureDetail =
  | AttemptFailureDetail
  | 'record-read'
  | 'hash-new'
  | 'record-write'
  | 'read-back'
  | 'read-back-differs'
  | 'new-pin-does-not-match'
  | 'old-pin-still-works';

// A guess that was not accepted: a wrong PIN / code (with the PIN tries left before the phone's screen-lock check), or the screen-lock
// check being needed first (five wrong PINs in a row). There is no waiting period.
type GuessFailure = { ok: false; reason: 'device-check' } | { ok: false; reason: 'wrong'; triesLeft: number };
type Unavailable = { ok: false; reason: 'unavailable'; detail: PinFailureDetail };

export type PinChangeResult =
  | { ok: true }
  | { ok: false; reason: 'format' | 'weak' | 'not-configured' | 'verifier-missing' }
  // 'not-verified': the new record was written but reading it back (or trying the new PIN on it) did not give what was expected, so the PIN
  // may not have changed. The change is NOT reported as done.
  | { ok: false; reason: 'not-verified'; detail: PinFailureDetail }
  | Unavailable
  | GuessFailure;

export type RecoveryResult =
  | { ok: true; recoveryCode: string }
  | { ok: false; reason: 'format' | 'weak' | 'invalid-code' | 'not-configured' | 'verifier-missing' }
  | Unavailable
  | GuessFailure;

export type ConfirmRecoveryResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-code' | 'not-configured' | 'verifier-missing' }
  | Unavailable
  | GuessFailure;

// What the setup / recovery screens need to know about the recovery code.
//  'none'          no PIN and no unfinished setup
//  'pending-setup' an unfinished setup exists (its code was never confirmed; it protects nothing; start setup again)
//  'confirmed'     the parent has typed back the current recovery code
//  'unconfirmed'   a recovery code exists that the parent has NOT confirmed (a recovery or a new code was interrupted before
//                  confirmation): the UI must make them create and confirm a new code as soon as the parent area is open
//  'unavailable'   a PIN should exist but cannot be used
export type RecoveryStatus = 'none' | 'pending-setup' | 'confirmed' | 'unconfirmed' | 'unavailable';

export async function getRecoveryStatus(): Promise<RecoveryStatus> {
  const state = await getAuthState();
  switch (state.kind) {
    case 'ready':
      return state.record.recoveryConfirmed ? 'confirmed' : 'unconfirmed';
    case 'verifier-missing':
      return 'unavailable';
    case 'none':
      return state.pending ? 'pending-setup' : 'none';
    default:
      return 'none';
  }
}

function reasonFor(state: AuthState): 'not-configured' | 'verifier-missing' {
  return state.kind === 'verifier-missing' ? 'verifier-missing' : 'not-configured';
}

// ---------------------------------------------------------------------------------------------------------
// setting up (two steps, see the top of this file)

// One setup step at a time: a second tap, or a begin and a confirm at once, is refused instead of racing.
let setupBusy = false;

// Step 1. Creates a PENDING record and returns the recovery code ONCE (it is not stored in any form that can be read back).
// Nothing is protected until confirmPinSetup succeeds. Refuses (changing nothing) when a PIN already exists, when a PIN
// should exist but its record is missing (it never silently creates a replacement), and when secure storage or secure
// randomness is not available.
export async function beginPinSetup(pin: string): Promise<BeginSetupResult> {
  // In family mode a household that already has children needs the setup claim (a successful device security check, see
  // @/utils/family-claim.ts) before anyone can create the first PIN. Checked here, where the PIN is made, not only on the screen.
  if (!(await setupClaimSatisfied())) return { ok: false, reason: 'claim-required' };
  const policy = validateNewPin(pin);
  if (!policy.ok) return policy;
  if (setupBusy) return { ok: false, reason: 'unavailable' };
  setupBusy = true;
  try {
    const state = await getAuthState();
    if (state.kind === 'unsupported') return { ok: false, reason: 'unsupported' };
    if (state.kind === 'ready') return { ok: false, reason: 'already-configured' };
    if (state.kind === 'verifier-missing') return { ok: false, reason: 'verifier-missing' };

    let record: AuthRecord;
    let recoveryCode: string;
    try {
      const installId = bytesToHex(await secureRandomBytes(16));
      recoveryCode = await generateRecoveryCode();
      const now = new Date().toISOString();
      record = {
        v: 1,
        installId,
        createdAt: now,
        updatedAt: now,
        phase: 'pending',
        recoveryConfirmed: false,
        recoveryGeneration: 1,
        pin: await makeSecretRecord('pin', pin),
        recovery: await makeSecretRecord('recovery', normalizeRecoveryCode(recoveryCode)!),
      };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (!(await saveRecord(record))) return { ok: false, reason: 'unavailable' };
    clearSetupClaim(); // the claim is single-use: starting the setup spends it (starting over needs the device check again)
    return { ok: true, recoveryCode };
  } finally {
    setupBusy = false;
  }
}

// Step 2. The parent types back the PIN AND the recovery code they were shown. Only if both match the pending record does
// protection start: the record becomes 'active' in secure storage FIRST, then the marker is written. An interruption between
// the two leaves "no PIN" (an active record nothing refers to is ignored), never a marker pointing at nothing. This does not
// count as a guess: nothing is protected yet, so there is nothing to gain by guessing.
export async function confirmPinSetup(pin: string, code: string): Promise<ConfirmSetupResult> {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) return { ok: false, reason: 'format' };
  const canonical = normalizeRecoveryCode(code);
  if (!canonical) return { ok: false, reason: 'invalid-code' };
  if (setupBusy) return { ok: false, reason: 'unavailable' };
  setupBusy = true;
  try {
    const state = await getAuthState();
    if (state.kind === 'ready') return { ok: false, reason: 'already-configured' };
    if (state.kind === 'verifier-missing') return { ok: false, reason: 'verifier-missing' };
    if (state.kind !== 'none' || !state.pending) return { ok: false, reason: 'not-pending' };
    const pending = state.pending;
    let pinOk = false;
    let codeOk = false;
    try {
      pinOk = await checkSecret('pin', pin, pending.pin);
      codeOk = await checkSecret('recovery', canonical, pending.recovery);
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (!pinOk || !codeOk) return { ok: false, reason: 'wrong' };
    const active: AuthRecord = { ...pending, phase: 'active', recoveryConfirmed: true, updatedAt: new Date().toISOString() };
    if (!(await saveRecord(active))) return { ok: false, reason: 'unavailable' };
    if (!(await writeMarker(active.installId, active.createdAt))) return { ok: false, reason: 'unavailable' };
    await secureAttemptStore.write({ version: 1, failures: 0, lockedUntil: 0, lastSeen: Date.now() });
    clearSetupClaim(); // the PIN exists now: no claim is ever needed (or valid) again
    // The parent has just typed back both the PIN and the recovery code: the parent area opens for them (first setup only).
    openParentSession();
    return { ok: true };
  } finally {
    setupBusy = false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// everything below works on an ACTIVE PIN, and every check or write starts from a FRESH read inside the guess queue

// The current record, read FRESH. Every check and follow-up write inside the guess queue starts from this, never from a
// copy read earlier, so a queued change (a recovery that replaced the code, say) can never be undone or bypassed by a
// stale copy.
async function readyRecord(): Promise<AuthRecord | null> {
  const state = await getAuthState();
  return state.kind === 'ready' ? state.record : null;
}

async function saveRecord(next: AuthRecord): Promise<boolean> {
  return writeSecret(RECORD_KEY, JSON.stringify(next)); // one write: it fully happens or the old record stays
}

// Checks a PIN against the stored verifier (no guess counting: parent-gate.ts and the functions below wrap it).
async function pinMatches(pin: string): Promise<boolean> {
  const record = await readyRecord();
  return !!record && (await checkSecret('pin', pin, record.pin));
}

// Two verifier records are the same (compared only with each other, never shown or logged).
function sameSecretRecord(a: SecretRecord, b: SecretRecord): boolean {
  return a.salt === b.salt && a.hash === b.hash && JSON.stringify(a.kdf) === JSON.stringify(b.kdf);
}

// Changes the PIN. The current PIN is a counted guess. The recovery code stays valid (and keeps its confirmed state).
//
// The change counts as done only when it has been VERIFIED, step by step, after the write:
//   1. the record is read back and holds exactly the new PIN verifier AND the same recovery code, generation and confirmed state as before;
//   2. the saved verifier ACCEPTS the new PIN (the new PIN is hashed again and compared with it);
//   3. in a development build, the saved verifier REFUSES the old PIN (unless the "new" PIN is the same as the old one).
// Anything else (a failed write or read, or an unexpected answer) is reported with the step that failed, never as a success.
export async function changePin(currentPin: string, newPin: string): Promise<PinChangeResult> {
  pinTrace('change:start');
  const policy = validateNewPin(newPin);
  if (!policy.ok) return policy;
  const state = await getAuthState();
  if (state.kind !== 'ready') return { ok: false, reason: reasonFor(state) };
  let failure: { detail: PinFailureDetail; verification: boolean } | null = null;
  const fail = (detail: PinFailureDetail, verification = false) => {
    failure = { detail, verification };
    pinTrace('change:finished', { ok: false, detail: detail as TraceWord });
    return false;
  };
  const outcome = await limitedAttempt(
    async () => {
      const started = Date.now();
      const matches = await pinMatches(currentPin);
      pinTrace('change:current-pin-checked', { matches, ms: Date.now() - started });
      return matches;
    },
    async () => {
      const current = await readyRecord();
      if (!current) return fail('record-read');
      let hashed: SecretRecord;
      const hashStarted = Date.now();
      try {
        hashed = await makeSecretRecord('pin', newPin);
      } catch {
        return fail('hash-new');
      }
      pinTrace('change:new-pin-hashed', { ms: Date.now() - hashStarted });
      const next: AuthRecord = { ...current, updatedAt: new Date().toISOString(), pin: hashed };
      if (!(await saveRecord(next))) return fail('record-write');
      pinTrace('change:record-written');
      const back = await readyRecord();
      if (!back) return fail('read-back', true);
      const sameVerifier = sameSecretRecord(back.pin, next.pin);
      const sameRecovery =
        sameSecretRecord(back.recovery, current.recovery) &&
        back.recoveryGeneration === current.recoveryGeneration &&
        back.recoveryConfirmed === current.recoveryConfirmed;
      pinTrace('change:read-back', { sameVerifier, sameRecovery });
      if (!sameVerifier || !sameRecovery) return fail('read-back-differs', true);
      let accepts = false;
      try {
        accepts = await checkSecret('pin', newPin, back.pin);
      } catch {
        accepts = false;
      }
      pinTrace('change:new-pin-verified', { accepted: accepts });
      if (!accepts) return fail('new-pin-does-not-match', true);
      if (__DEV__ && FAMILY_MODE_ENABLED && newPin !== currentPin) {
        let oldAccepted = false;
        try {
          oldAccepted = await checkSecret('pin', currentPin, back.pin);
        } catch {
          oldAccepted = false;
        }
        pinTrace('change:old-pin-checked', { oldStillAccepted: oldAccepted });
        if (oldAccepted) return fail('old-pin-still-works', true);
      }
      return true;
    },
    'pin'
  );
  const changed = mapOutcome(outcome);
  if (changed.ok) {
    pinTrace('change:finished', { ok: true });
    refreshParentAccess();
    return changed;
  }
  const lost = failure as { detail: PinFailureDetail; verification: boolean } | null;
  if (lost && changed.reason === 'unavailable') return { ok: false, reason: lost.verification ? 'not-verified' : 'unavailable', detail: lost.detail };
  if (changed.reason !== 'unavailable') pinTrace('change:finished', { ok: false, detail: changed.reason as TraceWord });
  else pinTrace('change:finished', { ok: false, detail: changed.detail as TraceWord });
  return changed;
}

// Uses the recovery code to set a NEW PIN. A correct code is the only thing that is needed, and it is a counted guess. On
// success the old recovery code stops working and a NEW one is returned (once): the new record, holding both the new PIN
// and the new code, is saved in one write. The new code is UNCONFIRMED until confirmRecoveryCode succeeds, so if the app is
// closed before the parent has seen and saved it, getRecoveryStatus() says 'unconfirmed' and the UI makes them create a new
// one. If the write fails nothing changes and the old PIN and code still work. This never touches any family data.
export async function recoverWithCode(code: string, newPin: string): Promise<RecoveryResult> {
  const policy = validateNewPin(newPin);
  if (!policy.ok) return policy;
  const canonical = normalizeRecoveryCode(code);
  if (!canonical) return { ok: false, reason: 'invalid-code' }; // a mistyped code is not a guess
  const state = await getAuthState();
  if (state.kind !== 'ready') return { ok: false, reason: reasonFor(state) };
  let newCode = '';
  const outcome = await limitedAttempt(
    async () => {
      const current = await readyRecord();
      return !!current && checkSecret('recovery', canonical, current.recovery);
    },
    async () => {
      const current = await readyRecord();
      if (!current) return false;
      newCode = await generateRecoveryCode();
      const next: AuthRecord = {
        ...current,
        updatedAt: new Date().toISOString(),
        recoveryConfirmed: false,
        recoveryGeneration: current.recoveryGeneration + 1,
        pin: await makeSecretRecord('pin', newPin),
        recovery: await makeSecretRecord('recovery', normalizeRecoveryCode(newCode)!),
      };
      return saveRecord(next);
    },
    'code'
  );
  const mapped = mapOutcome(outcome);
  if (mapped.ok) {
    refreshParentAccess();
    return { ok: true, recoveryCode: newCode };
  }
  return mapped;
}

// Makes a new recovery code (the old one stops working); it is UNCONFIRMED until confirmRecoveryCode. The PIN is a counted guess.
export async function regenerateRecoveryCode(pin: string): Promise<RecoveryResult> {
  const state = await getAuthState();
  if (state.kind !== 'ready') return { ok: false, reason: reasonFor(state) };
  let newCode = '';
  const outcome = await limitedAttempt(
    () => pinMatches(pin),
    async () => {
      const current = await readyRecord();
      if (!current) return false;
      newCode = await generateRecoveryCode();
      const next: AuthRecord = {
        ...current,
        updatedAt: new Date().toISOString(),
        recoveryConfirmed: false,
        recoveryGeneration: current.recoveryGeneration + 1,
        recovery: await makeSecretRecord('recovery', normalizeRecoveryCode(newCode)!),
      };
      return saveRecord(next);
    }
  );
  const mapped = mapOutcome(outcome);
  if (mapped.ok) refreshParentAccess(); // the recovery status is now 'unconfirmed'
  return mapped.ok ? { ok: true, recoveryCode: newCode } : mapped;
}

// The parent types back the CURRENT recovery code to prove they have it. A counted guess (it checks the live code), so it
// shares the lockout counter. Does nothing if the code is already confirmed. On success the record is replaced in one write
// with the code marked confirmed.
export async function confirmRecoveryCode(code: string): Promise<ConfirmRecoveryResult> {
  const canonical = normalizeRecoveryCode(code);
  if (!canonical) return { ok: false, reason: 'invalid-code' };
  const state = await getAuthState();
  if (state.kind !== 'ready') return { ok: false, reason: reasonFor(state) };
  if (state.record.recoveryConfirmed) return { ok: true };
  const outcome = await limitedAttempt(
    async () => {
      const current = await readyRecord();
      return !!current && checkSecret('recovery', canonical, current.recovery);
    },
    async () => {
      const current = await readyRecord();
      if (!current) return false;
      return saveRecord({ ...current, recoveryConfirmed: true, updatedAt: new Date().toISOString() });
    },
    'code'
  );
  const confirmed = mapOutcome(outcome);
  if (confirmed.ok) refreshParentAccess();
  return confirmed;
}

function mapOutcome(outcome: Awaited<ReturnType<typeof limitedAttempt>>): { ok: true } | Unavailable | GuessFailure {
  switch (outcome.kind) {
    case 'ok':
      return { ok: true };
    case 'device-check':
      return { ok: false, reason: 'device-check' };
    case 'wrong':
      return { ok: false, reason: 'wrong', triesLeft: outcome.triesLeft };
    default:
      return { ok: false, reason: 'unavailable', detail: outcome.detail };
  }
}

// ---------------------------------------------------------------------------------------------------------
// connection to the Parent Gate

export function createPinVerifier(): PinVerifier {
  return {
    async isConfigured() {
      const state = await getAuthState();
      return state.kind === 'ready' || state.kind === 'verifier-missing';
    },
    verify: (pin) => pinMatches(pin),
    async issue() {
      return (await getAuthState()).kind === 'verifier-missing' ? 'verifier-missing' : null;
    },
  };
}

// Registers the PIN checker with the Parent Gate. Does NOTHING (and loads no native module) unless family mode is enabled.
// The web is never supported for real use (no secure storage): there it registers only when `devPreview` is true, which by
// default means FAMILY_MODE_ENABLED (and therefore __DEV__), and then the authentication records live in the non-persistent
// in-memory preview backend. Returns whether it registered.
//
// It is safe to call again (the app shell can be mounted again, for example when the navigator rebuilds it while a parent is moving
// from the family picker to the Parent Dashboard): when the checker it registered earlier is still the registered one and nothing about
// the setup differs, it does nothing. Registering a checker clears the open parent session, so a repeated call used to throw away a
// session that had just been opened with the PIN. A checker that really is different (another platform setup, another checker
// registered in the meantime) is still registered, and that still clears the session.
let startedAuth: { setup: string; verifier: ReturnType<typeof createPinVerifier> } | null = null;

export function startParentAuth(options: { enabled?: boolean; platformOS?: string; devPreview?: boolean } = {}): boolean {
  const enabled = options.enabled ?? FAMILY_MODE_ENABLED;
  const os = options.platformOS ?? Platform.OS;
  if (!enabled) return false;
  let setup: string = os;
  if (os === 'web') {
    const preview = options.devPreview ?? FAMILY_MODE_ENABLED;
    if (!preview) return false;
    setup = 'web-preview';
  }
  if (startedAuth && startedAuth.setup === setup && getRegisteredPinVerifier() === startedAuth.verifier) return true; // already registered: keep the session
  if (os === 'web') setAuthBackend((require('@/utils/parent-auth-preview') as typeof import('@/utils/parent-auth-preview')).createPreviewBackend());
  const created = createPinVerifier();
  registerPinVerifier(created, { attemptStore: secureAttemptStore });
  startedAuth = { setup, verifier: created };
  return true;
}
