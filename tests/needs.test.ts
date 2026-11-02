import {
  CLEANLINESS_DECAY_PER_HOUR, DIRTY_ENERGY_PENALTY_PER_HOUR, ENERGY_DECAY_PER_HOUR, ENERGY_RECOVERY_PER_HOUR,
  HAPPINESS_DECAY_PER_HOUR, HUNGER_DECAY_PER_HOUR, applyHungerDecay, applyNeedDecay,
  applyPetNeedsUpdate, getElapsedHoursSince, isPetDirty, resolvePetNeedsAcrossBedtime,
} from '@/utils/pet-needs-core';
import { getNextBedtimeBoundary, isWithinBedtimeWindow } from '@/utils/pet-bedtime';
import { local, profile } from './helpers';

describe('need decay rates (pinned)', () => {
  test('rates', () => {
    expect(HUNGER_DECAY_PER_HOUR).toBe(2.5);
    expect(CLEANLINESS_DECAY_PER_HOUR).toBe(1.25);
    expect(HAPPINESS_DECAY_PER_HOUR).toBeCloseTo(5 / 6, 12);
    expect(ENERGY_DECAY_PER_HOUR).toBeCloseTo(5 / 3, 12);
    expect(ENERGY_RECOVERY_PER_HOUR).toBe(10);
    expect(DIRTY_ENERGY_PENALTY_PER_HOUR).toBeCloseTo(5 / 6, 12);
  });

  test('awake decay over 2 hours', () => {
    const p = profile({ lastUpdatedAt: local(2026, 3, 10, 10).toISOString() });
    const r = applyPetNeedsUpdate(p, local(2026, 3, 10, 12));
    expect(r.hunger).toBeCloseTo(95, 9);
    expect(r.cleanliness).toBeCloseTo(97.5, 9);
    expect(r.happiness).toBeCloseTo(100 - (5 / 6) * 2, 9);
    expect(r.energy).toBeCloseTo(100 - (5 / 3) * 2, 9);
  });

  test('values clamp at 0 and at 100', () => {
    expect(applyNeedDecay(5, 10, 10)).toBe(0);
    expect(applyNeedDecay(95, -10, 10)).toBe(100);
  });

  test('sleeping pauses hunger/cleanliness/happiness and recovers energy', () => {
    const p = profile({ isSleeping: true, energy: 20, lastUpdatedAt: local(2026, 3, 10, 21).toISOString() });
    const r = applyPetNeedsUpdate(p, local(2026, 3, 10, 22));
    expect(r.hunger).toBe(100);
    expect(r.cleanliness).toBe(100);
    expect(r.happiness).toBe(100);
    expect(r.energy).toBe(30);
  });

  test('dirty is one combined condition and adds an extra happiness penalty', () => {
    const piles = Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, size: 'small' as const, cleanupRemaining: 1, createdAt: '', offsetXPx: 0, offsetYPx: 0 }));
    expect(isPetDirty(profile())).toBe(false);
    expect(isPetDirty(profile({ needsBath: true }))).toBe(true);
    expect(isPetDirty(profile({ cleanliness: 20 }))).toBe(true);
    expect(isPetDirty(profile({ poopPiles: piles }))).toBe(true);
    const a = applyPetNeedsUpdate(profile({ needsBath: true, lastUpdatedAt: local(2026, 3, 10, 10).toISOString() }), local(2026, 3, 10, 12));
    expect(a.happiness).toBeCloseTo(100 - (5 / 6) * 2 * 2, 9);
  });

  test('returns the same object when nothing changes', () => {
    const p = profile({ hunger: 0, lastUpdatedAt: local(2026, 3, 10, 10).toISOString() });
    expect(applyHungerDecay(p, local(2026, 3, 10, 11))).toBe(p);
  });
});

describe('device clock edge cases (needs)', () => {
  test('clock earlier than the last save: no backwards decay', () => {
    expect(getElapsedHoursSince('2026-03-10T15:00:00.000Z', new Date('2026-03-10T10:00:00.000Z'))).toBe(0);
    const p = profile({ lastUpdatedAt: '2026-03-10T15:00:00.000Z', hunger: 50 });
    expect(applyPetNeedsUpdate(p, new Date('2026-03-09T00:00:00.000Z'))).toBe(p);
  });
  test('malformed timestamp means no time passed', () => {
    expect(getElapsedHoursSince('not a date', new Date())).toBe(0);
    const p = profile({ lastUpdatedAt: 'garbage', hunger: 50 });
    expect(applyPetNeedsUpdate(p, new Date())).toBe(p);
  });
});

describe('bedtime window (8 PM - 8 AM local)', () => {
  test('boundaries', () => {
    expect(isWithinBedtimeWindow(local(2026, 3, 10, 19, 59))).toBe(false);
    expect(isWithinBedtimeWindow(local(2026, 3, 10, 20, 0))).toBe(true);
    expect(isWithinBedtimeWindow(local(2026, 3, 11, 7, 59))).toBe(true);
    expect(isWithinBedtimeWindow(local(2026, 3, 11, 8, 0))).toBe(false);
    expect(isWithinBedtimeWindow(local(2026, 3, 11, 0, 0))).toBe(true);
  });
  test('next boundary is strictly after the input', () => {
    expect(getNextBedtimeBoundary(local(2026, 3, 10, 8, 0))).toEqual(local(2026, 3, 10, 20, 0));
    expect(getNextBedtimeBoundary(local(2026, 3, 10, 20, 0))).toEqual(local(2026, 3, 11, 8, 0));
    expect(getNextBedtimeBoundary(local(2026, 12, 31, 21, 0))).toEqual(local(2027, 1, 1, 8, 0));
  });
});

describe('time passing while the app is closed (resolvePetNeedsAcrossBedtime)', () => {
  test('7 PM -> 9 PM: only the awake hour decays hunger; energy drains then recovers', () => {
    const p = profile({ energy: 60, lastUpdatedAt: local(2026, 3, 10, 19).toISOString() });
    const r = resolvePetNeedsAcrossBedtime(p, local(2026, 3, 10, 21));
    expect(r.hunger).toBeCloseTo(97.5, 9);
    expect(r.isSleeping).toBe(true);
    expect(r.energy).toBeCloseTo(60 - 5 / 3 + 10, 9);
  });

  test('a whole night closed (9 PM -> 7 AM): hunger/cleanliness/happiness frozen', () => {
    const p = profile({ hunger: 60, energy: 10, lastUpdatedAt: local(2026, 3, 10, 21).toISOString() });
    const r = resolvePetNeedsAcrossBedtime(p, local(2026, 3, 11, 7));
    expect(r.hunger).toBe(60);
    expect(r.energy).toBe(100);
    expect(r.isSleeping).toBe(true);
  });

  test('multi-day gap equals the awake hours only (12 awake hours per day)', () => {
    const p = profile({ lastUpdatedAt: local(2026, 3, 11, 8).toISOString() });
    const r = resolvePetNeedsAcrossBedtime(p, local(2026, 3, 13, 8));
    expect(r.hunger).toBeCloseTo(100 - 2.5 * 24, 9);
    expect(r.cleanliness).toBeCloseTo(100 - 1.25 * 24, 9);
    expect(r.isSleeping).toBe(false);
  });

  test('clock behind the last save: values untouched, same object back', () => {
    const p = profile({ hunger: 33, isSleeping: false, lastUpdatedAt: local(2026, 3, 10, 12).toISOString() });
    expect(resolvePetNeedsAcrossBedtime(p, local(2026, 3, 10, 11))).toBe(p);
    const behindAtNight = resolvePetNeedsAcrossBedtime(p, local(2026, 3, 10, 3));
    expect(behindAtNight.hunger).toBe(33);
    expect(behindAtNight.isSleeping).toBe(true);
  });

  test('spring-forward day (2026-03-08): no decay while asleep', () => {
    const p = profile({ lastUpdatedAt: local(2026, 3, 7, 18).toISOString() });
    const r = resolvePetNeedsAcrossBedtime(p, local(2026, 3, 8, 9));
    expect(r.hunger).toBeCloseTo(100 - 2.5 * 3, 9); // 6-8 PM and 8-9 AM
  });

  test('fall-back day (2026-11-01): no decay while asleep', () => {
    const p = profile({ lastUpdatedAt: local(2026, 10, 31, 18).toISOString() });
    const r = resolvePetNeedsAcrossBedtime(p, local(2026, 11, 1, 9));
    expect(r.hunger).toBeCloseTo(100 - 2.5 * 3, 9);
  });
});
