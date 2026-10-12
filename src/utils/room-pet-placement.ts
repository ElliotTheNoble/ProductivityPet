import type { PetStage } from '@/utils/pet-stage';
import type { RoomSlug } from '@/utils/rooms';

// Centralized, stage-aware configuration for where/how big Kitty renders
// in each of the 5 Room detail pages (Study Room, Gym, Bedroom, Kitchen —
// each with their own dedicated activity sprite sheet, see
// @/utils/room-pet-art.ts — and Bathroom, which instead reuses the same
// shared "normal" pet art every stage already has via
// @/components/pet-placeholder.tsx, since it has no activity sheet of its
// own yet). This config is deliberately keyed by the full RoomSlug (not
// the narrower, sprite-art-only RoomPetSlug) precisely so it covers
// Bathroom too — positioning is a room-level concern independent of which
// art-rendering mechanism @/components/room-pet.tsx picks for that room.
// Previously these were a scattered set of per-room constants
// (ROOM_PET_AREA_OVERRIDE, BEDROOM_WIDE_DESKTOP_*, KITCHEN_*) directly in
// room-detail-screen.tsx — relocated and generalized here into one
// config + one resolver function, with the exact same resulting numbers
// for every room/stage combination that existed before (see
// ROOM_PET_PLACEMENTS below — nothing about Study Room/Gym/Bedroom/
// Kitchen's current on-screen position or size changed by this refactor).
//
// ADJUSTING ONE STAGE IN ONE ROOM: add (or edit) that stage's entry inside
// that one room's own `stageAdjustments` in ROOM_PET_PLACEMENTS below —
// e.g. to make Adult Kitty sit 10px higher in the Kitchen than Kitchen's
// base position, without touching Baby/Young/any other stage or any other
// room:
//
//   kitchen: {
//     ...,
//     stageAdjustments: { Adult: { offsetYPx: 10 } },
//   }
//
// Every stage with no entry (and every room's stageAdjustments is empty
// by default) falls back to that room's own base numbers untouched.

// Optional, additive fine-tuning for one specific growth stage within one
// room. Every field is optional — a stage only needs the ones it actually
// wants to change from the room's base placement.
export type PetStageAdjustment = {
  // Added to the room's total horizontal rightward shift, in px.
  offsetXPx?: number;
  // Shifts Kitty vertically by this many px, positive moving her further
  // UP the screen. Applied as a translateY transform on her box (see
  // resolveRoomPetPlacement), not added to the room's own paddingBottom —
  // paddingBottom can't go negative, so a room with a small base value
  // (e.g. Kitchen's 32px) combined with a stage wanting to move DOWN by
  // more than that would silently fail to move at all if this used
  // padding instead. A transform works the same way regardless of sign,
  // magnitude, or the room's own base paddingBottomPx.
  offsetYPx?: number;
  // Multiplies the room's base widthPercent/maxWidthPx. Omitted (or 1)
  // means "same size as this room's base"; 1.15 means 15% larger, etc.
  // Different growth-stage artwork can have different amounts of
  // transparent padding baked into its own crop (see
  // @/utils/room-pet-art.ts's measured crops) — this is what lets a
  // stage whose art sits smaller/larger within its own crop box be
  // nudged to read as a consistent size without needing a whole separate
  // crop re-measurement.
  scale?: number;
};

export type RoomPetPlacement = {
  // Horizontal anchor for styles.petArea's alignItems in
  // room-detail-screen.tsx. 'center' is the original shared default;
  // 'flex-start' + paddingLeftPercent is what Bedroom uses instead, to
  // sit Kitty near the left-side pillows rather than screen-center.
  horizontalAlign: 'center' | 'flex-start';
  // Only meaningful when horizontalAlign is 'flex-start' — how far in
  // from the left edge, as a PERCENTAGE of the available width (not a
  // fixed px value), so it scales with screen width the same way the
  // rest of this responsive layout does.
  paddingLeftPercent?: number;
  // An unconditional extra rightward nudge in px, applied at every
  // window width (Kitchen's case) — on top of whatever
  // horizontalAlign/paddingLeftPercent already produce.
  shiftRightPx?: number;
  // An EXTRA rightward nudge that only applies once the window is at
  // least this wide (Bedroom's case): the percentage-based inset reads
  // correctly on a half-screen-ish window, but needs an additional fixed
  // push on a genuinely wide full-screen desktop window, where the same
  // percentage translates to a much bigger pixel gap.
  wideDesktop?: { breakpointPx: number; extraShiftRightPx: number };
  // Vertical anchor — styles.petArea's paddingBottom. Larger values move
  // Kitty further up (she's bottom-anchored).
  paddingBottomPx: number;
  // Base box size as a percentage of the room's own available width,
  // capped at a px maximum — the same "responsive but not unbounded"
  // sizing every other responsive box in this app already uses. The box
  // stays square (aspectRatio: 1, set once in room-detail-screen.tsx's
  // styles.petBox, not duplicated per room here); RoomPet contain-fits
  // its actual sprite crop inside that box without stretching regardless
  // of the box's size (see @/components/room-pet.tsx).
  widthPercent: number;
  maxWidthPx: number;
  // Optional per-stage fine-tuning — see PetStageAdjustment above. Empty/
  // omitted by default everywhere; only add an entry for a stage that
  // actually needs something different from this room's base numbers.
  stageAdjustments?: Partial<Record<PetStage, PetStageAdjustment>>;
};

// The single source of truth for every room's pet placement. Study
// Room/Gym use the plain shared defaults this whole system originally
// had; Bedroom and Kitchen carry forward the exact values reached after
// several rounds of manual visual tuning (see room-detail-screen.tsx's
// git history / chat log if these are ever in question) — this refactor
// only changes WHERE those numbers live, not what they resolve to for any
// room/stage combination tested so far (no stageAdjustments are populated
// yet for any room, so every stage currently renders identically to its
// room's base placement).
export const ROOM_PET_PLACEMENTS: Record<RoomSlug, RoomPetPlacement> = {
  'study-room': {
    horizontalAlign: 'center',
    paddingBottomPx: 32,
    widthPercent: 55,
    maxWidthPx: 320,
    // All 4 non-Egg stages ~20% bigger, position otherwise untouched (no
    // offsetXPx/offsetYPx on any of them) — this deliberately keeps both
    // anchors Study Room already uses exactly as they were:
    // - Horizontal: horizontalAlign is 'center' (flexbox centering), so a
    //   wider box still grows symmetrically outward from the same
    //   horizontal center — no offsetXPx needed to compensate.
    // - Vertical: paddingBottomPx (32) is unchanged, so the box's BOTTOM
    //   edge — where Kitty's feet/resting point sit — stays exactly
    //   where it was; a taller box only extends upward from that same
    //   anchored bottom (the same mechanism already used for Kitchen's
    //   and Bedroom's own scale adjustments), which is what keeps a
    //   standing/sitting character looking like she grew in place rather
    //   than floating or sinking.
    stageAdjustments: {
      Hatchling: { scale: 1.2 },
      Baby: { scale: 1.2 },
      Young: { scale: 1.2 },
      Adult: { scale: 1.2 },
    },
  },
  gym: {
    horizontalAlign: 'center',
    paddingBottomPx: 32,
    widthPercent: 55,
    maxWidthPx: 320,
  },
  bedroom: {
    horizontalAlign: 'flex-start',
    paddingLeftPercent: 18,
    wideDesktop: { breakpointPx: 1000, extraShiftRightPx: 200 },
    paddingBottomPx: 270,
    widthPercent: 55,
    maxWidthPx: 320,
    // All 4 non-Egg stages confirmed to have the correct HORIZONTAL
    // position already (the 18% inset + wideDesktop nudge above, both
    // untouched and still applying identically regardless of stage) — so
    // every stage here only sets offsetYPx (+30, higher/further from the
    // bottom) and scale (1.15, +15%), never offsetXPx. Applied uniformly
    // to all 4 since the request was "all four stages," not any one in
    // particular.
    stageAdjustments: {
      Hatchling: { offsetYPx: 30, scale: 1.15 },
      Baby: { offsetYPx: 30, scale: 1.15 },
      Young: { offsetYPx: 30, scale: 1.15 },
      Adult: { offsetYPx: 30, scale: 1.15 },
    },
  },
  kitchen: {
    horizontalAlign: 'center',
    shiftRightPx: 280,
    paddingBottomPx: 32,
    widthPercent: 79,
    maxWidthPx: 460,
    // Hatchling sat too high and too far left relative to Kitchen's base
    // position for the other stages — a negative offsetYPx moves her down
    // (see PetStageAdjustment.offsetYPx above for why this is applied as
    // a transform rather than added to paddingBottom); offsetXPx adds to
    // Kitchen's own rightward shiftRightPx, moving her further right by
    // that same amount (history: 60px -> 120px -> 180px). Size is
    // untouched (no scale).
    //
    // Baby sat too far left as well (independent of Hatchling's own
    // adjustment above — each stage's entry is self-contained) — nudged
    // further right, same offsetXPx mechanism, no vertical/size change
    // (history: 60px -> 120px).
    //
    // Young sat too far left too — nudged right, same mechanism,
    // independent of Hatchling/Baby's own entries (history: 60px ->
    // 120px -> 140px).
    //
    // Adult sat too far left too — nudged right, same mechanism,
    // independent of every other stage's own entry (history: 60px ->
    // 120px, this pass).
    //
    // Egg has no stageAdjustments entry anywhere and always uses the
    // shared egg_nest art instead (see @/components/room-pet.tsx) — keeps
    // Kitchen's plain base placement exactly as before.
    stageAdjustments: {
      Hatchling: { offsetYPx: -60, offsetXPx: 180 },
      Baby: { offsetXPx: 120 },
      Young: { offsetXPx: 140 },
      Adult: { offsetXPx: 120 },
    },
  },
  // Base position is a starting guess, not yet visually confirmed
  // (this room's background hasn't been tuned against like the other 4
  // were) — centered, with a slightly larger paddingBottomPx than the
  // 32px plain default (Study Room/Gym) as a first guess at sitting her
  // up off the very bottom edge, roughly where a tub's basin might be.
  bathroom: {
    horizontalAlign: 'center',
    paddingBottomPx: 48,
    widthPercent: 50,
    maxWidthPx: 300,
    // All 4 non-Egg stages ~25% bigger, position otherwise untouched (no
    // offsetXPx/offsetYPx) — same reasoning as Study Room's own 20%
    // increase: horizontalAlign is 'center', so a wider box still grows
    // symmetrically from the same horizontal center, and
    // paddingBottomPx (48) is unchanged, so the box's bottom edge — where
    // Kitty's feet/resting point sit — stays exactly where it was; a
    // taller box only extends upward from that same anchored bottom.
    // Egg never reads this (it uses the separate shared egg_nest art
    // path in @/components/room-pet.tsx, with no stage-adjustment concept
    // at all), so its size/artwork are completely unaffected.
    stageAdjustments: {
      Hatchling: { scale: 1.25 },
      Baby: { scale: 1.25 },
      Young: { scale: 1.25 },
      Adult: { scale: 1.25 },
    },
  },
};

export type ResolvedRoomPetPlacement = {
  areaStyle: {
    paddingBottom: number;
    alignItems: 'center' | 'flex-start';
    paddingLeft?: `${number}%`;
  };
  boxStyle: {
    width: `${number}%`;
    maxWidth: number;
    marginLeft?: number;
    transform?: [{ translateY: number }];
  };
};

// Combines a room's base placement with (if present) the CURRENTLY
// DISPLAYED growth stage's own adjustment, plus the current window width
// (for Bedroom's wide-desktop nudge), into the exact style values
// room-detail-screen.tsx applies to petArea/petBox.
//
// `stage` should be whatever stage is actually being rendered — the real
// rendered stage, or the dev-only Pet Stage Preview override when one is
// active (see @/utils/dev-stage-preview.ts) — room-detail-screen.tsx
// already computes that single `displayedStage` value for the art itself,
// so passing the same value here keeps positioning and artwork always in
// sync, including while previewing. This function only ever READS the
// config above; it never writes anywhere, so previewing a different stage
// through it can't affect real saved growth stage, paid upgrades, Paw
// Tokens, or any other progress.
export function resolveRoomPetPlacement(
  roomSlug: RoomSlug,
  stage: PetStage,
  windowWidth: number
): ResolvedRoomPetPlacement {
  const placement = ROOM_PET_PLACEMENTS[roomSlug];
  const adjustment = placement.stageAdjustments?.[stage];
  const scale = adjustment?.scale ?? 1;

  let shiftRightPx = (placement.shiftRightPx ?? 0) + (adjustment?.offsetXPx ?? 0);
  if (placement.wideDesktop && windowWidth >= placement.wideDesktop.breakpointPx) {
    shiftRightPx += placement.wideDesktop.extraShiftRightPx;
  }

  const offsetYPx = adjustment?.offsetYPx ?? 0;

  return {
    areaStyle: {
      // Room-level only — NEVER adjusted by a stage's offsetYPx (see why
      // below, at boxStyle.transform).
      paddingBottom: placement.paddingBottomPx,
      alignItems: placement.horizontalAlign,
      paddingLeft:
        placement.horizontalAlign === 'flex-start' && placement.paddingLeftPercent !== undefined
          ? `${placement.paddingLeftPercent}%`
          : undefined,
    },
    boxStyle: {
      width: `${placement.widthPercent * scale}%`,
      maxWidth: placement.maxWidthPx * scale,
      marginLeft: shiftRightPx !== 0 ? shiftRightPx : undefined,
      // A stage's offsetYPx is applied as a translateY transform on the
      // box, NOT added to paddingBottom above — paddingBottom can't go
      // negative (React Native clamps/ignores it), so a room with a small
      // base paddingBottomPx (e.g. Kitchen's 32px) combined with a stage
      // wanting to move DOWN by more than that would silently fail to
      // move at all if this used padding. A transform has no such floor
      // in either direction, so offsetYPx works the same way (positive =
      // up) regardless of the room's own base paddingBottomPx or how big
      // the adjustment is. translateY itself is inverted (screen-down is
      // positive Y) since offsetYPx's own convention is "positive = up".
      transform: offsetYPx !== 0 ? [{ translateY: -offsetYPx }] : undefined,
    },
  };
}
