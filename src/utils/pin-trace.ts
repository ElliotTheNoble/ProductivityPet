import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';

// TEMPORARY, development only: a step-by-step trace of a Parent PIN change, printed to the Metro terminal ("LOG [pin-trace] ..."), so a failure on a
// real phone can be told apart from another one. It exists only in a development build with family mode on; a release build never prints anything.
//
// It can carry NOTHING about a secret: the event is one of a fixed list of words, and every value is a number, a true/false or one of a fixed list
// of words (TraceWord). There is no way to pass a PIN, a recovery code, a hash, a salt, an install id or any free text through it (the types refuse,
// and a test scans what is printed for a PIN, a code and the stored hashes and salts).
//
// Remove this file and its calls once the PIN-change problem is understood (see FEATURE-104).
export type TraceEvent =
  | 'change:start'
  | 'change:current-pin-checked'
  | 'change:new-pin-hashed'
  | 'change:record-written'
  | 'change:read-back'
  | 'change:new-pin-verified'
  | 'change:old-pin-checked'
  | 'change:finished'
  | 'unlock:finished'
  | 'screen:finish-pressed'
  | 'screen:result'
  | 'screen:wiped'
  | 'secure:write-failed'
  | 'secure:read-failed';

export type TraceWord =
  | 'ok'
  | 'wrong'
  | 'device-check'
  | 'unavailable'
  | 'not-verified'
  | 'format'
  | 'weak'
  | 'not-configured'
  | 'verifier-missing'
  | 'attempts-read'
  | 'attempts-write'
  | 'check-failed'
  | 'follow-up-failed'
  | 'record-read'
  | 'hash-new'
  | 'record-write'
  | 'read-back'
  | 'read-back-differs'
  | 'new-pin-does-not-match'
  | 'old-pin-still-works'
  | 'current'
  | 'new'
  | 'again'
  | 'done'
  | 'other';

export type TraceData = Record<string, number | boolean | TraceWord>;

export const pinTraceEnabled = (): boolean => __DEV__ && FAMILY_MODE_ENABLED;

export function pinTrace(event: TraceEvent, data: TraceData = {}, errorCode?: unknown): void {
  if (!pinTraceEnabled()) return;
  // An error code is printed only if it looks like a native error CODE ("ERR_..."); anything else (free text) becomes "other".
  const code = typeof errorCode === 'string' && /^ERR_[A-Z0-9_]{1,60}$/.test(errorCode) ? errorCode : errorCode === undefined ? undefined : 'other';
  console.log('[pin-trace]', event, JSON.stringify(code === undefined ? data : { ...data, errorCode: code }));
}

// The `code` of a thrown error (never its message), for pinTrace's third argument.
export function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}
