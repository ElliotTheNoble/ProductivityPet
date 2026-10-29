import { getNextBedtimeBoundary, isWithinBedtimeWindow } from '@/utils/pet-bedtime';
import {
  CLEANLINESS_DECAY_PER_HOUR,
  DIRTY_ENERGY_PENALTY_PER_HOUR,
  ENERGY_DECAY_PER_HOUR,
  ENERGY_RECOVERY_PER_HOUR,
  HAPPINESS_DECAY_PER_HOUR,
  HUNGER_DECAY_PER_HOUR,
  applyPetNeedsUpdate,
  isPetDirty,
} from '@/utils/pet-needs-core';
import {
  CRITICAL_TO_DEATH_HOURS,
  EXHAUSTION_WAKE_ENERGY,
  GROWTH_UNITS_PER_TASK,
  RECOVERY_NEED_THRESHOLD,
  SICK_TO_CRITICAL_HOURS,
} from '@/utils/pet-family-config';
import type { PetProfile } from '@/utils/pet-profile-model';
import { PET_STAGES, TASKS_PER_STAGE, getPetStageIndex } from '@/utils/pet-stage';

// Pure (no storage, no React) rules for one pet's health. Healthy -> Sick ->
// Critical -> Deceased, driven only by saved timestamps so it works the same
// whether the app was open or closed. The family store (@/utils/pet-family.ts)
// calls this; nothing else should re-implement these rules.
//
// Sickness starts when Hunger, Cleanliness or Happiness reaches 0 (several at
// once is still one episode). It never kills instantly: 24 hours later the
// pet is Critical, 72 hours after that (96 in total from the first zero) it
// dies. Free recovery: all three at 50 or more. Energy is different — at 0
// the pet falls asleep from exhaustion and never gets sick or dies from it.

const HOUR_MS = 60 * 60 * 1000;

export type LifeState = 'healthy' | 'sick' | 'critical' | 'deceased';

export type PetLifecycle = {
  state: LifeState;
  // Start of the current sickness episode; preserved through Critical.
  sickSince?: string;
  criticalSince?: string;
  diedAt?: string;
  // True while asleep from exhaustion (Energy hit 0) until rested.
  exhausted: boolean;
  // Highest time this pet has been evaluated at. A device clock moved
  // backwards never rewinds this, so timers can't be undone by changing it.
  lastEvaluatedAt: string;
};

export type PetEventType =
  | 'adopted'
  | 'hatched'
  | 'sick'
  | 'critical'
  | 'recovered'
  | 'died'
  | 'resurrected'
  | 'retired'
  | 'returned';

// One entry of a pet's permanent history. `id` is deterministic (type + time)
// so the same event can never be recorded twice.
export type PetEvent = { id: string; type: PetEventType; at: string };

export type PetRecord = {
  id: string;
  name: string | null;
  // Per-pet needs, poop, hatch date, paid growth, bedtime state... (the
  // pawTokens field inside is unused: tokens live in the family wallet).
  profile: PetProfile;
  // Growth credit in whole units (see GROWTH_UNITS_PER_TASK). Stage and
  // level come from Math.floor(growthUnits / GROWTH_UNITS_PER_TASK).
  growthUnits: number;
  // Completed tasks counted while this pet was alive (informational).
  tasksCounted: number;
  lifecycle: PetLifecycle;
  equipped: { hat: string | null; bow: string | null };
  events: PetEvent[];
  // Highest stage / level ever reached (never lowered).
  peak: { stageIndex: number; level: number };
  createdAt: string;
  // Species of the pet. Missing = 'cat' (every pet so far is a kitty); kept so future species can be
  // told apart without changing saved pets.
  species?: string;
  // Set while the pet is retired in Pet Pawadise. A retired pet is frozen: its needs, sickness, growth
  // and every other timer are paused (advancePet / reevaluatePet / evaluateLifecycle return it
  // unchanged), it can't get sick or die, and it doesn't use one of the active-pet slots. Everything
  // else on the record (identity, name, stage, accessories, growth, history) is kept as it was.
  retired?: { since: string };
  // Set while a resurrection animation is still to be shown/finished. The
  // payment and the revival itself are already complete when this is set.
  revival?: { startedAt: string; done: boolean };
  // Notification bookkeeping so an episode is only announced once.
  alerts?: { sickNotifiedFor?: string; criticalNotifiedFor?: string };
};

export function makeEvent(type: PetEventType, at: string): PetEvent {
  return { id: `${type}:${at}`, type, at };
}

export function addEvents(pet: PetRecord, added: PetEvent[]): PetRecord {
  const known = new Set(pet.events.map((event) => event.id));
  const fresh = added.filter((event) => !known.has(event.id));
  return fresh.length === 0 ? pet : { ...pet, events: [...pet.events, ...fresh] };
}

export function isEggStage(growthUnits: number): boolean {
  return Math.floor(growthUnits / GROWTH_UNITS_PER_TASK) < TASKS_PER_STAGE;
}

// Same stage rule as getRenderedStageIndex in @/utils/pet-growth.ts (which
// can't be imported here without a cycle): Egg/Hatchling/Baby come free from
// growth, Young/Adult only once paid for.
export function getStageIndexFor(growthUnits: number, paidStageIndex: number): number {
  const freeIndex = Math.min(getPetStageIndex(Math.floor(growthUnits / GROWTH_UNITS_PER_TASK)), 2);
  return Math.max(freeIndex, paidStageIndex);
}

export function getPeakFor(growthUnits: number, paidStageIndex: number): { stageIndex: number; level: number } {
  const stageIndex = getStageIndexFor(growthUnits, paidStageIndex);
  return { stageIndex: Math.min(stageIndex, PET_STAGES.length - 1), level: stageIndex + 1 };
}

function ms(iso: string | undefined): number {
  return iso ? new Date(iso).getTime() : Number.NaN;
}

function anyNeedZero(profile: PetProfile): boolean {
  return profile.hunger <= 0 || profile.cleanliness <= 0 || profile.happiness <= 0;
}

export function allNeedsRecovered(profile: PetProfile): boolean {
  return (
    profile.hunger >= RECOVERY_NEED_THRESHOLD &&
    profile.cleanliness >= RECOVERY_NEED_THRESHOLD &&
    profile.happiness >= RECOVERY_NEED_THRESHOLD
  );
}

// When the first of Hunger/Cleanliness/Happiness hit 0 inside one stretch of
// awake time. Uses only the base decay rates, so this is never EARLIER than
// the truth (the dirty penalty can only make Happiness fall faster) — an
// unfairly early sickness start is the thing to avoid.
function estimateZeroTime(before: PetProfile, after: PetProfile, startMs: number, endMs: number): number | null {
  const candidates: number[] = [];
  const check = (was: number, now: number, rate: number) => {
    if (was > 0 && now <= 0) candidates.push(startMs + (was / rate) * HOUR_MS);
  };
  check(before.hunger, after.hunger, HUNGER_DECAY_PER_HOUR);
  check(before.cleanliness, after.cleanliness, CLEANLINESS_DECAY_PER_HOUR);
  check(before.happiness, after.happiness, HAPPINESS_DECAY_PER_HOUR);
  if (candidates.length === 0) return null;
  return Math.min(endMs, Math.max(startMs, Math.min(...candidates)));
}

type SimResult = { profile: PetProfile; exhausted: boolean; zeroAtMs: number | null };

// Carries the needs from `from` to `to`, splitting at every 8 PM / 8 AM
// boundary (needs freeze while asleep, as before) and at the moments Energy
// hits 0 (the pet falls asleep from exhaustion) or recovers enough to wake.
// While tracking, also reports when a need first reached 0.
function simulate(profile: PetProfile, exhaustedIn: boolean, fromMs: number, toMs: number, track: boolean): SimResult {
  let working = profile;
  let exhausted = exhaustedIn;
  let t = fromMs;
  let zeroAtMs: number | null = null;

  for (let guard = 0; t < toMs && guard < 6000; guard += 1) {
    const segmentStart = new Date(t);
    let segmentEnd = Math.min(getNextBedtimeBoundary(segmentStart).getTime(), toMs);
    const bedtimeSleeping = isWithinBedtimeWindow(segmentStart);

    if (!exhausted && !bedtimeSleeping && working.energy <= 0) exhausted = true;
    if (exhausted && working.energy >= EXHAUSTION_WAKE_ENERGY) exhausted = false;
    const sleeping = bedtimeSleeping || exhausted;

    let flip: 'exhaust' | 'wake' | null = null;
    if (!sleeping) {
      const rate = ENERGY_DECAY_PER_HOUR + (isPetDirty(working) ? DIRTY_ENERGY_PENALTY_PER_HOUR : 0);
      const zeroEnergyAt = t + (working.energy / rate) * HOUR_MS;
      if (zeroEnergyAt < segmentEnd) {
        segmentEnd = Math.max(t, zeroEnergyAt);
        flip = 'exhaust';
      }
    } else if (exhausted) {
      const wakeAt = t + ((EXHAUSTION_WAKE_ENERGY - working.energy) / ENERGY_RECOVERY_PER_HOUR) * HOUR_MS;
      if (wakeAt < segmentEnd) {
        segmentEnd = Math.max(t, wakeAt);
        flip = 'wake';
      }
    }

    const before = working;
    const result = applyPetNeedsUpdate(
      { ...working, isSleeping: sleeping, lastUpdatedAt: new Date(t).toISOString() },
      new Date(segmentEnd)
    );
    working = { ...result, lastUpdatedAt: new Date(segmentEnd).toISOString() };

    if (track && zeroAtMs === null && !sleeping) {
      zeroAtMs = estimateZeroTime(before, working, t, segmentEnd);
    }
    if (flip === 'exhaust') {
      exhausted = true;
      working = { ...working, energy: 0 };
    } else if (flip === 'wake') {
      exhausted = false;
    }
    t = segmentEnd;
  }

  return {
    profile: { ...working, isSleeping: isWithinBedtimeWindow(new Date(toMs)) || exhausted },
    exhausted,
    zeroAtMs,
  };
}

// Applies the health rules to a pet whose needs are already current.
// `zeroAtMs` is when a need reached 0 if that is known; otherwise a newly
// sick pet is treated as having become sick right now (conservative).
export function evaluateLifecycle(pet: PetRecord, nowMs: number, zeroAtMs: number | null): PetRecord {
  const nowIso = new Date(nowMs).toISOString();
  let lifecycle = pet.lifecycle;
  const events: PetEvent[] = [];
  let recovered = false;

  if (lifecycle.state === 'deceased' || pet.retired) return pet;

  if (lifecycle.state === 'healthy') {
    if (anyNeedZero(pet.profile)) {
      const sinceMs = zeroAtMs !== null ? Math.min(zeroAtMs, nowMs) : nowMs;
      const sinceIso = new Date(sinceMs).toISOString();
      lifecycle = { ...lifecycle, state: 'sick', sickSince: sinceIso };
      events.push(makeEvent('sick', sinceIso));
    }
  } else if (allNeedsRecovered(pet.profile)) {
    lifecycle = { state: 'healthy', exhausted: lifecycle.exhausted, lastEvaluatedAt: lifecycle.lastEvaluatedAt };
    events.push(makeEvent('recovered', nowIso));
    recovered = true;
  }

  if (lifecycle.state === 'sick' || lifecycle.state === 'critical') {
    let sinceMs = ms(lifecycle.sickSince);
    if (Number.isNaN(sinceMs)) {
      sinceMs = nowMs;
      lifecycle = { ...lifecycle, sickSince: nowIso };
    }
    const elapsed = nowMs - sinceMs;
    if (lifecycle.state === 'sick' && elapsed >= SICK_TO_CRITICAL_HOURS * HOUR_MS) {
      const criticalIso = new Date(sinceMs + SICK_TO_CRITICAL_HOURS * HOUR_MS).toISOString();
      lifecycle = { ...lifecycle, state: 'critical', criticalSince: criticalIso };
      events.push(makeEvent('critical', criticalIso));
    }
    if (elapsed >= (SICK_TO_CRITICAL_HOURS + CRITICAL_TO_DEATH_HOURS) * HOUR_MS) {
      const diedIso = new Date(sinceMs + (SICK_TO_CRITICAL_HOURS + CRITICAL_TO_DEATH_HOURS) * HOUR_MS).toISOString();
      lifecycle = { ...lifecycle, state: 'deceased', diedAt: diedIso };
      events.push(makeEvent('died', diedIso));
    }
  }

  const stamped: PetLifecycle = { ...lifecycle, lastEvaluatedAt: new Date(Math.max(nowMs, ms(lifecycle.lastEvaluatedAt) || 0)).toISOString() };
  // No poop is made while a pet is Sick or Critical (see pet-poop.ts), so on
  // recovery its poop schedule starts fresh ('' = "pick a new random time")
  // instead of treating the whole illness as time that piles should have
  // appeared in. Existing piles are never touched.
  const next: PetRecord = recovered ? { ...pet, profile: { ...pet.profile, nextPoopEventAt: '' }, lifecycle: stamped } : { ...pet, lifecycle: stamped };
  return addEvents(next, events);
}

// Brings one pet fully up to date at `now`: decay (with sleep and
// exhaustion), then the health rules. Deceased pets never change. Egg-stage
// pets have no pet care, so their needs don't decay and they can't get sick.
// `grace` is used once when migrating an existing save: a need that is
// already 0 starts its sickness clock at `now`, so nothing can die on the
// first launch.
export function advancePet(pet: PetRecord, now: Date, grace = false): PetRecord {
  if (pet.lifecycle.state === 'deceased' || pet.retired) return pet;

  const lastEvaluated = ms(pet.lifecycle.lastEvaluatedAt);
  const nowMs = Math.max(now.getTime(), Number.isNaN(lastEvaluated) ? 0 : lastEvaluated);

  if (isEggStage(pet.growthUnits)) {
    const iso = new Date(nowMs).toISOString();
    if (pet.profile.lastUpdatedAt === iso && pet.lifecycle.lastEvaluatedAt === iso) return pet;
    return {
      ...pet,
      profile: { ...pet.profile, lastUpdatedAt: iso },
      lifecycle: { ...pet.lifecycle, lastEvaluatedAt: iso },
    };
  }

  const startMs = ms(pet.profile.lastUpdatedAt);
  const track = pet.lifecycle.state === 'healthy';
  let profile = pet.profile;
  let exhausted = pet.lifecycle.exhausted;
  let zeroAtMs: number | null = null;

  if (!Number.isNaN(startMs) && startMs < nowMs) {
    const sim = simulate(profile, exhausted, startMs, nowMs, track && !grace);
    profile = sim.profile;
    exhausted = sim.exhausted;
    zeroAtMs = sim.zeroAtMs;
  } else {
    // Nothing has elapsed (or the device clock is behind the last save):
    // never decay backwards, just keep the sleep flag consistent.
    profile = { ...profile, isSleeping: isWithinBedtimeWindow(new Date(nowMs)) || exhausted };
  }

  const advanced: PetRecord = { ...pet, profile, lifecycle: { ...pet.lifecycle, exhausted } };
  return evaluateLifecycle(advanced, nowMs, grace ? null : zeroAtMs);
}

// Evaluates the health rules after a care action saved new needs (no decay).
export function reevaluatePet(pet: PetRecord, now: Date): PetRecord {
  if (pet.lifecycle.state === 'deceased' || pet.retired) return pet;
  const last = ms(pet.lifecycle.lastEvaluatedAt);
  const nowMs = Math.max(now.getTime(), Number.isNaN(last) ? 0 : last);
  if (isEggStage(pet.growthUnits)) return pet;
  return evaluateLifecycle(pet, nowMs, null);
}

// Predicts when a healthy pet's first need would reach 0 if nothing is done,
// counting only awake time (needs freeze 8 PM - 8 AM). Used to schedule the
// "needs attention" notification ahead of time. Ignores the dirty penalty
// and exhaustion, so the real moment can only be EARLIER than predicted —
// the alert is never fired before a pet could actually be sick.
export function predictSickTime(profile: PetProfile, now: Date): Date | null {
  const needs: { value: number; rate: number }[] = [
    { value: profile.hunger, rate: HUNGER_DECAY_PER_HOUR },
    { value: profile.cleanliness, rate: CLEANLINESS_DECAY_PER_HOUR },
    { value: profile.happiness, rate: HAPPINESS_DECAY_PER_HOUR },
  ];
  let best: number | null = null;
  for (const need of needs) {
    let remainingHours = need.value / need.rate;
    let t = now.getTime();
    for (let guard = 0; remainingHours > 0 && guard < 4000; guard += 1) {
      const here = new Date(t);
      const boundary = getNextBedtimeBoundary(here).getTime();
      if (isWithinBedtimeWindow(here)) {
        t = boundary;
        continue;
      }
      const awakeHours = (boundary - t) / HOUR_MS;
      if (remainingHours <= awakeHours) {
        t += remainingHours * HOUR_MS;
        remainingHours = 0;
      } else {
        remainingHours -= awakeHours;
        t = boundary;
      }
    }
    if (remainingHours <= 0 && (best === null || t < best)) best = t;
  }
  return best === null ? null : new Date(best);
}
