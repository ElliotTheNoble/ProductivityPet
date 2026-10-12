import { getPetProfile, savePetProfile, MAX_POOP_PILES, type PetProfile, type PoopPile, type PoopSize } from '@/utils/pet-profile';
import type { PetStage } from '@/utils/pet-stage';

// Simple explanation: this file controls Kitty's poop. It decides WHEN new
// poop appears, HOW MANY piles can exist at once, WHERE each pile sits on
// the floor (without overlapping), and WHAT HAPPENS when the player cleans
// one up. Nothing here draws pictures on screen — it just works with data
// (numbers and objects) that get saved and shown elsewhere.

// Accumulating poop piles — occasional, time-based, and scheduled (never a
// setInterval/setTimeout poll). Each profile carries a single
// `nextPoopEventAt` ISO timestamp (see @/utils/pet-profile.ts): the
// earliest real time the NEXT pile (whether it's the first pile of a new
// mess, or another one piling onto an existing mess) is allowed to appear.
// Every check compares "now" against that stored timestamp — the same
// "compare elapsed real time against stored state" idea @/utils/pet-needs.ts
// already uses for decay, just a scheduled point in time instead of an
// hourly rate.
//
// Two different intervals are involved:
// - POOP_EVENT_MIN/MAX_INTERVAL_HOURS — how long Kitty goes between a
//   clean floor (poopPiles: []) and the very FIRST pile of a new mess.
//   Random within that range, same as before accumulation existed.
// - POOP_PILE_ACCUMULATION_INTERVAL_HOURS — once there's at least one
//   pile and she's still neglected, how often ANOTHER pile piles on, up
//   to MAX_POOP_PILES (@/utils/pet-profile.ts) total.

// Simple explanation: these 3 numbers control the timing.
// - First poop shows up 3-8 hours after the floor is clean (random).
// - After that, if not cleaned, one MORE pile appears every 2 hours.
export const POOP_EVENT_MIN_INTERVAL_HOURS = 3;
export const POOP_EVENT_MAX_INTERVAL_HOURS = 8;
export const POOP_PILE_ACCUMULATION_INTERVAL_HOURS = 2;

function randomPoopIntervalMs(): number {
  const hours =
    POOP_EVENT_MIN_INTERVAL_HOURS + Math.random() * (POOP_EVENT_MAX_INTERVAL_HOURS - POOP_EVENT_MIN_INTERVAL_HOURS);
  return hours * 60 * 60 * 1000;
}

// The random 3-8h wait before the FIRST pile of a brand new mess.
function scheduleFirstPileEvent(now: Date): string {
  return new Date(now.getTime() + randomPoopIntervalMs()).toISOString();
}

// The fixed 2h wait before the NEXT pile piling onto an existing mess.
function scheduleNextPileEvent(now: Date): string {
  return new Date(now.getTime() + POOP_PILE_ACCUMULATION_INTERVAL_HOURS * 60 * 60 * 1000).toISOString();
}

// Simple explanation: this is the cleanup difficulty for each size.
// Small = 1 click, Medium = 2 clicks, Large = 3 clicks.
// How many "Clean Up!" clicks each poop size takes to fully clear — a
// bigger mess takes more cleanup, same idea as the 3 real floor-art sizes
// (getPoopArt in @/components/pet-placeholder.tsx, cropped from
// assets/images/pets/kitty_poop.png).
export const POOP_CLEANUP_ACTIONS: Record<PoopSize, number> = {
  small: 1,
  medium: 2,
  large: 3,
};

const POOP_SIZES: PoopSize[] = ['small', 'medium', 'large'];

// Simple explanation: picks Small, Medium, or Large at random.
function randomPoopSize(): PoopSize {
  return POOP_SIZES[Math.floor(Math.random() * POOP_SIZES.length)];
}

let pileIdCounter = 0;
// Timestamp + an incrementing counter (not just Math.random()) so piles
// created back-to-back in the SAME synchronous catch-up pass (see
// applyPoopAccumulation's loop below — reopening the app after several
// hours away can create more than one pile in a single call) can never
// collide, even if Date.now() itself doesn't advance between them.
function generatePileId(now: Date): string {
  pileIdCounter += 1;
  return `pile-${now.getTime()}-${pileIdCounter}`;
}

// --- Pile floor placement (random, both sides of Kitty, collision-aware) ---
//
// Simple explanation: this whole section figures out WHERE a new poop pile
// should go on the floor, so it doesn't land on top of Kitty, the needs
// bars, or another poop pile.
//
// A pile's position is a plain { offsetXPx, offsetYPx } translate, stored
// directly on the pile (@/utils/pet-profile.ts) — resolved ONCE here, at
// creation time, then rendered as-is by @/components/pet-placeholder.tsx
// with no further positioning logic of its own. This module has no access
// to the real on-screen pixel size of the Living Room pet box (it's plain
// data logic, not a React component — the box itself is responsively
// sized between ~150-260px wide), so all the measurements below are
// REFERENCE approximations at a representative box width, consistent with
// how POOP_ZONE_MIN_X_BY_STAGE already reuses the exact px magnitudes
// tuned over several earlier rounds for Hatchling/Baby (100) and
// Young/Adult (250) — now applied as a MINIMUM distance from Kitty's
// center on whichever side a pile randomly lands on, rather than a single
// fixed direction, so poop actually uses both sides.

// Approximate on-screen footprint (px) of each poop size's floor art, at
// that same reference box width — derived from getPoopArt's own
// displayWidthPercent/aspectRatio in @/components/pet-placeholder.tsx
// (18%/24%/30% of the box width, at each size's own aspect ratio). Kept
// in sync by hand since this module can't share a literal constant with
// a React Native component file without pulling UI concerns in here.
const POOP_PILE_FOOTPRINT_PX: Record<PoopSize, { width: number; height: number }> = {
  small: { width: 36, height: 33 },
  medium: { width: 48, height: 37 },
  large: { width: 60, height: 45 },
};

// Required visible gap (px) between two piles' bounding boxes — "ideally
// at least 20-30px" — and reused as the same minimum clearance a
// candidate position needs from Kitty's own center band (see
// randomCandidatePosition below, which never generates anything closer
// than POOP_ZONE_MIN_X_BY_STAGE to begin with, so Kitty herself doesn't
// need a separate collision box here).
const POOP_PILE_MIN_GAP_PX = 25;

// Minimum distance from Kitty's center a pile's chosen side can start at
// — see the file-level comment above for why these specific numbers.
const POOP_ZONE_MIN_X_BY_STAGE: Record<PetStage, number> = {
  Egg: 0,
  Hatchling: 100,
  Baby: 100,
  Young: 250,
  Adult: 250,
};
// How much further a pile can additionally drift beyond that minimum.
const POOP_ZONE_X_SPREAD_PX = 90;
// Vertical range (px, downward from the pet box's own bottom anchor) a
// pile can fall within — 0 is right at the anchor (never negative/
// floating above it); the upper bound reaches deeper into the floor now
// that the needs bars below are a single compact row instead of 4
// stacked ones (see needsRow in @/components/pet-placeholder.tsx) without
// extending past the pet box's own bottom edge.
const POOP_ZONE_Y_MIN_PX = 0;
const POOP_ZONE_Y_MAX_PX = 90;

// Simple explanation: picks a random number between min and max.
function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

type PilePosition = { offsetXPx: number; offsetYPx: number };

// Simple explanation: suggests ONE random spot for a pile (left or right
// of Kitty, random distance, random depth). This spot might still overlap
// another pile — that gets checked separately in placePoopPile below.
// One random candidate: a random side (-1 left, 1 right, equal 50/50
// chance EVERY time — this is what makes poop "use both sides rather
// than favoring one" over many piles, rather than being fixed per stage),
// a random distance within that side's zone, and a random depth.
function randomCandidatePosition(stage: PetStage): PilePosition {
  const side = Math.random() < 0.5 ? -1 : 1;
  const minX = POOP_ZONE_MIN_X_BY_STAGE[stage];
  const x = side * randomInRange(minX, minX + POOP_ZONE_X_SPREAD_PX);
  const y = randomInRange(POOP_ZONE_Y_MIN_PX, POOP_ZONE_Y_MAX_PX);
  return { offsetXPx: Math.round(x), offsetYPx: Math.round(y) };
}

// A handful of fixed, deterministic positions (one per side, near and
// far, high and low) tried in order as an absolute last resort if random
// search below can't find a free spot — spread widely enough that, with
// at most MAX_POOP_PILES (5) piles ever active, at least one of these is
// essentially guaranteed to still be free.
function fallbackCandidatePositions(stage: PetStage): PilePosition[] {
  const minX = POOP_ZONE_MIN_X_BY_STAGE[stage];
  const farX = minX + POOP_ZONE_X_SPREAD_PX;
  return [
    { offsetXPx: -minX, offsetYPx: POOP_ZONE_Y_MIN_PX },
    { offsetXPx: minX, offsetYPx: POOP_ZONE_Y_MIN_PX },
    { offsetXPx: -farX, offsetYPx: POOP_ZONE_Y_MAX_PX },
    { offsetXPx: farX, offsetYPx: POOP_ZONE_Y_MAX_PX },
    { offsetXPx: -Math.round((minX + farX) / 2), offsetYPx: Math.round(POOP_ZONE_Y_MAX_PX / 2) },
  ];
}

// Simple explanation: checks if two poop piles would touch or overlap if
// placed at these two positions. Returns true if they're too close.
// Whether two piles' bounding boxes (centered at their own position,
// sized per POOP_PILE_FOOTPRINT_PX for their own size) overlap, including
// the required minimum visible gap between them.
function footprintsOverlap(a: PilePosition, aSize: PoopSize, b: PilePosition, bSize: PoopSize): boolean {
  const aFoot = POOP_PILE_FOOTPRINT_PX[aSize];
  const bFoot = POOP_PILE_FOOTPRINT_PX[bSize];
  const dx = Math.abs(a.offsetXPx - b.offsetXPx);
  const dy = Math.abs(a.offsetYPx - b.offsetYPx);
  const minDx = aFoot.width / 2 + bFoot.width / 2 + POOP_PILE_MIN_GAP_PX;
  const minDy = aFoot.height / 2 + bFoot.height / 2 + POOP_PILE_MIN_GAP_PX;
  return dx < minDx && dy < minDy;
}

const POOP_PILE_PLACEMENT_ATTEMPTS = 40;

// Simple explanation: tries random spots (up to 40 times) until it finds
// one that doesn't overlap any existing pile. If it really can't find a
// free spot, it falls back to a small list of safe, fixed spots instead.
// This is how the game stops new poop piles from landing on top of each
// other.
// Finds a position for a new pile of `size` that doesn't collide with any
// of `existingPiles`'s own real (size-aware) footprints: tries up to
// POOP_PILE_PLACEMENT_ATTEMPTS random candidates first (rejection
// sampling — "if a random position is invalid, try another location"),
// then falls back to a small set of fixed positions, still
// collision-checked where possible, rather than ever placing a pile that
// visibly overlaps another ("if no valid position is available, use a
// safe fallback rather than allowing piles to overlap").
function placePoopPile(stage: PetStage, size: PoopSize, existingPiles: PoopPile[]): PilePosition {
  for (let attempt = 0; attempt < POOP_PILE_PLACEMENT_ATTEMPTS; attempt++) {
    const candidate = randomCandidatePosition(stage);
    if (!existingPiles.some((p) => footprintsOverlap(candidate, size, { offsetXPx: p.offsetXPx, offsetYPx: p.offsetYPx }, p.size))) {
      return candidate;
    }
  }
  for (const candidate of fallbackCandidatePositions(stage)) {
    if (!existingPiles.some((p) => footprintsOverlap(candidate, size, { offsetXPx: p.offsetXPx, offsetYPx: p.offsetYPx }, p.size))) {
      return candidate;
    }
  }
  // Every fallback also collided — astronomically unlikely with at most 5
  // piles ever active, but use the last fallback anyway rather than
  // failing to place the pile at all; a rare, minor overlap here is
  // preferable to a pile silently not appearing.
  const fallbacks = fallbackCandidatePositions(stage);
  return fallbacks[fallbacks.length - 1];
}

// `existingPiles` is whatever piles this new one will actually sit
// alongside — callers always pass the CURRENT (possibly already-growing,
// mid-batch) sibling list, never a stale snapshot, so collision checks
// stay correct even when several piles are created in one accumulation
// pass (see applyPoopAccumulation's loop below).
// Simple explanation: builds one brand-new poop pile object — picks its
// size (random, unless one is given), how many clicks it needs, and a
// safe floor position.
function createPoopPile(now: Date, stage: PetStage, existingPiles: PoopPile[], size: PoopSize = randomPoopSize()): PoopPile {
  const position = placePoopPile(stage, size, existingPiles);
  return {
    id: generatePileId(now),
    size,
    cleanupRemaining: POOP_CLEANUP_ACTIONS[size],
    createdAt: now.toISOString(),
    offsetXPx: position.offsetXPx,
    offsetYPx: position.offsetYPx,
  };
}

// Simple explanation: adds one new poop pile to the pet's saved data
// (does nothing if there are already 5 piles — the maximum).
// Pure — appends exactly one new pile (random size unless `size` is given)
// to the profile and reschedules nextPoopEventAt for whatever comes next,
// WITHOUT checking the time/sleeping/stage/max-piles gates itself — callers
// decide when it's appropriate to call this. Exported so the dev-only
// "add a pile now" test buttons (src/app/index.tsx) can reuse the exact
// same pile-creation + needsBath + rescheduling logic a real accumulation
// step uses, rather than a simplified copy of it, while still respecting
// MAX_POOP_PILES (silently a no-op once full, same as the real system).
// Takes `stage` because placement (how far from Kitty's center the new
// pile's zone starts) is stage-specific — see createPoopPile/placePoopPile
// above.
export function applyAddPoopPile(profile: PetProfile, stage: PetStage, now: Date = new Date(), size?: PoopSize): PetProfile {
  if (profile.poopPiles.length >= MAX_POOP_PILES) return profile;
  const pile = createPoopPile(now, stage, profile.poopPiles, size);
  const poopPiles = [...profile.poopPiles, pile];
  return {
    ...profile,
    poopPiles,
    needsBath: true,
    nextPoopEventAt: scheduleNextPileEvent(now),
  };
}

// Simple explanation: this is the main "should poop appear now?" check.
// It compares the current time to the saved "next poop time." If enough
// time has passed, it adds a new pile (or several, if the app was closed
// for a long time). It never adds poop while Kitty is asleep or still an
// Egg, and it never goes over 5 piles.
//
// Pure — given the profile, the pet's current real stage (Egg/Hatchling/
// Baby/Young/Adult, from @/utils/pet-growth.ts or @/utils/pet-stage.ts —
// this module has no task data of its own, so the caller always passes it
// in), and now, returns either the same profile reference (nothing to do)
// or an updated one with 1+ new poop piles accumulated.
//
// - Asleep or still an Egg: never accumulate at all, regardless of the
//   schedule — "do not add new piles while Kitty is sleeping" and "keep
//   the Egg completely free of poop/accumulation". The existing schedule
//   is left exactly as-is so it resumes correctly once she wakes/hatches,
//   rather than being silently skipped or reset.
// - No piles yet (a clean floor): behaves like the original single-poop
//   system — waits for the scheduled random 3-8h first-pile moment, then
//   creates one pile and schedules the SECOND pile 2h after that.
// - 1+ piles already, under MAX_POOP_PILES: once real time reaches the
//   scheduled moment, adds more piles in a bounded loop (never more than
//   MAX_POOP_PILES iterations) — if the app was closed for several hours,
//   this correctly catches up by adding as many piles as should have
//   accumulated in that time (each loop step advances the schedule by
//   exactly one more POOP_PILE_ACCUMULATION_INTERVAL_HOURS from its own
//   previous value, not from `now`, so the cadence stays regular rather
//   than drifting based on exactly when the check happens), capped at
//   MAX_POOP_PILES.
// - Already at MAX_POOP_PILES: no-op — the schedule is left as whatever
//   it last was; cleaning a pile below the max is what resumes
//   accumulation again (see applyCleanUpPile below, which reschedules a
//   fresh interval at that point) rather than this function immediately
//   refilling the moment room opens up.
export function applyPoopAccumulation(profile: PetProfile, stage: PetStage, now: Date = new Date()): PetProfile {
  if (profile.isSleeping || stage === 'Egg') return profile;

  const scheduledTime = profile.nextPoopEventAt ? new Date(profile.nextPoopEventAt).getTime() : NaN;
  if (Number.isNaN(scheduledTime)) {
    const nextPoopEventAt = profile.poopPiles.length === 0 ? scheduleFirstPileEvent(now) : scheduleNextPileEvent(now);
    return { ...profile, nextPoopEventAt };
  }
  if (profile.poopPiles.length >= MAX_POOP_PILES) return profile;
  if (now.getTime() < scheduledTime) return profile;

  if (profile.poopPiles.length === 0) {
    // The very first pile of a new mess — then schedule the second pile
    // (if any) 2h from now, same as applyAddPoopPile above.
    return applyAddPoopPile(profile, stage, now);
  }

  // Already neglected with 1+ piles down — catch up on however many 2h
  // intervals have actually elapsed, bounded by MAX_POOP_PILES so this
  // loop can never run more than a handful of times.
  let piles = profile.poopPiles;
  let nextEventAt = scheduledTime;
  while (piles.length < MAX_POOP_PILES && now.getTime() >= nextEventAt) {
    piles = [...piles, createPoopPile(new Date(nextEventAt), stage, piles)];
    nextEventAt += POOP_PILE_ACCUMULATION_INTERVAL_HOURS * 60 * 60 * 1000;
  }
  return { ...profile, poopPiles: piles, needsBath: true, nextPoopEventAt: new Date(nextEventAt).toISOString() };
}

// Simple explanation: loads the saved pet data, runs the accumulation
// check above, and saves the result if anything changed. This is what
// actually gets called when the app starts (see src/app/_layout.tsx).
// Persistent wrapper — same "load (already needs-updated by the caller),
// apply, save only if changed" shape as @/utils/pet-bathing.ts's
// bathePet. Deliberately does NOT call loadPetProfileWithNeedsUpdate
// itself (unlike bathePet) — this is meant to run right after that's
// already resolved once per app session (see src/app/_layout.tsx), not to
// re-run the decay/bedtime catch-up a second time.
export async function checkForPoopAccumulation(stage: PetStage, now: Date = new Date()): Promise<PetProfile> {
  const profile = await getPetProfile();
  const updated = applyPoopAccumulation(profile, stage, now);
  if (updated !== profile) {
    savePetProfile(updated);
  }
  return updated;
}

// Simple explanation: this runs every time the player clicks/taps one
// poop pile. It removes 1 cleanup point from that pile. If the pile still
// needs more clicks, it stays on the floor with a lower count. If this
// was its last click, the pile is removed completely. Other piles are
// never touched.
// One "Clean Up!" click on ONE specific pile (by id) — removes exactly one
// cleanup action from that pile alone (e.g. one mop swipe), per its size's
// own difficulty (POOP_CLEANUP_ACTIONS above: Small=1, Medium=2, Large=3).
// Every OTHER pile is returned completely untouched — cleaning one pile
// must never affect any other pile's own state. An unknown/already-gone
// pileId is a silent no-op (returns the same profile reference), not an
// error — e.g. a stale button press after the pile was already cleared by
// something else.
//
// This is "clean the floor", not "clean Kitty": it never restores
// Cleanliness (only bathePet in @/utils/pet-bathing.ts does that) and
// never clears `needsBath` (only a completed Bathroom wash/dry sequence
// will, once implemented — see @/utils/pet-profile.ts) — Kitty keeps
// showing as Dirty Kitty (isPetDirty in @/utils/pet-needs.ts) after every
// pile is cleared, via needsBath, until she's actually bathed.
//
// Rescheduling: fully removing a pile (its last cleanup click) is the only
// case that reschedules nextPoopEventAt — decrementing a Medium/Large pile
// that still has clicks left doesn't free up accumulation room, so it
// doesn't need a fresh schedule. Removing the pile that brings the floor
// back to fully clean (0 piles) reschedules a fresh random 3-8h first-pile
// wait, same as a newly-adopted/freshly-bathed pet. Removing a pile that
// still leaves others behind reschedules a fresh 2h accumulation window —
// so cleaning up always buys at least a little breathing room before the
// next pile could appear, rather than one potentially appearing instantly
// if the schedule had gone stale while piles sat at the max.
export function applyCleanUpPile(profile: PetProfile, pileId: string, now: Date = new Date()): PetProfile {
  const pile = profile.poopPiles.find((p) => p.id === pileId);
  if (!pile) return profile;

  const remaining = pile.cleanupRemaining - 1;
  if (remaining > 0) {
    const poopPiles = profile.poopPiles.map((p) => (p.id === pileId ? { ...p, cleanupRemaining: remaining } : p));
    return { ...profile, poopPiles };
  }

  const poopPiles = profile.poopPiles.filter((p) => p.id !== pileId);
  const nextPoopEventAt = poopPiles.length === 0 ? scheduleFirstPileEvent(now) : scheduleNextPileEvent(now);
  return { ...profile, poopPiles, nextPoopEventAt };
}

// Simple explanation: loads the saved pet data, cleans up one pile, and
// saves the result.
export async function cleanUpPile(pileId: string, now: Date = new Date()): Promise<PetProfile> {
  const profile = await getPetProfile();
  const cleaned = applyCleanUpPile(profile, pileId, now);
  if (cleaned !== profile) {
    savePetProfile(cleaned);
  }
  return cleaned;
}

// Simple explanation: a developer-only shortcut that pretends 2 hours
// have passed, so testers don't have to actually wait to see poop pile up.
// TEMPORARY, test-only — simulates exactly one POOP_PILE_ACCUMULATION_INTERVAL_HOURS
// (2h) tick of real time passing, by rewinding the stored schedule into the
// past just far enough that applyPoopAccumulation's own real logic sees it
// as due, then running that real logic normally. Exported for the dev-only
// "Fast-Forward Accumulation" test button (src/app/index.tsx) — this
// deliberately reuses applyPoopAccumulation itself rather than a separate
// simplified simulation, so pressing it exercises the exact same
// first-pile/catch-up-loop/max-piles behavior a real 2-hour wait would,
// just without actually waiting. Respects the same isSleeping/Egg-stage
// gate applyPoopAccumulation always has — it's a no-op in either case,
// same as the real system.
export function applyDevFastForwardAccumulation(profile: PetProfile, stage: PetStage, now: Date = new Date()): PetProfile {
  const rewound: PetProfile = { ...profile, nextPoopEventAt: now.toISOString() };
  return applyPoopAccumulation(rewound, stage, now);
}

// Simple explanation: a developer-only shortcut that removes all poop
// piles at once, for quickly resetting the floor while testing.
// TEMPORARY, test-only — clears every active pile at once (not something
// the real "Clean Up!" UI ever does — players clean piles one at a time,
// see applyCleanUpPile above) and reschedules a fresh random 3-8h
// first-pile wait, same as if every pile had been cleaned up individually
// down to zero. Exported for the dev-only "Clear All Piles" test button.
// Deliberately does NOT touch needsBath — same "clean the floor, not
// Kitty" rule every other cleanup function here follows.
export function applyClearAllPiles(profile: PetProfile, now: Date = new Date()): PetProfile {
  if (profile.poopPiles.length === 0) return profile;
  return { ...profile, poopPiles: [], nextPoopEventAt: scheduleFirstPileEvent(now) };
}
