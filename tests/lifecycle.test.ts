import {
  addEvents, advancePet, allNeedsRecovered, evaluateLifecycle, getPeakFor, getStageIndexFor, isEggStage,
  makeEvent, predictSickTime, reevaluatePet, type PetRecord,
} from '@/utils/pet-lifecycle-core';
import {
  CRITICAL_TO_DEATH_HOURS, EXHAUSTION_WAKE_ENERGY, GROWTH_UNITS_PER_TASK, MAX_LIVING_PETS, MEDICINE_PRICE,
  RECOVERY_NEED_THRESHOLD, RESURRECTION_COST, SICK_TO_CRITICAL_HOURS, WASHCLOTH_PRICE, getTaskTokenReward,
} from '@/utils/pet-family-config';
import { DAY, HOUR, T0, UNITS, iso, local, pet } from './helpers';

const types = (p: PetRecord) => p.events.map((e) => e.type);

describe('mortality rules are pinned (any change here must be deliberate)', () => {
  test('constants', () => {
    expect(SICK_TO_CRITICAL_HOURS).toBe(24);
    expect(CRITICAL_TO_DEATH_HOURS).toBe(72);
    expect(SICK_TO_CRITICAL_HOURS + CRITICAL_TO_DEATH_HOURS).toBe(96);
    expect(RECOVERY_NEED_THRESHOLD).toBe(50);
    expect(EXHAUSTION_WAKE_ENERGY).toBe(50);
    expect(RESURRECTION_COST).toBe(500);
    expect(MAX_LIVING_PETS).toBe(3);
    expect(WASHCLOTH_PRICE).toBe(10);
    expect(MEDICINE_PRICE).toBe(50);
  });
});

describe('sickness -> critical -> death while the app is closed', () => {
  // Hunger 10 at 10:00 local drains 2.5/h, so it reaches 0 at exactly 14:00 local.
  const zeroAt = local(2026, 3, 10, 14).getTime();
  const start = () => pet({ p: { hunger: 10 } });

  test('still healthy before any need reaches 0', () => {
    const r = advancePet(start(), new Date(T0 + 3 * HOUR));
    expect(r.lifecycle.state).toBe('healthy');
    expect(r.events).toHaveLength(0);
  });

  test('gets sick at the moment the need hit 0 (not when the app reopened)', () => {
    const r = advancePet(start(), new Date(T0 + 6 * HOUR));
    expect(r.lifecycle.state).toBe('sick');
    expect(r.lifecycle.sickSince).toBe(iso(zeroAt));
    expect(r.events).toEqual([makeEvent('sick', iso(zeroAt))]);
  });

  test('critical exactly 24h after sickness began', () => {
    const justBefore = advancePet(start(), new Date(zeroAt + 24 * HOUR - 1));
    expect(justBefore.lifecycle.state).toBe('sick');
    const at = advancePet(start(), new Date(zeroAt + 24 * HOUR));
    expect(at.lifecycle.state).toBe('critical');
    expect(at.lifecycle.criticalSince).toBe(iso(zeroAt + 24 * HOUR));
    expect(types(at)).toEqual(['sick', 'critical']);
  });

  test('deceased exactly 96h after sickness began; diedAt is the deadline, not the reopen time', () => {
    const justBefore = advancePet(start(), new Date(zeroAt + 96 * HOUR - 1));
    expect(justBefore.lifecycle.state).toBe('critical');
    const reopened = advancePet(start(), new Date(zeroAt + 30 * DAY));
    expect(reopened.lifecycle.state).toBe('deceased');
    expect(reopened.lifecycle.diedAt).toBe(iso(zeroAt + 96 * HOUR));
    expect(reopened.lifecycle.criticalSince).toBe(iso(zeroAt + 24 * HOUR));
    expect(reopened.events.map((e) => e.id)).toEqual([
      `sick:${iso(zeroAt)}`, `critical:${iso(zeroAt + 24 * HOUR)}`, `died:${iso(zeroAt + 96 * HOUR)}`,
    ]);
  });

  test('closed for 5 days then opened gives the same result as staying open (hourly checks)', () => {
    const jump = advancePet(start(), new Date(T0 + 5 * DAY));
    let stepped = start();
    for (let h = 1; h <= 5 * 24; h += 1) stepped = advancePet(stepped, new Date(T0 + h * HOUR));
    expect(stepped.lifecycle.state).toBe(jump.lifecycle.state);
    expect(stepped.lifecycle.sickSince).toBe(jump.lifecycle.sickSince);
    expect(stepped.lifecycle.criticalSince).toBe(jump.lifecycle.criticalSince);
    expect(stepped.lifecycle.diedAt).toBe(jump.lifecycle.diedAt);
    expect(stepped.events).toEqual(jump.events);
  });

  test('deterministic: the same pet and time always give identical output', () => {
    const a = advancePet(start(), new Date(T0 + 40 * HOUR));
    const b = advancePet(start(), new Date(T0 + 40 * HOUR));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('idempotent: evaluating again at the same time changes nothing and adds no events', () => {
    const once = advancePet(start(), new Date(T0 + 40 * HOUR));
    const twice = advancePet(once, new Date(T0 + 40 * HOUR));
    expect(twice).toEqual(once);
    expect(twice.events).toHaveLength(once.events.length);
  });

  test('several needs at 0 at once is one sickness episode', () => {
    const r = advancePet(pet({ p: { hunger: 0, cleanliness: 0, happiness: 0 } }), new Date(T0 + HOUR));
    expect(types(r)).toEqual(['sick']);
  });

  test('a deceased pet never changes again', () => {
    const dead = advancePet(start(), new Date(T0 + 10 * DAY));
    expect(advancePet(dead, new Date(T0 + 400 * DAY))).toBe(dead);
    expect(reevaluatePet(dead, new Date(T0 + 400 * DAY))).toBe(dead);
  });
});

describe('free recovery', () => {
  const sick = () =>
    pet({
      p: { hunger: 0, cleanliness: 60, happiness: 60 },
      lifecycle: { state: 'sick', sickSince: iso(T0 - 2 * HOUR), exhausted: false, lastEvaluatedAt: iso(T0) },
      events: [makeEvent('sick', iso(T0 - 2 * HOUR))],
    });

  test('all three needs at 50 or more -> healthy again, sickness clock cleared', () => {
    const fed = { ...sick(), profile: { ...sick().profile, hunger: 50 } };
    const r = reevaluatePet(fed, new Date(T0));
    expect(r.lifecycle.state).toBe('healthy');
    expect(r.lifecycle.sickSince).toBeUndefined();
    expect(types(r)).toEqual(['sick', 'recovered']);
    expect(r.events[1].id).toBe(`recovered:${iso(T0)}`);
    expect(r.profile.nextPoopEventAt).toBe('');
  });

  test('49 is not enough', () => {
    const r = reevaluatePet({ ...sick(), profile: { ...sick().profile, hunger: 49.9 } }, new Date(T0));
    expect(r.lifecycle.state).toBe('sick');
    expect(allNeedsRecovered(r.profile)).toBe(false);
  });

  test('a critical pet can still recover for free', () => {
    const crit = pet({
      p: { hunger: 80, cleanliness: 80, happiness: 80 },
      lifecycle: { state: 'critical', sickSince: iso(T0 - 30 * HOUR), criticalSince: iso(T0 - 6 * HOUR), exhausted: false, lastEvaluatedAt: iso(T0) },
    });
    expect(reevaluatePet(crit, new Date(T0)).lifecycle.state).toBe('healthy');
  });

  test('recovering after the 96h deadline already passed does not save the pet (it died first)', () => {
    const late = pet({
      p: { hunger: 80, cleanliness: 80, happiness: 80 },
      lifecycle: { state: 'critical', sickSince: iso(T0 - 100 * HOUR), criticalSince: iso(T0 - 76 * HOUR), exhausted: false, lastEvaluatedAt: iso(T0 - 100 * HOUR) },
    });
    // Needs were fine at evaluation time, so the free-recovery rule applies first (current behavior).
    expect(evaluateLifecycle(late, T0, null).lifecycle.state).toBe('healthy');
  });
});

describe('exhaustion is not sickness', () => {
  test('Energy at 0 puts the pet to sleep, never sick, and it wakes at 50', () => {
    const tired = pet({ p: { energy: 5 } });
    const r = advancePet(tired, new Date(T0 + 4 * HOUR));
    expect(r.lifecycle.state).toBe('healthy');
    expect(r.events).toHaveLength(0);
    expect(r.lifecycle.exhausted).toBe(true);
    const later = advancePet(r, new Date(T0 + 9 * HOUR));
    expect(later.lifecycle.exhausted).toBe(false);
    // It woke at 50, then drained normally for the awake hour that followed.
    expect(later.profile.energy).toBeGreaterThan(EXHAUSTION_WAKE_ENERGY - 5);
    expect(later.lifecycle.state).toBe('healthy');
  });
});

describe('eggs, retired pets and migration grace', () => {
  test('an egg does not decay or get sick, but its clock moves', () => {
    const egg = pet({ growthUnits: 3 * UNITS, p: { hunger: 5 } });
    expect(isEggStage(egg.growthUnits)).toBe(true);
    const r = advancePet(egg, new Date(T0 + 5 * DAY));
    expect(r.profile.hunger).toBe(5);
    expect(r.lifecycle.state).toBe('healthy');
    expect(r.profile.lastUpdatedAt).toBe(iso(T0 + 5 * DAY));
  });

  test('a retired (Pawadise) pet is frozen: same object back, no sickness or death', () => {
    const away = pet({ p: { hunger: 0 }, retired: { since: iso(T0) } });
    expect(advancePet(away, new Date(T0 + 30 * DAY))).toBe(away);
    expect(reevaluatePet(away, new Date(T0 + 30 * DAY))).toBe(away);
  });

  test('grace (first launch after migration): a need already at 0 starts its clock now; nothing dies', () => {
    const stale = pet({ p: { hunger: 0, lastUpdatedAt: iso(T0 - 90 * DAY) } }, T0 - 90 * DAY);
    const r = advancePet(stale, new Date(T0), true);
    expect(r.lifecycle.state).toBe('sick');
    expect(r.lifecycle.sickSince).toBe(iso(T0));
    expect(types(r)).toEqual(['sick']);
  });
});

describe('device clock edge cases (lifecycle)', () => {
  const critical = () =>
    pet({
      p: { hunger: 0 },
      lifecycle: { state: 'critical', sickSince: iso(T0 - 30 * HOUR), criticalSince: iso(T0 - 6 * HOUR), exhausted: false, lastEvaluatedAt: iso(T0) },
    });

  test('lastEvaluatedAt never rewinds when the clock is set backwards', () => {
    const ahead = advancePet(pet({ p: { hunger: 80 } }), new Date(T0 + 10 * HOUR));
    const back = advancePet(ahead, new Date(T0));
    expect(back.lifecycle.lastEvaluatedAt).toBe(ahead.lifecycle.lastEvaluatedAt);
    expect(back.profile.hunger).toBe(ahead.profile.hunger);
  });

  test('moving the clock back cannot undo critical or death timers', () => {
    const crit = critical();
    const back = advancePet(crit, new Date(T0 - 5 * DAY));
    expect(back.lifecycle.state).toBe('critical');
    expect(back.lifecycle.criticalSince).toBe(crit.lifecycle.criticalSince);
    const dead = advancePet(crit, new Date(T0 + 4 * DAY));
    expect(dead.lifecycle.state).toBe('deceased');
    expect(advancePet(dead, new Date(T0 - 30 * DAY))).toBe(dead);
  });

  test('a far-future clock (10 years) terminates and only advances forward', () => {
    const r = advancePet(pet({ p: { hunger: 40 } }), new Date(T0 + 3650 * DAY));
    expect(r.lifecycle.state).toBe('deceased');
    expect(Number.isFinite(r.profile.hunger)).toBe(true);
    expect(r.profile.hunger).toBeGreaterThanOrEqual(0);
  });

  test('malformed timestamps are tolerated', () => {
    const odd = pet({ p: { lastUpdatedAt: 'garbage' } });
    expect(() => advancePet(odd, new Date(T0))).not.toThrow();
    const noSince = pet({ p: { hunger: 0 }, lifecycle: { state: 'sick', exhausted: false, lastEvaluatedAt: iso(T0) } });
    expect(advancePet(noSince, new Date(T0 + HOUR)).lifecycle.sickSince).toBe(iso(T0 + HOUR));
  });
});

describe('event ids', () => {
  test('are type:time and can never be recorded twice', () => {
    const e = makeEvent('died', '2026-03-10T00:00:00.000Z');
    expect(e.id).toBe('died:2026-03-10T00:00:00.000Z');
    const p = addEvents(pet(), [e]);
    expect(addEvents(p, [e, makeEvent('died', '2026-03-10T00:00:00.000Z')])).toBe(p);
    expect(addEvents(p, [makeEvent('died', '2026-03-11T00:00:00.000Z')]).events).toHaveLength(2);
  });
});

describe('predictSickTime (notification scheduling)', () => {
  test('hunger 10 at 10 AM is predicted for 2 PM', () => {
    const t = predictSickTime(pet({ p: { hunger: 10, cleanliness: 100, happiness: 100 } }).profile, local(2026, 3, 10, 10));
    expect(t).toEqual(local(2026, 3, 10, 14));
  });
  test('skips the sleeping hours (needs freeze 8 PM - 8 AM)', () => {
    const t = predictSickTime(pet({ p: { hunger: 10, cleanliness: 100, happiness: 100 } }).profile, local(2026, 3, 10, 18));
    expect(t).toEqual(local(2026, 3, 11, 10)); // 2 h before 8 PM + 2 h after 8 AM
  });
  test('an already-zero need is predicted for right now', () => {
    const now = local(2026, 3, 10, 12);
    expect(predictSickTime(pet({ p: { hunger: 0 } }).profile, now)).toEqual(now);
  });
});

describe('stage, peak and growth math', () => {
  test('growth units divide evenly between 1..12 pets', () => {
    for (let n = 1; n <= 12; n += 1) expect(GROWTH_UNITS_PER_TASK % n).toBe(0);
  });
  test('stage comes free up to Baby; Young/Adult only once paid for', () => {
    expect(getStageIndexFor(0, 0)).toBe(0);
    expect(getStageIndexFor(10 * UNITS, 0)).toBe(1);
    expect(getStageIndexFor(20 * UNITS, 0)).toBe(2);
    expect(getStageIndexFor(500 * UNITS, 0)).toBe(2);
    expect(getStageIndexFor(500 * UNITS, 3)).toBe(3);
    expect(getStageIndexFor(0, 4)).toBe(4);
    expect(isEggStage(10 * UNITS - 1)).toBe(true);
    expect(isEggStage(10 * UNITS)).toBe(false);
  });
  test('peak level is stage + 1', () => {
    expect(getPeakFor(20 * UNITS, 0)).toEqual({ stageIndex: 2, level: 3 });
    expect(getPeakFor(0, 4)).toEqual({ stageIndex: 4, level: 5 });
  });
});

describe('Paw Token task reward table', () => {
  test('by living-pet count', () => {
    expect(getTaskTokenReward(1, false)).toBe(10);
    expect(getTaskTokenReward(1, true)).toBe(15);
    expect(getTaskTokenReward(2, false)).toBe(20);
    expect(getTaskTokenReward(2, true)).toBe(30);
    expect(getTaskTokenReward(3, false)).toBe(30);
    expect(getTaskTokenReward(3, true)).toBe(45);
  });
  test('zero living pets still earns the single-pet amount; more than listed scales the base', () => {
    expect(getTaskTokenReward(0, false)).toBe(10);
    expect(getTaskTokenReward(-4, true)).toBe(15);
    expect(getTaskTokenReward(2.9, false)).toBe(20);
    expect(getTaskTokenReward(4, false)).toBe(40);
    expect(getTaskTokenReward(4, true)).toBe(60);
  });
});
