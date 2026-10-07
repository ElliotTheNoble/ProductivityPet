import type { PetStage } from '@/utils/pet-stage';

// How a worn accessory is positioned/sized within the pet's own
// responsive box (see accessoryFrame in pet-placeholder.tsx) — expressed
// as percentages of that box, the same technique the first (stage-
// agnostic) placement already used. The `${number}%` literal type (not a
// plain string) matches React Native's own DimensionValue type exactly.
// width/marginTop are required since every placement needs both;
// marginLeft is optional and only needed if an accessory for some stage
// shouldn't be horizontally centered (the overlay centers by default via
// alignItems:'center').
type Percent = `${number}%`;

export type AccessoryPlacement = {
  width: Percent;
  marginTop: Percent;
  marginLeft?: Percent;
  // Optional: a small rotation (e.g. '2deg') applied to the whole
  // accessory overlay box as a transform — purely a cosmetic tilt so the
  // accessory doesn't sit perfectly straight. Positive values rotate
  // clockwise. Never affects the sprite crop math itself.
  rotate?: `${number}deg`;
  // Optional: a horizontal-only stretch (e.g. 1.08 for 8% wider) applied
  // to the whole accessory overlay box as a transform, leaving vertical
  // size (and `width`/the crop math) untouched. Applied BEFORE rotate in
  // the transform array (see pet-placeholder.tsx), so the stretch happens
  // in the accessory's own original axes and rotate then tilts the
  // already-stretched shape — not the other way around, which would skew
  // it along the screen's horizontal axis instead.
  scaleX?: number;
};

// A "slot" is a category of accessory. For neckCollar, every bow (very
// similar shapes/proportions across all 26) shares one placement rule per
// stage — Pink Bow and every other bow in bows_1.png/bows_2.png all read
// from the same neckCollar placement below. Hats vary far more in shape
// (a beanie vs. a tall wizard hat vs. a beret vs. a party hat), so headHat
// does NOT get a shared placement here — see the per-item
// AccessoryArt.placementOverrides field in @/utils/pet-accessories.ts
// instead, and the gating in pet-placeholder.tsx that only lets
// neckCollar fall back to this shared table. neckBandana is the same idea
// as headHat: each bandana gets its own override once tuned, no shared
// default.
export type AccessorySlot = 'neckCollar' | 'headHat' | 'neckBandana';

// Where the pet is being drawn — NOT the same thing as PetStage. Home and
// Stats both render all five stages, but with completely different
// artwork (different poses, dimensions, and proportions per the Stats
// pet art) — so a placement tuned for Home's Baby cannot be assumed to
// also work for Stats' Baby. Each surface needs its own independently-
// tuned placement per stage, which is exactly why this is a separate key
// from PetStage rather than being folded into it.
export type PetSurface = 'home' | 'stats';

// Keyed as [surface][slot][stage]. Deliberately NOT a plain
// Record<PetSurface, ...> — that would force every surface/slot/stage
// combination to have a value, which would mean inventing numbers for
// Stats (and for Home's untested stages) rather than actually tuning
// them. Partial here means "no entry yet" is a legitimate, representable
// state, and getAccessoryPlacement below returns undefined for it instead
// of a guess — callers (see pet-placeholder.tsx) already treat a missing
// placement as "don't render this accessory" rather than an error.
type PlacementTable = Partial<
  Record<PetSurface, Partial<Record<AccessorySlot, Record<PetStage, AccessoryPlacement>>>>
>;

const PLACEMENT_TABLE: PlacementTable = {
  home: {
    neckCollar: {
      // Only Baby has an actually-confirmed value — tuned through several
      // rounds of visual feedback on the real Home pet (24% wide, 82%
      // from the top of the pet's own box, horizontally centered) until
      // the bow read correctly as a neck/collar accessory. The other four
      // stages are plain copies of that same confirmed number, NOT a
      // guess at what each one specifically needs — they still need their
      // own visual tuning pass later, the same way Baby got one. Nothing
      // here is a Stats placement; see the module comment on PetSurface.
      Egg: { width: '24%', marginTop: '82%' },
      Hatchling: { width: '24%', marginTop: '82%' },
      Baby: { width: '24%', marginTop: '82%' }, // confirmed, Home surface
      Young: { width: '24%', marginTop: '82%' },
      Adult: { width: '24%', marginTop: '82%' },
    },
    // No headHat entry here — unlike bows, hats vary too much in shape to
    // share one placement safely (confirmed by the Rainbow Party Hat
    // needing its own very different numbers from the White Cat-Ear
    // Beanie). Every headHat item gets its placement from its own
    // AccessoryArt.placementOverrides in @/utils/pet-accessories.ts
    // instead — hat-1 and hat-12 already have theirs; any other hat
    // renders nothing until it gets one too. Same story for neckBandana,
    // which never had a shared entry here to begin with.
  },
  // stats: intentionally omitted — no Stats placement has been tuned
  // (or even visually attempted) yet, and Stats' pet art isn't wired up
  // to accessories at all yet. Add a 'stats' entry here, shaped the same
  // way as 'home' above, once that work actually starts — one stage at a
  // time, each one visually confirmed the same way Home's Baby was.
};

// Looks up where a given accessory slot should sit for a given pet stage
// on a given surface (Home vs Stats). Returns undefined if that specific
// surface/slot/stage combination hasn't been tuned yet — callers should
// treat that as "don't render this accessory here" rather than falling
// back to some other surface's numbers, since Home and Stats art don't
// share proportions.
export function getAccessoryPlacement(
  surface: PetSurface,
  slot: AccessorySlot,
  stage: PetStage
): AccessoryPlacement | undefined {
  return PLACEMENT_TABLE[surface]?.[slot]?.[stage];
}
