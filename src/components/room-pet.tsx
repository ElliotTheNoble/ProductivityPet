import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { getStageImage } from '@/components/pet-placeholder';
import { SpriteCrop } from '@/components/sprite-crop';
import { getBathingStepArt, type BathingStep } from '@/utils/bathing-stage-art';
import type { PetStage } from '@/utils/pet-stage';
import { getRoomPetArt } from '@/utils/room-pet-art';
import type { RoomSlug } from '@/utils/rooms';

type RoomPetProps = {
  roomSlug: RoomSlug;
  stage: PetStage;
  // Whether Kitty currently counts as dirty (see isPetDirty in
  // @/utils/pet-needs.ts), passed down from @/components/room-detail-screen.tsx.
  // Only affects the Bathroom's shared getStageImage branch below — the 4
  // activity rooms keep their own dedicated sprite art regardless of this
  // value, per the dirty-kitty spec (Study Room/Gym/Bedroom/Kitchen don't
  // get a dirty variant yet). Optional/defaulted to false so this stays a
  // no-op for any caller that doesn't pass it.
  isDirty?: boolean;
  // The real petProfile.needsBath value, passed down from
  // room-detail-screen.tsx — used specifically (instead of the broader
  // isDirty above) to decide whether a fresh poop accident should
  // override an active Dry hold; see isShowingBathDryHold's own branch
  // below for why. Optional/defaulted to false, same no-op convention.
  needsBath?: boolean;
  // The exact bathing sprite frame to show right now — e.g. { step:
  // 'soap', stepNumber: 2 } means soap_2.png's crop for this stage.
  // Passed down from @/components/room-detail-screen.tsx, which computes
  // this as `miniGameFrame ?? lastBathingFrameRef.current`: the LIVE
  // frame while a tool is selected and its phase isn't done yet, or —
  // whenever that's not the case (no tool selected, or its phase just
  // finished) — the last real frame that WAS live, held in place instead
  // of disappearing. That "gap hold" is what stops Kitty's sprite from
  // flashing back to Dirty between phases, or right after Blow Dry
  // finishes but before completeBathing() has actually resolved — see
  // room-detail-screen.tsx's own comment on lastBathingFrameRef for the
  // full reasoning. Checked FIRST, below, ahead of isShowingBathDryHold —
  // whichever of the two this component's own caller decided to populate
  // is simply whatever should currently win. Only ever matters for
  // roomSlug === 'bathroom' AND a non-Egg stage, same no-op-by-default
  // convention as isDirty above.
  bathingFrame?: { step: BathingStep; stepNumber: number };
  // True while Kitty should still be showing her final Dry pose from a
  // bath that already finished (see BATH_DRY_HOLD_MS/isShowingBathDryHold
  // in @/utils/pet-bathing.ts) — passed down already computed by
  // room-detail-screen.tsx (which also needs it to decide whether to keep
  // forcing a re-render until the hold ends), rather than this component
  // re-deriving it from a raw timestamp a second time. Same
  // roomSlug/stage scoping as bathingFrame above. Only actually takes
  // effect while `needsBath` is ALSO false — see that branch's own
  // comment below for why a fresh poop accident during this window
  // overrides it (and why needsBath, not the broader isDirty, is the
  // right check here).
  isShowingBathDryHold?: boolean;
};

// Shows the pet in its Room detail page, at its current growth stage.
// Purely decorative: no Feed/Bath/Play/Rest buttons, no need bars, and no
// equippedAccessoryId prop at all — accessories can't render here because
// this component never even accepts/looks at that value, not because of a
// flag that hides it. The Living Room's own pet
// (@/components/pet-placeholder.tsx, used via @/components/pet-room.tsx
// on Home) is a completely separate component and keeps rendering
// equipped accessories exactly as before.
//
// Two rendering paths, depending on room and stage:
// - Egg (every room) and Bathroom (every stage — it has no dedicated
//   activity sprite sheet of its own yet, unlike Study Room/Gym/Bedroom/
//   Kitchen) use the SAME shared "normal" pet art Home already shows, via
//   getStageImage (@/components/pet-placeholder.tsx) — reusing those
//   exact assets/aspect ratios rather than duplicating them.
// - Every other room/stage combination (Study Room/Gym/Bedroom/Kitchen,
//   any stage but Egg) uses that room's own activity sprite crop — see
//   @/utils/room-pet-art.ts.
//
// Sizing: fills whatever box its parent gives it (see styles.wrapper),
// measured via onLayout — the same "measure the real box, then hand exact
// pixel dimensions down" technique already used for Memory Match's card
// grid (see memory-match-game.tsx's boardSurface). Both rendering paths
// contain-fit within that box (letterboxing on whichever axis the
// artwork's own aspect ratio doesn't fill) rather than stretching.
export function RoomPet({
  roomSlug,
  stage,
  isDirty = false,
  needsBath = false,
  bathingFrame,
  isShowingBathDryHold = false,
}: RoomPetProps) {
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setBoxSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }

  const hasBox = boxSize.width > 0 && boxSize.height > 0;

  if (stage === 'Egg' || roomSlug === 'bathroom') {
    // bathingFrame/isShowingBathDryHold only ever matter for the Bathroom
    // (Egg has no bathing art at all — she can't be bathed before she's
    // even hatched) — checking `stage !== 'Egg'` here (rather than only
    // trusting room-detail-screen.tsx to never pass these for an Egg) is
    // what guarantees the Egg can never show bathing art, even if one of
    // these somehow stayed set from a previous non-Egg stage (e.g.
    // switched away via the developer Stage Preview).
    //
    // Sprite priority order for the Bathroom, enforced by checking these
    // in this exact sequence: (1) bathingFrame — a live mini-game frame
    // OR the "gap hold" of whichever frame was last live (see that prop's
    // own comment above) — always wins when present, since it means
    // either the player is actively bathing right now, or a bath just
    // finished and completeBathing() hasn't resolved yet; (2)
    // isShowingBathDryHold && !needsBath — the 30-minute post-bath Dry
    // pose, unless a genuinely NEW poop accident has happened since (see
    // that branch's own comment below); (3) otherwise, the normal getStageImage
    // call just below, which itself swaps to the Dirty variant whenever
    // isDirty is true. Home (@/components/pet-placeholder.tsx) enforces
    // the same (2)-then-(3) order, minus (1) — Home never shows live
    // mini-game frames, only the Bathroom does.
    const isBathroomNonEgg = roomSlug === 'bathroom' && stage !== 'Egg';
    if (isBathroomNonEgg && bathingFrame) {
      const art = getBathingStepArt(bathingFrame.step, bathingFrame.stepNumber, stage);
      return (
        <View style={styles.wrapper} onLayout={handleLayout}>
          {hasBox ? <SpriteCrop {...art} width={boxSize.width} height={boxSize.height} /> : null}
        </View>
      );
    }
    if (isBathroomNonEgg && isShowingBathDryHold && !needsBath) {
      // The last Dry frame (stepNumber 5) — her final Dry pose, held for a
      // while after the real sequence finishes. Same crop data bathingFrame
      // itself would use for that exact frame, just driven by the saved
      // lastBathCompletedAt timestamp instead of the live animation index.
      //
      // Checks `!needsBath` specifically, NOT the broader `!isDirty`
      // (which also includes poopPiles.length > 0 and low Cleanliness).
      // completeBathing() always clears needsBath and restores
      // Cleanliness to 100, so right after a successful bath needsBath is
      // reliably false — but isDirty could still read true for a reason
      // that PRE-DATES this bath and has nothing to do with it: an old
      // poop pile the player simply hasn't cleaned off the floor yet
      // (cleaning the floor and bathing Kitty are deliberately separate
      // actions — see @/utils/pet-poop.ts). Using the full isDirty here
      // would let that stale, unrelated mess incorrectly override a bath
      // that genuinely just succeeded. needsBath only ever turns true
      // again from a GENUINELY NEW poop event, so checking it alone is
      // what correctly still lets a fresh accident during this same hold
      // immediately switch back to Dirty (the branch just below), while
      // an old, already-existing pile does not.
      const art = getBathingStepArt('dry', 5, stage);
      return (
        <View style={styles.wrapper} onLayout={handleLayout}>
          {hasBox ? <SpriteCrop {...art} width={boxSize.width} height={boxSize.height} /> : null}
        </View>
      );
    }
    // isDirty only ever matters for the Bathroom (Egg has no dirty variant
    // at all — getStageImage falls through to normal Egg art regardless —
    // and the other 3 rooms that can reach this branch via Egg shouldn't
    // show Dirty Kitty before she's even hatched).
    const { source, aspectRatio } = getStageImage(stage, roomSlug === 'bathroom' && isDirty);
    return (
      <View style={styles.wrapper} onLayout={handleLayout}>
        {hasBox ? (
          <Image
            source={source}
            contentFit="contain"
            style={{
              width: Math.min(boxSize.width, boxSize.height * aspectRatio),
              height: Math.min(boxSize.height, boxSize.width / aspectRatio),
            }}
          />
        ) : null}
      </View>
    );
  }

  // roomSlug is narrowed to RoomPetSlug and stage to RoomPetStage by the
  // early return above (neither 'bathroom' nor 'Egg' reaches here).
  const art = getRoomPetArt(roomSlug, stage);
  return (
    <View style={styles.wrapper} onLayout={handleLayout}>
      {hasBox ? <SpriteCrop {...art} width={boxSize.width} height={boxSize.height} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
