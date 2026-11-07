import { useSyncExternalStore } from 'react';

import {
  enterBackground,
  enterForeground,
  evaluate,
  nextCheckDelayMs,
  recordActivity,
  startClock,
  systemTime,
  type ClockState,
  type TimeSource,
  type Verdict,
} from '@/utils/activity-clock';
import { leaveProfile, type LeaveResult } from '@/utils/family-session';
import { captureProfileOwner, isProfileOwner } from '@/utils/profiles';

// The live inactivity rule (family mode only; Stage 4.3): after 10 minutes without a meaningful interaction the app goes back to the
// "Who's playing today?" picker, through the same safe leave as the switch chip (leaveProfile: the parent area locks first, pending
// saves finish, the profile is released only when that really worked). One minute before, a "Still playing?" warning shows.
//
// The arithmetic is in @/utils/activity-clock.ts (pure). This file connects it to the app: the readings of the clock, one timer that
// only ever sleeps until the next moment that matters, the app going to the background and coming back, and what the screens show.
//
//   phase 'active'   counting; nothing shown
//   phase 'warning'  the "Still playing?" question is up (the last minute); only pressing Continue playing resets the clock, so no
//                    passive animation and no stray tap can dismiss it
//   phase 'leaving'  the leave has started (the gate shows its cover)
//   phase 'failed'   the leave did not work: the person is still in their profile, with Try again and Keep playing. Nothing retries
//                    by itself; Keep playing starts a fresh 10 minutes, so there is never a timeout loop
//
// Meaningful interactions are reported by the screens' tracker (see @/components/idle-guard.tsx). Passive things (animations, the pet
// ticking, timers, notifications) never call `activity`. Returning to the foreground is not activity either.

export type IdlePhase = 'active' | 'warning' | 'leaving' | 'failed';
export type IdleSnapshot = { readonly phase: IdlePhase; readonly failure: string | null };

export type IdleOptions = {
  time?: TimeSource;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  leave?: () => Promise<LeaveResult>;
};

// Interactions closer together than this are one (the tracker sees many events per second while a finger drags or a key repeats).
const ACTIVITY_THROTTLE_MS = 1000;

export class IdleController {
  private readonly time: TimeSource;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly leave: () => Promise<LeaveResult>;
  private readonly owner = captureProfileOwner();
  private clock: ClockState;
  private handle: unknown = null;
  private background = false;
  private stopped = false;
  private lastActivityMono = Number.NEGATIVE_INFINITY;
  private snapshot: IdleSnapshot = { phase: 'active', failure: null };
  private readonly listeners = new Set<() => void>();

  constructor(options: IdleOptions = {}) {
    this.time = options.time ?? systemTime;
    this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.leave = options.leave ?? (() => leaveProfile());
    this.clock = startClock(this.time.read());
  }

  // ---- what the screens read

  getSnapshot = (): IdleSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(phase: IdlePhase, failure: string | null = null): void {
    if (this.snapshot.phase === phase && this.snapshot.failure === failure) return;
    this.snapshot = { phase, failure };
    this.listeners.forEach((listener) => listener());
  }

  // ---- life

  start(): void {
    this.stopped = false;
    this.clock = startClock(this.time.read());
    this.set('active');
    this.arm();
  }

  stop(): void {
    this.stopped = true;
    this.disarm();
  }

  // The profile session this controller belongs to is over (somebody left, or someone else came): nothing here does anything.
  private alive(): boolean {
    return !this.stopped && isProfileOwner(this.owner);
  }

  // ---- interactions

  // A meaningful interaction (a tap, a key, a drag, typing, scrolling by the person). Ignored while the warning is up (only Continue
  // playing answers it), while leaving, in the background, and after the deadline has passed.
  activity(): void {
    if (!this.alive() || this.background || this.snapshot.phase !== 'active') return;
    const now = this.time.read();
    if (now.mono - this.lastActivityMono < ACTIVITY_THROTTLE_MS && now.mono >= this.lastActivityMono) return;
    this.lastActivityMono = now.mono;
    this.clock = recordActivity(this.clock, now);
    this.apply(evaluate(this.clock, now));
  }

  // The person pressed "Continue playing" on the warning: the clock starts again (unless the deadline already passed).
  continuePlaying(): void {
    if (!this.alive() || this.snapshot.phase !== 'warning') return;
    const now = this.time.read();
    this.lastActivityMono = now.mono;
    this.clock = recordActivity(this.clock, now);
    const verdict = evaluate(this.clock, now);
    if (verdict.status === 'expired') this.apply(verdict);
    else {
      this.set('active');
      this.arm();
    }
  }

  // ---- leaving failed

  // "Try again" on the failed dialog.
  retry(): void {
    if (!this.alive() || this.snapshot.phase !== 'failed') return;
    this.beginLeave();
  }

  // "Keep playing" on the failed dialog: a completely fresh 10 minutes (the expired clock is thrown away), so there is no retry loop.
  keepPlaying(): void {
    if (!this.alive() || this.snapshot.phase !== 'failed') return;
    const now = this.time.read();
    this.clock = startClock(now);
    this.lastActivityMono = now.mono;
    this.set('active');
    this.arm();
  }

  // ---- the app going to the background and coming back

  // `state` is React Native's AppState. 'background' and 'inactive' count as away (parent access locks on its own, elsewhere).
  appState(state: string): void {
    if (!this.alive()) return;
    if (state !== 'active' && state !== 'background' && state !== 'inactive') return; // 'unknown' and the like say nothing about where the person is
    if (state !== 'active') {
      if (this.background) return;
      this.background = true;
      this.clock = enterBackground(this.clock, this.time.read());
      this.disarm();
      return;
    }
    if (!this.background) return;
    this.background = false;
    const back = enterForeground(this.clock, this.time.read());
    this.clock = back.state;
    // Coming back is not activity: the idle time carries on from the last real interaction.
    if (this.snapshot.phase === 'active' || this.snapshot.phase === 'warning') this.apply(back.verdict);
    else if (this.snapshot.phase === 'failed') return; // the failed dialog is still waiting for the person
  }

  // ---- the timer

  // Looks at the clock now (the timer calls this; so do tests and the preview).
  check(): void {
    // Cancels the pending timer rather than just forgetting it: when the timer itself calls this it has already fired (nothing to cancel),
    // but a direct call (the preview, tests) must not leave the old timer behind to fire later and be forgotten again.
    this.disarm();
    if (!this.alive() || this.background) return;
    if (this.snapshot.phase !== 'active' && this.snapshot.phase !== 'warning') return;
    this.apply(evaluate(this.clock, this.time.read()));
  }

  private apply(verdict: Verdict): void {
    if (verdict.status === 'expired') {
      this.disarm();
      this.beginLeave();
      return;
    }
    if (verdict.status === 'warning') this.set('warning');
    else if (this.snapshot.phase === 'warning') this.set('warning'); // never taken back by anything but Continue playing
    this.arm();
  }

  private arm(): void {
    this.disarm();
    if (!this.alive() || this.background) return;
    const delay = nextCheckDelayMs(this.clock, this.time.read());
    if (delay === null) return;
    this.handle = this.setTimer(() => this.check(), Math.max(0, delay));
  }

  private disarm(): void {
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = null;
  }

  // ---- leaving

  private beginLeave(): void {
    if (!this.alive() || this.snapshot.phase === 'leaving') return;
    this.set('leaving');
    void this.leave().then(
      (result) => this.leftWith(result),
      () => this.leftWith({ ok: false, reason: 'storage' })
    );
  }

  private leftWith(result: LeaveResult): void {
    if (this.stopped) return;
    if (result.ok) return; // the picker took over: the shell (and with it this controller) goes away
    // Still in the profile. Nothing starts again by itself: the person chooses Try again or Keep playing.
    this.disarm();
    this.set('failed', result.reason);
  }
}

// ---------------------------------------------------------------------------------------------------------
// the one running controller, so the screens' tracker can report interactions without knowing about it

let running: IdleController | null = null;

export function startIdleSession(options: IdleOptions = {}): IdleController {
  running?.stop();
  const controller = new IdleController(options);
  running = controller;
  controller.start();
  return controller;
}

export function stopIdleSession(controller: IdleController): void {
  controller.stop();
  if (running === controller) running = null;
}

// Called by the tracker for every meaningful interaction; does nothing when no idle rule is running (family mode off, no children).
export function notifyUserActivity(): void {
  running?.activity();
}

export function getIdleController(): IdleController | null {
  return running;
}

const NONE: IdleSnapshot = { phase: 'active', failure: null };
const noSubscribe = () => () => undefined;

// What the warning and the failed-return dialog show. With no rule running it is always 'active'.
export function useIdleSnapshot(controller: IdleController | null): IdleSnapshot {
  return useSyncExternalStore(
    controller ? controller.subscribe : noSubscribe,
    controller ? controller.getSnapshot : () => NONE,
    controller ? controller.getSnapshot : () => NONE
  );
}
