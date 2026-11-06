import {
  CLOCK_TOLERANCE_MS,
  IDLE_LIMIT_MS,
  WARNING_LEAD_MS,
  enterBackground,
  enterForeground,
  evaluate,
  nextCheckDelayMs,
  recordActivity,
  startClock,
  systemTime,
  type ClockState,
  type Reading,
} from '@/utils/activity-clock';

// Stage 4.0: the pure inactivity clock. No real clock, timer or storage is involved: every test hands in the readings.

const MIN = 60 * 1000;
const SEC = 1000;
const T = 1_700_000_000_000;
// A reading `ms` after the start, with the wall and monotonic clocks agreeing (override either to simulate a sleep or a clock change).
const at = (ms: number, over: Partial<Reading> = {}): Reading => ({ wall: T + ms, mono: 5_000 + ms, ...over });
const fresh = () => startClock(at(0));

describe('the idle limit', () => {
  test('the limit is fixed at 10 minutes and the warning window is the last 60 seconds', () => {
    expect(IDLE_LIMIT_MS).toBe(10 * MIN);
    expect(WARNING_LEAD_MS).toBe(MIN);
  });

  test('a fresh clock is active with the whole limit left', () => {
    expect(evaluate(fresh(), at(0))).toEqual({ status: 'active', remainingMs: IDLE_LIMIT_MS });
  });

  test('one millisecond before the warning window it is still plain active', () => {
    expect(evaluate(fresh(), at(IDLE_LIMIT_MS - WARNING_LEAD_MS - 1))).toEqual({ status: 'active', remainingMs: WARNING_LEAD_MS + 1 });
  });

  test('exactly 60 seconds before the limit the warning starts', () => {
    expect(evaluate(fresh(), at(IDLE_LIMIT_MS - WARNING_LEAD_MS))).toEqual({ status: 'warning', remainingMs: WARNING_LEAD_MS });
  });

  test('one millisecond before the limit it is still the warning, with 1 ms left', () => {
    expect(evaluate(fresh(), at(IDLE_LIMIT_MS - 1))).toEqual({ status: 'warning', remainingMs: 1 });
  });

  test('exactly 10 minutes of inactivity is expired (the limit itself counts)', () => {
    expect(evaluate(fresh(), at(IDLE_LIMIT_MS))).toEqual({ status: 'expired', reason: 'idle' });
  });

  test('well past the limit it is expired too', () => {
    expect(evaluate(fresh(), at(IDLE_LIMIT_MS * 3))).toEqual({ status: 'expired', reason: 'idle' });
  });
});

describe('activity', () => {
  test('an interaction just before the deadline starts the full 10 minutes again', () => {
    const state = recordActivity(fresh(), at(IDLE_LIMIT_MS - 1));
    expect(evaluate(state, at(IDLE_LIMIT_MS - 1))).toEqual({ status: 'active', remainingMs: IDLE_LIMIT_MS });
    expect(evaluate(state, at(IDLE_LIMIT_MS))).toMatchObject({ status: 'active' }); // the old deadline no longer applies
    expect(evaluate(state, at(IDLE_LIMIT_MS - 1 + IDLE_LIMIT_MS))).toEqual({ status: 'expired', reason: 'idle' });
  });

  test('an interaction inside the warning window dismisses the warning', () => {
    const state = recordActivity(fresh(), at(IDLE_LIMIT_MS - 30 * SEC));
    expect(evaluate(state, at(IDLE_LIMIT_MS - 30 * SEC)).status).toBe('active');
  });

  test('an interaction exactly at the deadline is too late: expiry cannot be undone', () => {
    const state = recordActivity(fresh(), at(IDLE_LIMIT_MS));
    expect(evaluate(state, at(IDLE_LIMIT_MS))).toEqual({ status: 'expired', reason: 'idle' });
    expect(evaluate(state, at(IDLE_LIMIT_MS + 1))).toEqual({ status: 'expired', reason: 'idle' });
  });

  test('once expired, later activity never revives the clock', () => {
    let state = recordActivity(fresh(), at(IDLE_LIMIT_MS + 5)); // records the expiry
    state = recordActivity(state, at(IDLE_LIMIT_MS + 10));
    expect(evaluate(state, at(IDLE_LIMIT_MS + 11))).toEqual({ status: 'expired', reason: 'idle' });
  });

  test('many interactions keep it active indefinitely, each one restarting the count', () => {
    let state = fresh();
    for (let minute = 1; minute <= 60; minute += 1) {
      state = recordActivity(state, at(minute * 9 * MIN));
      expect(evaluate(state, at(minute * 9 * MIN)).status).toBe('active');
    }
  });

  test('is immutable: recording activity returns a new state and leaves the old one alone', () => {
    const before = fresh();
    const after = recordActivity(before, at(MIN));
    expect(before.lastActivity).toEqual(at(0));
    expect(after.lastActivity).toEqual(at(MIN));
  });
});

describe('the background', () => {
  test('activity while the app is in the background is ignored', () => {
    let state = enterBackground(fresh(), at(MIN));
    state = recordActivity(state, at(2 * MIN));
    expect(state.lastActivity).toEqual(at(0));
  });

  test('coming back to the foreground is not activity: the idle time carries on from the last real interaction', () => {
    let state = recordActivity(fresh(), at(MIN));
    state = enterBackground(state, at(2 * MIN));
    const back = enterForeground(state, at(5 * MIN));
    expect(back.verdict).toEqual({ status: 'active', remainingMs: IDLE_LIMIT_MS - 4 * MIN });
    expect(back.state.backgroundedAt).toBeNull();
    expect(back.state.lastActivity).toEqual(at(MIN));
  });

  test('away for less than the limit does not expire; the remaining time can already be the warning', () => {
    const state = enterBackground(fresh(), at(1 * MIN));
    expect(enterForeground(state, at(9 * MIN + 30 * SEC)).verdict).toEqual({ status: 'warning', remainingMs: 30 * SEC });
  });

  test('back in the foreground after exactly the limit since the last interaction: expired as "away"', () => {
    const state = enterBackground(fresh(), at(MIN));
    expect(enterForeground(state, at(IDLE_LIMIT_MS)).verdict).toEqual({ status: 'expired', reason: 'away' });
  });

  test('back after a long time away: expired, and it stays expired', () => {
    const state = enterBackground(fresh(), at(MIN));
    const back = enterForeground(state, at(3 * 60 * MIN));
    expect(back.verdict).toEqual({ status: 'expired', reason: 'away' });
    expect(evaluate(recordActivity(back.state, at(3 * 60 * MIN + 1)), at(3 * 60 * MIN + 2))).toEqual({ status: 'expired', reason: 'away' });
  });

  test('going to the background twice in a row keeps the first moment', () => {
    const once = enterBackground(fresh(), at(MIN));
    const twice = enterBackground(once, at(2 * MIN));
    expect(twice.backgroundedAt).toEqual(at(MIN));
  });

  test('coming to the foreground when it never left the foreground changes nothing', () => {
    const back = enterForeground(fresh(), at(MIN));
    expect(back.state).toEqual(fresh());
    expect(back.verdict).toEqual({ status: 'active', remainingMs: IDLE_LIMIT_MS - MIN });
  });

  test('the expiry reason is "idle" when the app was in the foreground the whole time', () => {
    expect(evaluate(fresh(), at(IDLE_LIMIT_MS + MIN))).toMatchObject({ reason: 'idle' });
  });
});

describe('device sleep', () => {
  test('a device that slept (the wall clock moved on, the monotonic clock stopped) counts the sleep as idle time', () => {
    // 1 minute of monotonic time, 15 minutes of wall time
    expect(evaluate(fresh(), at(MIN, { wall: T + 15 * MIN }))).toEqual({ status: 'expired', reason: 'idle' });
  });

  test('a short sleep only shortens what is left', () => {
    expect(evaluate(fresh(), at(MIN, { wall: T + 4 * MIN }))).toEqual({ status: 'active', remainingMs: IDLE_LIMIT_MS - 4 * MIN });
  });

  test('a sleep that ends exactly at the limit expires', () => {
    expect(evaluate(fresh(), at(0, { wall: T + IDLE_LIMIT_MS })).status).toBe('expired');
  });

  test('a sleep with the app in the background is reported as away', () => {
    const state = enterBackground(fresh(), at(MIN));
    expect(enterForeground(state, at(2 * MIN, { wall: T + IDLE_LIMIT_MS + 5 * MIN })).verdict).toEqual({ status: 'expired', reason: 'away' });
  });
});

describe('clock changes', () => {
  test('a wall clock set far backwards is not trusted: expired as clock-changed', () => {
    expect(evaluate(fresh(), at(MIN, { wall: T - 3 * 60 * MIN }))).toEqual({ status: 'expired', reason: 'clock-changed' });
  });

  test('a backwards step just beyond the tolerance is not trusted', () => {
    expect(evaluate(fresh(), at(0, { wall: T - CLOCK_TOLERANCE_MS - 1 }))).toEqual({ status: 'expired', reason: 'clock-changed' });
  });

  test('a small correction backwards (within the tolerance) is ordinary: the monotonic time decides', () => {
    expect(evaluate(fresh(), at(2 * MIN, { wall: T - 3 * SEC }))).toEqual({ status: 'active', remainingMs: IDLE_LIMIT_MS - 2 * MIN });
    expect(evaluate(fresh(), at(0, { wall: T - CLOCK_TOLERANCE_MS }))).toEqual({ status: 'active', remainingMs: IDLE_LIMIT_MS });
  });

  test('a wall clock set forwards past the limit expires; a forward jump of a few minutes only shortens what is left', () => {
    expect(evaluate(fresh(), at(MIN, { wall: T + 6 * 60 * MIN }))).toEqual({ status: 'expired', reason: 'idle' });
    expect(evaluate(fresh(), at(MIN, { wall: T + 7 * MIN }))).toEqual({ status: 'active', remainingMs: 3 * MIN });
  });

  test('a monotonic clock that goes backwards (it should never) is not trusted', () => {
    expect(evaluate(fresh(), { wall: T + MIN, mono: 5_000 - 1 })).toEqual({ status: 'expired', reason: 'clock-changed' });
  });

  test('non-numeric readings are not trusted (fails toward the picker, never toward staying open)', () => {
    expect(evaluate(fresh(), { wall: Number.NaN, mono: 5_000 })).toEqual({ status: 'expired', reason: 'clock-changed' });
    expect(evaluate(fresh(), { wall: T, mono: Number.POSITIVE_INFINITY })).toEqual({ status: 'expired', reason: 'clock-changed' });
  });

  test('a clock change is remembered: the clock set back afterwards does not undo the expiry', () => {
    const state = recordActivity(fresh(), at(MIN, { wall: T - 3 * 60 * MIN })); // records clock-changed
    expect(evaluate(state, at(2 * MIN))).toEqual({ status: 'expired', reason: 'clock-changed' });
  });

  test('a wall clock that moves backwards while the app is in the background expires on return', () => {
    const state = enterBackground(fresh(), at(MIN));
    expect(enterForeground(state, at(2 * MIN, { wall: T - 60 * MIN })).verdict).toEqual({ status: 'expired', reason: 'clock-changed' });
  });
});

describe('when the live timer should look again', () => {
  test('sleeps until the warning window opens, then until the limit, then nothing', () => {
    const state: ClockState = fresh();
    expect(nextCheckDelayMs(state, at(0))).toBe(IDLE_LIMIT_MS - WARNING_LEAD_MS);
    expect(nextCheckDelayMs(state, at(4 * MIN))).toBe(IDLE_LIMIT_MS - WARNING_LEAD_MS - 4 * MIN);
    expect(nextCheckDelayMs(state, at(IDLE_LIMIT_MS - WARNING_LEAD_MS))).toBe(WARNING_LEAD_MS);
    expect(nextCheckDelayMs(state, at(IDLE_LIMIT_MS - 10 * SEC))).toBe(10 * SEC);
    expect(nextCheckDelayMs(state, at(IDLE_LIMIT_MS))).toBeNull();
  });

  test('nothing to wait for once the clock cannot be trusted', () => {
    expect(nextCheckDelayMs(fresh(), at(0, { wall: T - 60 * MIN }))).toBeNull();
  });

  test('activity moves the next look forwards', () => {
    const state = recordActivity(fresh(), at(8 * MIN));
    expect(nextCheckDelayMs(state, at(8 * MIN))).toBe(IDLE_LIMIT_MS - WARNING_LEAD_MS);
  });
});

describe('the real time source', () => {
  test('reads both clocks, and the monotonic one never goes backwards between two reads', () => {
    const first = systemTime.read();
    const second = systemTime.read();
    expect(Number.isFinite(first.wall)).toBe(true);
    expect(Number.isFinite(first.mono)).toBe(true);
    expect(second.mono).toBeGreaterThanOrEqual(first.mono);
  });

  test('falls back to the wall clock for both readings when no monotonic clock exists', () => {
    const original = (globalThis as { performance?: unknown }).performance;
    (globalThis as { performance?: unknown }).performance = undefined;
    try {
      const reading = systemTime.read();
      expect(reading.mono).toBe(reading.wall);
    } finally {
      (globalThis as { performance?: unknown }).performance = original;
    }
  });
});

describe('purity', () => {
  test('the module reads no real clock by itself: the same readings always give the same verdict', () => {
    const state = fresh();
    for (let i = 0; i < 3; i += 1) expect(evaluate(state, at(8 * MIN))).toEqual({ status: 'active', remainingMs: 2 * MIN });
  });

  test('the source file has no timers, storage, React or app-state imports', () => {
    const fs = require('fs');
    const path = require('path');
    const code = (fs.readFileSync(path.resolve('src/utils/activity-clock.ts'), 'utf8') as string).replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/setTimeout|setInterval|AsyncStorage|from 'react'|AppState|require\(/);
    expect(code.match(/Date\.now\(\)/g)).toHaveLength(1); // the only real clock read lives in systemTime
  });
});
