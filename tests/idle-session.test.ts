import { IDLE_LIMIT_MS, WARNING_LEAD_MS, type Reading } from '@/utils/activity-clock';
import { IdleController } from '@/utils/idle-session';
import type { LeaveResult } from '@/utils/family-session';

// Stage 4.3: the live inactivity controller, over a fake clock and a fake scheduler (no real time passes, no React, no storage).
// The arithmetic itself is tested in activity-clock.test.ts; these tests are about what the controller does with it.

const MIN = 60 * 1000;
const SEC = 1000;

function rig(options: { leave?: () => Promise<LeaveResult> } = {}) {
  let wall = 1_700_000_000_000;
  let mono = 5_000;
  const timers: { id: number; at: number; run: () => void }[] = [];
  let nextId = 1;
  const leave = jest.fn(options.leave ?? (async (): Promise<LeaveResult> => ({ ok: true, changed: true })));
  const controller = new IdleController({
    time: { read: (): Reading => ({ wall, mono }) },
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.push({ id, at: mono + ms, run });
      return id;
    },
    clearTimer: (handle) => {
      const i = timers.findIndex((timer) => timer.id === handle);
      if (i >= 0) timers.splice(i, 1);
    },
    leave,
  });
  const api = {
    controller,
    leave,
    timers,
    // time passes on both clocks, and every timer that comes due runs at its own moment, in order
    advance(ms: number) {
      const target = mono + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        const step = Math.max(0, due.at - mono);
        mono += step;
        wall += step;
        timers.splice(timers.indexOf(due), 1);
        due.run();
      }
      wall += target - mono;
      mono = target;
    },
    // the device slept: the wall clock moved on, the monotonic one stood still
    sleep(ms: number) {
      wall += ms;
    },
    setWall(value: number) {
      wall = value;
    },
    phase: () => controller.getSnapshot().phase,
  };
  controller.start();
  return api;
}
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('the warning and the timeout', () => {
  test('a fresh session is active and schedules its first look for the start of the warning', () => {
    const r = rig();
    expect(r.phase()).toBe('active');
    expect(r.timers).toHaveLength(1);
    expect(r.timers[0].at - 5_000).toBe(IDLE_LIMIT_MS - WARNING_LEAD_MS);
  });

  test('one millisecond before 9 minutes there is no warning; at exactly 9 minutes the warning shows', () => {
    const r = rig();
    r.advance(9 * MIN - 1);
    expect(r.phase()).toBe('active');
    r.advance(1);
    expect(r.phase()).toBe('warning');
    expect(r.leave).not.toHaveBeenCalled();
  });

  test('one millisecond before 10 minutes nothing has left; at exactly 10 minutes the leave starts, once', async () => {
    const r = rig();
    r.advance(10 * MIN - 1);
    expect(r.phase()).toBe('warning');
    expect(r.leave).not.toHaveBeenCalled();
    r.advance(1);
    expect(r.phase()).toBe('leaving');
    expect(r.leave).toHaveBeenCalledTimes(1);
    r.advance(30 * MIN);
    await flush();
    expect(r.leave).toHaveBeenCalledTimes(1); // never again
  });

  test('a successful leave leaves the controller finished: nothing is scheduled any more', async () => {
    const r = rig();
    r.advance(10 * MIN);
    await flush();
    expect(r.timers).toHaveLength(0);
    expect(r.phase()).toBe('leaving');
  });
});

describe('meaningful activity', () => {
  test('an interaction resets the whole 10 minutes, and keeps resetting it', () => {
    const r = rig();
    r.advance(8 * MIN);
    r.controller.activity();
    r.advance(8 * MIN);
    expect(r.phase()).toBe('active');
    r.controller.activity();
    r.advance(8 * MIN + 59 * SEC);
    expect(r.phase()).toBe('active');
    r.advance(1 * SEC);
    expect(r.phase()).toBe('warning'); // 9:00 after the last interaction
  });

  test('an interaction one millisecond before the deadline is in time, and the old deadline no longer applies', () => {
    const r = rig();
    r.advance(10 * MIN - 1);
    expect(r.phase()).toBe('warning');
    r.controller.activity(); // the warning is up, so only Continue playing counts (see below)
    expect(r.phase()).toBe('warning');
    r.controller.continuePlaying();
    expect(r.phase()).toBe('active');
    r.advance(1);
    expect(r.leave).not.toHaveBeenCalled();
    r.advance(9 * MIN - 2);
    expect(r.phase()).toBe('active');
    r.advance(1);
    expect(r.phase()).toBe('warning'); // 9 minutes after Continue playing
  });

  test('constant interaction (a game being played, a bathing control being held) never times out, however long it goes on', () => {
    const r = rig();
    for (let second = 0; second < 40 * 60; second += 1) {
      r.advance(250);
      r.controller.activity(); // a drag or a key repeat reports several times a second
      r.advance(750);
      r.controller.activity();
    }
    expect(r.phase()).toBe('active');
    expect(r.leave).not.toHaveBeenCalled();
  });

  test('interactions reported many times in the same second are one: the timer is not re-armed each time', () => {
    const r = rig();
    r.advance(1 * MIN);
    r.controller.activity();
    const timer = r.timers[0];
    for (let i = 0; i < 50; i += 1) r.controller.activity();
    expect(r.timers).toEqual([timer]);
  });

  test('passive things (anything that does not call activity) change nothing: animations and ticks do not reset or dismiss', () => {
    const r = rig();
    r.advance(9 * MIN);
    expect(r.phase()).toBe('warning');
    for (let i = 0; i < 200; i += 1) r.advance(500); // a long time of "animation" with nobody there
    expect(r.phase()).toBe('leaving');
  });
});

describe('the warning can only be answered by Continue playing', () => {
  test('stray interactions while it is up do not dismiss it', () => {
    const r = rig();
    r.advance(9 * MIN);
    for (let i = 0; i < 20; i += 1) {
      r.controller.activity();
      r.advance(2 * SEC);
    }
    expect(r.phase()).toBe('warning');
  });

  test('Continue playing starts a fresh 10 minutes', () => {
    const r = rig();
    r.advance(9 * MIN + 30 * SEC);
    r.controller.continuePlaying();
    expect(r.phase()).toBe('active');
    r.advance(8 * MIN + 59 * SEC);
    expect(r.phase()).toBe('active');
    r.advance(1 * SEC);
    expect(r.phase()).toBe('warning');
  });

  test('Continue playing pressed after the deadline is too late: the leave goes ahead', () => {
    const r = rig();
    r.advance(9 * MIN);
    r.sleep(2 * MIN); // the timer was held up (the device slept)
    r.controller.continuePlaying();
    expect(r.phase()).toBe('leaving');
    expect(r.leave).toHaveBeenCalledTimes(1);
  });

  test('Continue playing when no warning is showing does nothing', () => {
    const r = rig();
    r.advance(5 * MIN);
    r.controller.continuePlaying();
    r.advance(4 * MIN);
    expect(r.phase()).toBe('warning'); // 9 minutes since the start: the earlier press did not reset anything
  });
});

describe('the app in the background', () => {
  test('going to the background stops the timer and releases nothing, however long it lasts', () => {
    const r = rig();
    r.advance(2 * MIN);
    r.controller.appState('background');
    expect(r.timers).toHaveLength(0);
    r.advance(3 * 60 * MIN);
    expect(r.leave).not.toHaveBeenCalled();
    expect(r.phase()).toBe('active');
  });

  test('back after 10 minutes or more since the last interaction: the leave starts; the foreground itself is not activity', () => {
    const r = rig();
    r.advance(1 * MIN);
    r.controller.activity();
    r.controller.appState('background');
    r.advance(10 * MIN);
    r.controller.appState('active');
    expect(r.leave).toHaveBeenCalledTimes(1);
    expect(r.phase()).toBe('leaving');
  });

  test('back after exactly 10 minutes counts, and after 1 millisecond less it does not', () => {
    const early = rig();
    early.controller.appState('background');
    early.advance(10 * MIN - 1);
    early.controller.appState('active');
    expect(early.leave).not.toHaveBeenCalled();
    expect(early.phase()).toBe('warning');
    const exact = rig();
    exact.controller.appState('background');
    exact.advance(10 * MIN);
    exact.controller.appState('active');
    expect(exact.leave).toHaveBeenCalledTimes(1);
  });

  test('back after less than 10 minutes keeps the profile, and the remaining time carries on from the last interaction', () => {
    const r = rig();
    r.controller.appState('background');
    r.advance(3 * MIN);
    r.controller.appState('active');
    expect(r.leave).not.toHaveBeenCalled();
    expect(r.phase()).toBe('active');
    r.advance(6 * MIN);
    expect(r.phase()).toBe('warning'); // 9 minutes since the start, not since coming back
  });

  test('back in the last minute: the warning shows at once', () => {
    const r = rig();
    r.controller.appState('background');
    r.advance(9 * MIN + 10 * SEC);
    r.controller.appState('active');
    expect(r.phase()).toBe('warning');
  });

  test('interactions while in the background are ignored, and repeating the same app state changes nothing', () => {
    const r = rig();
    r.controller.appState('background');
    r.controller.appState('background');
    r.advance(5 * MIN);
    r.controller.activity();
    r.controller.appState('active');
    r.controller.appState('active');
    r.advance(4 * MIN);
    expect(r.phase()).toBe('warning'); // the ignored interaction did not reset anything
  });

  test('iOS "inactive" (a system sheet) is away too', () => {
    const r = rig();
    r.controller.appState('inactive');
    r.advance(11 * MIN);
    r.controller.appState('active');
    expect(r.leave).toHaveBeenCalledTimes(1);
  });
});

describe('device sleep and clock problems are handled conservatively', () => {
  test('a device that slept past the limit leaves at the next look, even though the monotonic clock barely moved', () => {
    const r = rig();
    r.advance(1 * MIN);
    r.sleep(15 * MIN);
    r.advance(8 * MIN); // the timer fires at its own time
    expect(r.leave).toHaveBeenCalledTimes(1);
  });

  test('a clock set back by hours leaves, and a clock set back by a second or two does not', () => {
    const back = rig();
    back.advance(1 * MIN);
    back.setWall(1_700_000_000_000 - 3 * 60 * MIN);
    back.advance(8 * MIN);
    expect(back.leave).toHaveBeenCalledTimes(1);
    const tiny = rig();
    tiny.advance(1 * MIN);
    tiny.setWall(1_700_000_000_000 + 1 * MIN - 2 * SEC);
    tiny.advance(8 * MIN - 1);
    expect(tiny.leave).not.toHaveBeenCalled();
  });

  test('a clock set forwards past the limit leaves; interactions after that cannot undo it', () => {
    const r = rig();
    r.advance(1 * MIN);
    r.setWall(1_700_000_000_000 + 60 * MIN);
    r.controller.activity();
    expect(r.leave).toHaveBeenCalledTimes(1);
  });

  test('nonsense readings leave rather than keep the profile open', () => {
    const r = rig();
    r.advance(1 * MIN);
    r.setWall(Number.NaN);
    r.controller.activity();
    r.advance(1 * SEC);
    r.controller.check();
    expect(r.leave).toHaveBeenCalledTimes(1);
  });
});

describe('when leaving does not work', () => {
  test('the profile stays open, the failure is kept for the dialog, and nothing retries by itself', async () => {
    const r = rig({ leave: async () => ({ ok: false, reason: 'unsaved-changes', keys: ['k'] }) });
    r.advance(10 * MIN);
    await flush();
    expect(r.phase()).toBe('failed');
    expect(r.controller.getSnapshot().failure).toBe('unsaved-changes');
    r.advance(60 * MIN);
    r.controller.check();
    r.controller.activity();
    await flush();
    expect(r.leave).toHaveBeenCalledTimes(1); // no automatic retry, no loop
    expect(r.timers).toHaveLength(0);
  });

  test('Try again leaves again, once, and a second failure is shown again', async () => {
    const r = rig({ leave: async () => ({ ok: false, reason: 'timeout' }) });
    r.advance(10 * MIN);
    await flush();
    r.controller.retry();
    expect(r.leave).toHaveBeenCalledTimes(2);
    await flush();
    expect(r.phase()).toBe('failed');
    expect(r.controller.getSnapshot().failure).toBe('timeout');
  });

  test('Try again that works finishes the session', async () => {
    let works = false;
    const r = rig({ leave: async () => (works ? { ok: true, changed: true } : { ok: false, reason: 'busy' }) });
    r.advance(10 * MIN);
    await flush();
    works = true;
    r.controller.retry();
    await flush();
    expect(r.phase()).toBe('leaving');
    expect(r.leave).toHaveBeenCalledTimes(2);
  });

  test('Keep playing starts a fresh 10 minutes: no immediate retry, no timeout loop, and the warning comes back after 9', async () => {
    const r = rig({ leave: async () => ({ ok: false, reason: 'unsaved-changes' }) });
    r.advance(10 * MIN);
    await flush();
    r.controller.keepPlaying();
    expect(r.phase()).toBe('active');
    r.advance(1);
    r.controller.check();
    expect(r.leave).toHaveBeenCalledTimes(1);
    r.advance(9 * MIN - 2);
    expect(r.phase()).toBe('active');
    r.advance(1);
    expect(r.phase()).toBe('warning');
    r.advance(1 * MIN);
    await flush();
    expect(r.leave).toHaveBeenCalledTimes(2); // only now, ten quiet minutes after Keep playing
  });

  test('a leave that throws is a failure too, never a success', async () => {
    const r = rig({
      leave: async () => {
        throw new Error('boom');
      },
    });
    r.advance(10 * MIN);
    await flush();
    expect(r.phase()).toBe('failed');
    expect(r.controller.getSnapshot().failure).toBe('storage');
  });

  test('Try again and Keep playing do nothing when there is no failure to answer', () => {
    const r = rig();
    r.controller.retry();
    r.controller.keepPlaying();
    expect(r.leave).not.toHaveBeenCalled();
    expect(r.phase()).toBe('active');
  });

  test('the background does not restart anything while the failed dialog waits', async () => {
    const r = rig({ leave: async () => ({ ok: false, reason: 'timeout' }) });
    r.advance(10 * MIN);
    await flush();
    r.controller.appState('background');
    r.advance(30 * MIN);
    r.controller.appState('active');
    expect(r.phase()).toBe('failed');
    expect(r.leave).toHaveBeenCalledTimes(1);
  });
});

describe('subscribing and stopping', () => {
  test('listeners hear every phase change once, and the snapshot is the same object until something changes', () => {
    const r = rig();
    const seen: string[] = [];
    const off = r.controller.subscribe(() => seen.push(r.phase()));
    const first = r.controller.getSnapshot();
    expect(r.controller.getSnapshot()).toBe(first);
    r.advance(9 * MIN);
    r.advance(1 * MIN);
    off();
    expect(seen).toEqual(['warning', 'leaving']);
  });

  test('a stopped controller does nothing: no timer, no leave, no change', () => {
    const r = rig();
    r.controller.stop();
    expect(r.timers).toHaveLength(0);
    r.advance(20 * MIN);
    r.controller.check();
    r.controller.activity();
    expect(r.leave).not.toHaveBeenCalled();
    expect(r.phase()).toBe('active');
  });
});

describe('profile sessions', () => {
  test('a controller from a profile session that is over does nothing, even if its timer fires or the person taps', async () => {
    const profiles = require('@/utils/profiles') as typeof import('@/utils/profiles');
    await profiles.ensureProfilesReady();
    const r = rig();
    r.advance(8 * MIN);
    await profiles.releaseActiveProfile(); // the person left (the session is over); the controller was not stopped yet
    r.advance(5 * MIN);
    r.controller.check();
    r.controller.activity();
    r.controller.appState('background');
    expect(r.leave).not.toHaveBeenCalled(); // a late timer from the old session never touches the next profile
    expect(r.phase()).toBe('active');
  });
});
