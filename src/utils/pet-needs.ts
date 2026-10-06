import { getNextBedtimeBoundary, isWithinBedtimeWindow } from '@/utils/pet-bedtime';
import { clampNeedValue, getPetProfile, savePetProfile, type PetProfile } from '@/utils/pet-profile';

// Pure, real-elapsed-time need calculations for the virtual pet-care
// system. Deliberately separate from src/utils/pet-profile.ts (which only
// owns the PetProfile type + AsyncStorage persistence) the same way
// src/utils/tasks.ts (pure task calculations) is kept separate from
// src/utils/task-storage.ts (the AsyncStorage layer) elsewhere in this app.
//
// All four needs — Hunger, Cleanliness, Happiness, and Energy — are now
// implemented, each reusing the same two generic building blocks
// (getElapsedHoursSince, applyNeedDecay) with its own rate rather than
// duplicating this logic. Energy is the one exception to "pauses while
// asleep" — see applyEnergyDecay below.
//
// Important: none of these functions touch `lastUpdatedAt` — they only read
// it to figure out how much time has passed, and return a new profile with
// the decayed value(s) applied. Advancing `lastUpdatedAt` to "now" is
// savePetProfile()'s job alone (see pet-profile.ts). That split matters
// once more needs exist: every need for a given update must be computed
// from the SAME elapsed-time window (the same old `lastUpdatedAt`), then
// saved once — if any one need's calculation bumped `lastUpdatedAt` itself,
// the next need computed in that same pass would see ~0 elapsed time and
// wrongly skip its own decay.

// How many hours have passed since a given ISO timestamp. Shared by every
// need's own decay rate — Hunger uses it now; Cleanliness/Happiness/Energy
// will call this same function later with their own rates rather than
// each re-deriving elapsed time themselves.
export function getElapsedHoursSince(isoTimestamp: string, now: Date = new Date()): number {
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return 0; // missing/malformed timestamp — treat as "no time has passed"
  const elapsedMs = now.getTime() - then;
  if (elapsedMs <= 0) return 0; // clock skew or a future timestamp — never decay backwards
  return elapsedMs / (1000 * 60 * 60);
}

// Decays a single 0-100 need value by a flat rate-per-hour over some number
// of elapsed hours, clamped to the valid range. Generic — not Hunger-
// specific — so every future need reuses this exact function with its own
// rate instead of each reimplementing the same subtraction/clamp.
export function applyNeedDecay(currentValue: number, ratePerHour: number, elapsedHours: number): number {
  return clampNeedValue(currentValue - ratePerHour * elapsedHours);
}

// 5 points every 2 hours = 2.5 points/hour.
export const HUNGER_DECAY_PER_HOUR = 5 / 2;

// Computes what Hunger should be right now, based on real elapsed time
// since the profile's lastUpdatedAt. Does not decay while isSleeping (per
// the current spec — Hunger simply doesn't change while asleep; this is
// not the bedtime system itself, just this one rule). Returns a new
// profile object (does not mutate the input); returns the same reference
// unchanged when there's nothing to apply, so callers can cheaply check
// `result === profile` to know whether anything actually changed.
export function applyHungerDecay(profile: PetProfile, now: Date = new Date()): PetProfile {
  if (profile.isSleeping) return profile;

  const elapsedHours = getElapsedHoursSince(profile.lastUpdatedAt, now);
  if (elapsedHours <= 0) return profile;

  const nextHunger = applyNeedDecay(profile.hunger, HUNGER_DECAY_PER_HOUR, elapsedHours);
  if (nextHunger === profile.hunger) return profile;

  return { ...profile, hunger: nextHunger };
}

// 5 points every 4 hours = 1.25 points/hour.
export const CLEANLINESS_DECAY_PER_HOUR = 5 / 4;

// Same shape as applyHungerDecay, for Cleanliness: real-elapsed-time decay
// since lastUpdatedAt, paused while isSleeping, returns the same profile
// reference back when nothing changed.
export function applyCleanlinessDecay(profile: PetProfile, now: Date = new Date()): PetProfile {
  if (profile.isSleeping) return profile;

  const elapsedHours = getElapsedHoursSince(profile.lastUpdatedAt, now);
  if (elapsedHours <= 0) return profile;

  const nextCleanliness = applyNeedDecay(profile.cleanliness, CLEANLINESS_DECAY_PER_HOUR, elapsedHours);
  if (nextCleanliness === profile.cleanliness) return profile;

  return { ...profile, cleanliness: nextCleanliness };
}

// 5 points every 6 hours.
export const HAPPINESS_DECAY_PER_HOUR = 5 / 6;

// Same shape as applyHungerDecay/applyCleanlinessDecay, for Happiness:
// real-elapsed-time decay since lastUpdatedAt, paused while isSleeping,
// returns the same profile reference back when nothing changed.
export function applyHappinessDecay(profile: PetProfile, now: Date = new Date()): PetProfile {
  if (profile.isSleeping) return profile;

  const elapsedHours = getElapsedHoursSince(profile.lastUpdatedAt, now);
  if (elapsedHours <= 0) return profile;

  const nextHappiness = applyNeedDecay(profile.happiness, HAPPINESS_DECAY_PER_HOUR, elapsedHours);
  if (nextHappiness === profile.happiness) return profile;

  return { ...profile, happiness: nextHappiness };
}

// 5 points every 3 hours while awake.
export const ENERGY_DECAY_PER_HOUR = 5 / 3;
// Unlike the other three needs, Energy doesn't just pause while asleep — it
// moves the other way, recovering instead of draining.
export const ENERGY_RECOVERY_PER_HOUR = 10;

// Energy while awake: same real-elapsed-time decay shape as the other three
// needs. Energy while asleep: RECOVERS at ENERGY_RECOVERY_PER_HOUR instead
// of decaying — reused via applyNeedDecay with a negative rate (subtracting
// a negative rate is the same as adding), rather than a separate "add and
// clamp" helper, since the clamp/subtract shape is identical either way.
// This is why, unlike applyHungerDecay/applyCleanlinessDecay/
// applyHappinessDecay, this function doesn't early-return on isSleeping —
// it branches the rate's sign instead, since Energy still changes (just in
// the opposite direction) while asleep. Still only looks at the existing
// isSleeping boolean — no automatic bedtime schedule yet.
export function applyEnergyDecay(profile: PetProfile, now: Date = new Date()): PetProfile {
  const elapsedHours = getElapsedHoursSince(profile.lastUpdatedAt, now);
  if (elapsedHours <= 0) return profile;

  const ratePerHour = profile.isSleeping ? -ENERGY_RECOVERY_PER_HOUR : ENERGY_DECAY_PER_HOUR;
  const nextEnergy = applyNeedDecay(profile.energy, ratePerHour, elapsedHours);
  if (nextEnergy === profile.energy) return profile;

  return { ...profile, energy: nextEnergy };
}

// Applies every need's decay to a profile, all computed from the same
// elapsed-time window (the profile's own lastUpdatedAt, untouched by any of
// them — see the module comment above). Hunger, Cleanliness, Happiness, and
// Energy all read `profile.lastUpdatedAt` as it was BEFORE this function
// ran — chaining them like this is safe specifically because none of them
// ever modifies that field, so each later call still sees the original
// timestamp, not one advanced by an earlier one. Returns the same profile
// reference back, unchanged, when nothing actually changed.
export function applyPetNeedsUpdate(profile: PetProfile, now: Date = new Date()): PetProfile {
  const afterHunger = applyHungerDecay(profile, now);
  const afterCleanliness = applyCleanlinessDecay(afterHunger, now);
  const afterHappiness = applyHappinessDecay(afterCleanliness, now);
  const afterEnergy = applyEnergyDecay(afterHappiness, now);
  return afterEnergy;
}

// Same four-need result as applyPetNeedsUpdate, but correct across a real
// elapsed gap that crosses one or more 8 PM/8 AM bedtime boundaries — e.g.
// the app being closed at 7 PM and reopened at 9 PM, or left closed for
// several days.
//
// Why this exists: applyPetNeedsUpdate takes a single isSleeping value and
// applies it to the WHOLE elapsed interval. That's only correct if the
// interval never actually crosses a real bedtime transition. It routinely
// does (any overnight closure), so naively setting isSleeping from the
// CURRENT moment before running decay would wrongly apply one uniform
// sleep/wake state to a gap that was really part-awake, part-asleep —
// e.g. a 7 PM→9 PM gap would wrongly count the whole 2 hours as asleep,
// skipping Hunger/Cleanliness/Happiness decay for the 7-8 PM hour that was
// actually awake, and over-recovering Energy for an hour it should have
// been draining instead.
//
// The fix: walk from profile.lastUpdatedAt to `now`, splitting at every
// boundary getNextBedtimeBoundary finds, and run the existing, UNCHANGED
// applyPetNeedsUpdate once per segment with that segment's own correct
// isSleeping (constant within a segment, by construction — a segment never
// contains a boundary itself). The four decay rates/functions above are
// never modified or duplicated; this only decides what isSleeping to feed
// them, per segment, instead of once for the whole gap.
//
// Between segments, lastUpdatedAt is advanced on an in-memory working copy
// only — no AsyncStorage write happens per segment (even for a multi-day
// gap with many boundaries). The caller still does exactly one save, same
// as before, only if the final result actually differs from the input.
export function resolvePetNeedsAcrossBedtime(profile: PetProfile, now: Date = new Date()): PetProfile {
  const startTime = new Date(profile.lastUpdatedAt).getTime();
  const currentlySleeping = isWithinBedtimeWindow(now);

  if (Number.isNaN(startTime) || startTime >= now.getTime()) {
    // Malformed timestamp, or no time has actually elapsed (including
    // clock skew) — nothing to decay, but isSleeping should still reflect
    // right now.
    return profile.isSleeping === currentlySleeping ? profile : { ...profile, isSleeping: currentlySleeping };
  }

  let working = profile;
  let segmentStart = new Date(startTime);

  // Each iteration strictly advances segmentStart to the next boundary (or
  // to `now`, which always ends the loop) — getNextBedtimeBoundary always
  // returns a time strictly after its input, so this is guaranteed to
  // terminate (roughly elapsedHours / 12 iterations) and never revisits a
  // boundary it already passed.
  while (true) {
    const nextBoundary = getNextBedtimeBoundary(segmentStart);
    const segmentEnd = nextBoundary.getTime() < now.getTime() ? nextBoundary : now;

    // Constant for this whole segment by construction (no boundary falls
    // inside [segmentStart, segmentEnd)), so evaluating it once at the
    // segment's start is correct for the entire segment.
    const segmentIsSleeping = isWithinBedtimeWindow(segmentStart);
    const segmentInput: PetProfile = { ...working, isSleeping: segmentIsSleeping };
    const segmentResult = applyPetNeedsUpdate(segmentInput, segmentEnd);

    // Manually advance lastUpdatedAt on the in-memory working copy — the
    // decay functions themselves never do this (see the module comment),
    // so without this the next segment would see ~0 elapsed time instead
    // of picking up where this segment left off.
    working = { ...segmentResult, lastUpdatedAt: segmentEnd.toISOString() };

    if (segmentEnd.getTime() >= now.getTime()) break;
    segmentStart = segmentEnd;
  }

  // The final segment never contains a boundary crossing, so its sleeping
  // state already equals isWithinBedtimeWindow(now) — this is just making
  // that explicit/guaranteed rather than relying on that equivalence.
  if (working.isSleeping !== currentlySleeping) {
    working = { ...working, isSleeping: currentlySleeping };
  }

  const unchanged =
    working.hunger === profile.hunger &&
    working.cleanliness === profile.cleanliness &&
    working.happiness === profile.happiness &&
    working.energy === profile.energy &&
    working.isSleeping === profile.isSleeping;

  return unchanged ? profile : working;
}

// Loads the saved pet profile and brings its needs up to date with real
// elapsed time — including correctly handling any 8 PM/8 AM bedtime
// boundaries crossed while the app was closed (see
// resolvePetNeedsAcrossBedtime above) — persisting the result (which also
// advances lastUpdatedAt — see savePetProfile()) only when something
// actually changed. This is the one place "load → catch needs up to now →
// save" happens; callers that want an up-to-date profile (e.g. app startup)
// should call this instead of getPetProfile() directly. getPetProfile()
// itself is untouched — it still just loads/creates, with no needs
// calculation — so anything that only wants the raw stored profile isn't
// forced to also trigger a save. adoptionDate is never read or written
// here, so it's always preserved untouched.
export async function loadPetProfileWithNeedsUpdate(now: Date = new Date()): Promise<PetProfile> {
  const profile = await getPetProfile();
  const updated = resolvePetNeedsAcrossBedtime(profile, now);
  if (updated !== profile) {
    savePetProfile(updated);
  }
  return updated;
}
