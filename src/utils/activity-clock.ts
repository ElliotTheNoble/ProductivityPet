// The inactivity clock behind "return to the family picker after 10 quiet minutes" (family mode only; Stage 4.0). It is PURE:
// every function takes the readings it needs, nothing here reads a real clock, sets a timer, touches storage or React, so the rules
// can be tested to the millisecond. A later stage connects it to the live app; for now nothing in the app uses it.
//
// A reading has two parts, because each fails in a different way:
//   wall  the device clock (Date.now()). The user, a time-zone-free clock sync or a prank can move it in either direction.
//   mono  a monotonic clock (performance.now() or similar). It never jumps, but it may STOP while the device sleeps.
//
// How long someone has been idle is the LARGER of the two elapsed times, so a device that slept (wall moved on, mono stopped) or a
// clock set forwards counts as idle. A clock moved BACKWARDS by more than a small tolerance is not trusted at all: the verdict is
// "expired" (the safe direction is always to go back to the picker, never to stay open). Time spent in the background counts as idle
// time, because nobody was using the app. Returning to the foreground is NOT activity by itself.
//
// Once the verdict is "expired" it stays expired: a tap that arrives after the deadline (a timer that fired late) cannot revive it.

export const IDLE_LIMIT_MS = 10 * 60 * 1000;
export const WARNING_LEAD_MS = 60 * 1000;
// A wall clock that went backwards by no more than this is treated as ordinary clock correction (network time sync).
export const CLOCK_TOLERANCE_MS = 5 * 1000;

export type Reading = { wall: number; mono: number };
export type TimeSource = { read(): Reading };

// The real sources. performance.now() is used when it exists; without it the wall clock stands in for both (no sleep detection).
export const systemTime: TimeSource = {
  read() {
    const wall = Date.now();
    const perf = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : wall;
    return { wall, mono: perf };
  },
};

export type ExpiryReason =
  | 'idle' //          10 quiet minutes while the app was in use
  | 'away' //          the threshold was reached while the app was in the background
  | 'clock-changed'; // the device clock moved backwards, or the monotonic clock did: the elapsed time cannot be trusted

export type ClockState = {
  readonly lastActivity: Reading;
  readonly backgroundedAt: Reading | null;
  // Set the first time the verdict is "expired"; sticky.
  readonly expired: ExpiryReason | null;
};

export type Verdict =
  | { status: 'active'; remainingMs: number }
  // The "Still playing?" window: the limit is close. `remainingMs` is at most WARNING_LEAD_MS and above 0.
  | { status: 'warning'; remainingMs: number }
  | { status: 'expired'; reason: ExpiryReason };

export function startClock(at: Reading): ClockState {
  return { lastActivity: at, backgroundedAt: null, expired: null };
}

// How long it has been since `since`, and whether that elapsed time can be trusted (false = a clock moved backwards).
function elapsedSince(since: Reading, now: Reading): { idleMs: number; trusted: boolean } {
  const wall = now.wall - since.wall;
  const mono = now.mono - since.mono;
  if (!Number.isFinite(wall) || !Number.isFinite(mono)) return { idleMs: Infinity, trusted: false };
  if (mono < 0 || wall < -CLOCK_TOLERANCE_MS) return { idleMs: Infinity, trusted: false };
  return { idleMs: Math.max(wall, mono, 0), trusted: true };
}

export function evaluate(state: ClockState, now: Reading): Verdict {
  if (state.expired) return { status: 'expired', reason: state.expired };
  const { idleMs, trusted } = elapsedSince(state.lastActivity, now);
  if (!trusted) return { status: 'expired', reason: 'clock-changed' };
  if (idleMs >= IDLE_LIMIT_MS) return { status: 'expired', reason: state.backgroundedAt ? 'away' : 'idle' };
  const remainingMs = IDLE_LIMIT_MS - idleMs;
  return remainingMs <= WARNING_LEAD_MS ? { status: 'warning', remainingMs } : { status: 'active', remainingMs };
}

// Records the verdict if it is "expired", so it cannot be undone afterwards. Every transition below goes through this.
function settle(state: ClockState, now: Reading): ClockState {
  if (state.expired) return state;
  const verdict = evaluate(state, now);
  return verdict.status === 'expired' ? { ...state, expired: verdict.reason } : state;
}

// A meaningful interaction (a tap, a key, a drag, an answer to the "Still playing?" question). Ignored while the app is in the
// background (nothing can really be happening) and once the deadline has passed. Otherwise the idle time starts again from now.
export function recordActivity(state: ClockState, now: Reading): ClockState {
  const checked = settle(state, now);
  if (checked.expired || checked.backgroundedAt) return checked;
  return { ...checked, lastActivity: now };
}

// The app left the foreground. The idle time keeps counting.
export function enterBackground(state: ClockState, now: Reading): ClockState {
  const checked = settle(state, now);
  return checked.backgroundedAt ? checked : { ...checked, backgroundedAt: now };
}

// The app is back in the foreground. This is not activity: the idle time carries on from the last real interaction, so someone who
// returns after 10 quiet minutes is expired at once, and someone who returns after 3 has 7 left.
export function enterForeground(state: ClockState, now: Reading): { state: ClockState; verdict: Verdict } {
  const checked = settle(state, now);
  const next: ClockState = checked.backgroundedAt ? { ...checked, backgroundedAt: null } : checked;
  return { state: next, verdict: evaluate(next, now) };
}

// How long the live timer should sleep before it has to look again: until the "Still playing?" window opens, then until the limit.
// null = nothing to wait for (already expired, or the clock cannot be trusted).
export function nextCheckDelayMs(state: ClockState, now: Reading): number | null {
  const verdict = evaluate(state, now);
  if (verdict.status === 'expired') return null;
  if (verdict.status === 'warning') return verdict.remainingMs;
  return Math.max(0, verdict.remainingMs - WARNING_LEAD_MS);
}
