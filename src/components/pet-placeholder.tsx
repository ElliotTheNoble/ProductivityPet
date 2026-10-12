import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP, DEV_UNTUNED_HEADHAT_FALLBACK_PLACEMENT } from '@/utils/dev-flags';
import { PET_ACCESSORY_ART } from '@/utils/pet-accessories';
import { getAccessoryPlacement } from '@/utils/pet-accessory-placement';
import { DIRTY_CLEANLINESS_THRESHOLD } from '@/utils/pet-needs';
import type { PoopPile, PoopSize } from '@/utils/pet-profile';
import type { PetStage } from '@/utils/pet-stage';

// How far up (in px, via a translateY transform) Kitty's own art — and
// her equipped accessory, so it keeps tracking her body — sits in the
// Living Room, relative to its normal position. Applies to every stage
// except Egg (an Egg doesn't get nudged — it stays exactly where it's
// always been). Deliberately does NOT move petWrap itself (the box poop
// piles are positioned inside, via left: 6%/bottom: 4% in
// poopFloorIndicator below) — only the pet's own Image and accessory
// overlay shift, so the floor/poop reference frame, and the needs bars
// below (an entirely separate section, not inside this box at all), are
// completely unaffected; the visual gap between Kitty and the needs bars
// simply grows by this same amount. Only affects the Living Room
// (PetPlaceholder) — @/components/room-pet.tsx (every other room) is a
// separate component untouched by this constant.
const KITTY_LIVING_ROOM_OFFSET_Y_PX = -30;

// A pile's actual floor position (offsetXPx/offsetYPx, picked once at
// creation and collision-checked against its siblings — see
// placePoopPile in @/utils/pet-poop.ts) is now fully resolved before it
// ever reaches this component, so rendering it is just applying those two
// numbers directly as a translateX/translateY — no stage lookup or slot
// table needed here anymore.

type PetPlaceholderProps = {
  stage: PetStage;
  message?: string | null;
  // The id of the currently-equipped Pet Accessory (see
  // @/utils/pet-equipment.ts), passed down from Home — null/undefined
  // means nothing is equipped, so the pet renders exactly as it always
  // has. Only ids present in PET_ACCESSORY_ART actually render anything;
  // this intentionally stays silent (not an error) for any other id, so
  // an item that's equippable-but-not-yet-wired-up-visually just doesn't
  // show rather than breaking the pet's rendering.
  equippedAccessoryId?: string | null;
  // The real Hunger value from the persistent Pet Profile (see
  // @/utils/pet-profile.ts), passed down from Home — optional so this
  // component never has to invent a fake value before the profile has
  // loaded; the bar simply doesn't render until a real number arrives.
  hunger?: number;
  // Same as hunger, for Cleanliness — real petProfile.cleanliness value,
  // passed down from Home.
  cleanliness?: number;
  // Same as hunger, for Happiness.
  happiness?: number;
  // Same as hunger, for Energy.
  energy?: number;
  // The real petProfile.poopPiles value, passed down from Home — every
  // poop pile currently on the floor (see @/utils/pet-poop.ts's
  // accumulation system). Its length > 0 is combined with
  // cleanliness/needsBath below to decide whether Dirty Kitty art should
  // show (see isPetDirty in @/utils/pet-needs.ts; this component
  // recomputes the same single combined check locally rather than
  // importing that helper, since it only ever has these individual
  // fields, not a full PetProfile, passed down to it). Also controls the
  // floor poop artwork/Clean Up buttons below — one of each PER pile,
  // each cleaned up independently.
  poopPiles?: PoopPile[];
  // The real petProfile.needsBath value, passed down from Home — true
  // means Kitty herself still needs an actual bath after a past poop
  // event, independent of poopPiles (the floor mess) and Cleanliness.
  // Keeps Dirty Kitty showing after every pile is cleaned up and after
  // Cleanliness is restored, until a completed Bathroom wash/dry
  // sequence clears it (not implemented yet). Does NOT affect the floor
  // artwork/Clean Up buttons — those are driven by poopPiles alone.
  needsBath?: boolean;
  // All optional so every existing caller (e.g. the Rooms hub's pet
  // preview, if any) keeps working unchanged without passing these — each
  // button only renders when its own handler is actually provided.
  onFeed?: () => void;
  isFeeding?: boolean;
  onBathe?: () => void;
  isBathing?: boolean;
  onPlay?: () => void;
  isPlaying?: boolean;
  onRest?: () => void;
  isResting?: boolean;
  // Cleans up ONE specific poop pile by id (see @/utils/pet-poop.ts's
  // cleanUpPile/applyCleanUpPile) — called with the id of whichever
  // pile's own "Clean Up!" button was pressed; every OTHER pile is left
  // untouched. The whole per-pile buttons section (not folded into
  // actionsRow above) only renders while `poopPiles` has at least one
  // entry AND this handler was actually provided, same "only show while
  // the handler is provided" convention as onFeed/onBathe/onPlay/onRest.
  onCleanUpPile?: (pileId: string) => void;
};

// Egg and Hatchling each have their own dedicated full illustration.
// Baby/Young/Adult are pre-cropped into their own standalone files, so
// every stage is simply "one image, sized to its own real aspect ratio" —
// no runtime sprite-cropping needed here (that technique needs a known
// pixel size, which this responsively-sized component doesn't have).
// Baby was cropped from the original shared sheet
// (assets/images/pets/pet_growth_stages.png); Young and Adult were
// re-cropped from assets/images/pets/pet_growth2.png (a 2017x780 sheet
// with Young on the left, Adult on the right, measured via an
// alpha-channel bounding-box scan with a safety margin, then visually
// verified before cropping — never guessed) and saved back over the same
// pet_young.png/pet_adult.png filenames, so neither this switch statement
// nor anything downstream needed to change paths, only the aspect ratios
// below (the new art's real pixel dimensions: 827x752 for Young,
// 769x780 for Adult — neither is square like the old placeholder art was).
// Exported so @/components/room-pet.tsx can reuse the exact same assets
// and aspect ratios for the Bathroom (which has no dedicated activity
// sprite sheet of its own yet — see that file) instead of duplicating
// these require() calls and measured aspect ratios a second time.
//
// `isDirty` (see isPetDirty in @/utils/pet-needs.ts — cleanliness at/below
// 20 OR an uncleaned poop) swaps Hatchling/Baby/Young/Adult to their Dirty
// Kitty variant, pre-cropped from assets/images/pets/dirty_kitty.png (a
// 2172x724 sheet, same canvas size and measurement methodology as the
// per-room activity sheets in @/utils/room-pet-art.ts: alpha-channel
// bounding-box scan per character with a safety margin, visually verified
// before cropping) the same way pet_young.png/pet_adult.png were
// pre-cropped from pet_growth2.png — standalone files so this stays a
// simple {source, aspectRatio} lookup with no runtime sprite-cropping
// needed here. Egg deliberately has no dirty variant and always falls
// through to its normal artwork regardless of `isDirty`.
export function getStageImage(stage: PetStage, isDirty: boolean = false) {
  if (isDirty) {
    switch (stage) {
      case 'Hatchling':
        return { source: require('@/assets/images/pets/dirty_hatchling.png'), aspectRatio: 421 / 455 };
      case 'Baby':
        return { source: require('@/assets/images/pets/dirty_baby.png'), aspectRatio: 541 / 409 };
      case 'Young':
        return { source: require('@/assets/images/pets/dirty_young.png'), aspectRatio: 600 / 541 };
      case 'Adult':
        return { source: require('@/assets/images/pets/dirty_adult.png'), aspectRatio: 537 / 600 };
    }
  }
  switch (stage) {
    case 'Egg':
      return { source: require('@/assets/images/pets/egg_nest.png'), aspectRatio: 1536 / 1024 };
    case 'Hatchling':
      return { source: require('@/assets/images/pets/kitten_nest.png'), aspectRatio: 1381 / 1139 };
    case 'Baby':
      return { source: require('@/assets/images/pets/pet_baby.png'), aspectRatio: 1 };
    case 'Young':
      return { source: require('@/assets/images/pets/pet_young.png'), aspectRatio: 827 / 752 };
    case 'Adult':
      return { source: require('@/assets/images/pets/pet_adult.png'), aspectRatio: 769 / 780 };
  }
}

// Simple explanation: returns the correct picture and size for one poop
// pile, based on whether it's Small, Medium, or Large.
// Floor poop artwork — one standalone pre-cropped file per size (Small/
// Medium/Large), cropped from the 4x5 grid of designs in
// assets/images/pets/kitty_poop.png (the original 1536x1024 sheet is left
// untouched). All 3 crops come from that sheet's own top row, which is the
// same swirl design simply drawn progressively bigger — columns 1, 3, and
// 5 were picked for Small/Medium/Large specifically for maximum size
// contrast while staying one consistent art style. Measured the same way
// as every other sprite crop in this app: an alpha-channel bounding-box
// scan with a safety margin (clamped within each design's large transparent
// gap from its neighbors), then visually verified before cropping — never
// guessed. `displayWidthPercent` is each size's floor footprint as a
// percentage of the pet's own box (see poopFloorIndicator below), so Large
// visibly takes up more floor space than Small rather than all 3 rendering
// at the same on-screen size. Typed as a `${number}%` template literal
// (same convention as AccessoryPlacement's `Percent` in
// @/utils/pet-accessory-placement.ts) so it's assignable directly to a
// View's `width` style.
export function getPoopArt(size: PoopSize): { source: number; aspectRatio: number; displayWidthPercent: `${number}%` } {
  switch (size) {
    case 'small':
      return { source: require('@/assets/images/pets/poop_small.png'), aspectRatio: 158 / 144, displayWidthPercent: '18%' };
    case 'medium':
      return { source: require('@/assets/images/pets/poop_medium.png'), aspectRatio: 228 / 176, displayWidthPercent: '24%' };
    case 'large':
      return { source: require('@/assets/images/pets/poop_large.png'), aspectRatio: 278 / 209, displayWidthPercent: '30%' };
  }
}

// Simple explanation: turns 'small' into 'Small' (capital letter), used
// in the accessibility label read out when a pile is focused/tapped.
function capitalizePoopSize(size: PoopSize): string {
  return size.charAt(0).toUpperCase() + size.slice(1);
}

export function PetPlaceholder({
  stage,
  message,
  equippedAccessoryId,
  hunger,
  cleanliness,
  happiness,
  energy,
  poopPiles,
  needsBath,
  onFeed,
  isFeeding = false,
  onBathe,
  isBathing = false,
  onPlay,
  isPlaying = false,
  onRest,
  isResting = false,
  onCleanUpPile,
}: PetPlaceholderProps) {
  const theme = useTheme();
  // Defaults to [] so every render below can just map over `piles`
  // without a separate undefined-check at each usage site — undefined
  // (prop omitted, e.g. while the profile hasn't loaded yet, or while
  // isDisplayedEgg gating omits it on Home) behaves identically to "no
  // piles".
  const piles = poopPiles ?? [];

  // Simple explanation: this whole block (down to handlePilePress) sets up
  // the fun animation when a player clicks/taps a poop pile — a wiggle,
  // an "N left!" bubble, and a sparkle when it's fully cleaned.
  //
  // Per-pile cleanup interaction state. Poop is cleaned by pressing the
  // artwork itself (see the Pressable in the floor-art render below) —
  // there's no separate button anymore. All of this is keyed by pile.id
  // so every pile's feedback/debounce is fully independent of its
  // siblings', same as the underlying cleanup data itself.
  //
  // pileAnimsRef holds each pile's Animated.Values, lazily created and
  // reused across rerenders (via getPileAnims below) rather than
  // recreated every render, which would reset any in-flight animation.
  // Pruned below whenever a pile is actually gone from `piles` (fully
  // cleaned, with its fade-out animation already finished) so this map
  // doesn't grow unbounded over a long session.
  const pileAnimsRef = useRef(
    new Map<
      string,
      {
        scale: Animated.Value;
        opacity: Animated.Value;
        flashOpacity: Animated.Value;
        sparkleOpacity: Animated.Value;
        sparkleScale: Animated.Value;
      }
    >()
  );
  // Simple explanation: gets (or creates, the first time) the animation
  // values for one pile, so the same wiggle/sparkle values keep being
  // reused for that pile instead of resetting every render.
  function getPileAnims(pileId: string) {
    let anims = pileAnimsRef.current.get(pileId);
    if (!anims) {
      anims = {
        scale: new Animated.Value(1),
        opacity: new Animated.Value(1),
        flashOpacity: new Animated.Value(0),
        sparkleOpacity: new Animated.Value(0),
        sparkleScale: new Animated.Value(0.6),
      };
      pileAnimsRef.current.set(pileId, anims);
    }
    return anims;
  }
  useEffect(() => {
    const activeIds = new Set(piles.map((p) => p.id));
    for (const id of pileAnimsRef.current.keys()) {
      if (!activeIds.has(id)) pileAnimsRef.current.delete(id);
    }
  }, [piles]);

  // Briefly blocks a SECOND press on the same pile while its feedback
  // animation/real update is still in flight — "prevent accidental double
  // activation from a single tap." Cleared on a short timeout for a
  // partial click (see handlePilePress); never needs clearing for a
  // final click, since that pile simply stops existing once the real
  // cleanup lands.
  const [pressedPileIds, setPressedPileIds] = useState<Set<string>>(new Set());
  // Which piles currently show their ephemeral "N left!" bubble, and what
  // number to show — only ever set for a pile whose click left it with
  // 1+ cleanup actions still remaining (Medium/Large).
  const [flashRemaining, setFlashRemaining] = useState<Record<string, number>>({});

  // Simple explanation: this runs when the player clicks/taps a poop
  // pile. It plays an animation AND tells the parent screen (Home) to
  // actually clean up that pile's data. If this click/tap uses up the
  // pile's last cleanup action, it waits for the sparkle animation to
  // finish before the pile is really removed, so it doesn't just vanish
  // instantly.
  function handlePilePress(pile: PoopPile) {
    if (!onCleanUpPile || pressedPileIds.has(pile.id)) return;
    setPressedPileIds((prev) => new Set(prev).add(pile.id));
    const anims = getPileAnims(pile.id);
    // Predicted locally rather than read back from props, since the real
    // update (applyCleanUpPile, via the parent's onCleanUpPile) hasn't
    // landed yet at the moment of this press — but its result is fully
    // deterministic from the pile's own current cleanupRemaining, so this
    // is always exactly right.
    const remainingAfterClick = pile.cleanupRemaining - 1;

    if (remainingAfterClick > 0) {
      // Still has more clicks to go — a quick wiggle/shrink pulse, plus a
      // brief "N left!" bubble, then commit the real decrement.
      Animated.sequence([
        Animated.timing(anims.scale, { toValue: 0.8, duration: 90, useNativeDriver: true }),
        Animated.spring(anims.scale, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]).start();

      setFlashRemaining((prev) => ({ ...prev, [pile.id]: remainingAfterClick }));
      anims.flashOpacity.setValue(0);
      Animated.sequence([
        Animated.timing(anims.flashOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.delay(500),
        Animated.timing(anims.flashOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => {
        setFlashRemaining((prev) => {
          if (!(pile.id in prev)) return prev;
          const next = { ...prev };
          delete next[pile.id];
          return next;
        });
      });

      onCleanUpPile(pile.id);
      setTimeout(() => {
        setPressedPileIds((prev) => {
          if (!prev.has(pile.id)) return prev;
          const next = new Set(prev);
          next.delete(pile.id);
          return next;
        });
      }, 350);
    } else {
      // The final click — play the sparkle + shrink/fade feedback FIRST,
      // then only commit the real removal once it's finished, so the
      // pile never just abruptly vanishes mid-animation.
      Animated.parallel([
        Animated.timing(anims.sparkleOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(anims.sparkleScale, { toValue: 1.3, duration: 340, useNativeDriver: true }),
        Animated.timing(anims.scale, { toValue: 0, duration: 320, useNativeDriver: true }),
        Animated.timing(anims.opacity, { toValue: 0, duration: 320, useNativeDriver: true }),
      ]).start(() => {
        onCleanUpPile(pile.id);
      });
    }
  }

  // Simple explanation: Kitty looks dirty if her Cleanliness is too low,
  // there's poop on the floor, or she still needs a bath. This should
  // match isPetDirty in @/utils/pet-needs.ts.
  // Mirrors isPetDirty (@/utils/pet-needs.ts) exactly, just against the
  // individual fields this component receives rather than a full
  // PetProfile. `cleanliness === undefined` (profile not loaded yet) is
  // treated as not-dirty, same as every other need bar above simply not
  // rendering until a real value arrives.
  const isDirty =
    (cleanliness !== undefined && cleanliness <= DIRTY_CLEANLINESS_THRESHOLD) || piles.length > 0 || needsBath === true;
  const { source, aspectRatio } = getStageImage(stage, isDirty);
  // Egg stays exactly where it's always been — see
  // KITTY_LIVING_ROOM_OFFSET_Y_PX's own comment above for why only the
  // pet's own Image/accessory shift, not the whole petWrap box.
  const kittyOffsetY = stage === 'Egg' ? 0 : KITTY_LIVING_ROOM_OFFSET_Y_PX;
  const accessoryArt = equippedAccessoryId ? PET_ACCESSORY_ART[equippedAccessoryId] : undefined;
  // Stage-aware — see @/utils/pet-accessory-placement.ts. 'home' is passed
  // explicitly (not a default) because this component is specifically the
  // Home-screen pet renderer — Stats renders its own, visually different
  // pet art through its own component, and will need its own 'stats'
  // placements looked up from there once that work starts; the two are
  // never meant to share these numbers.
  //
  // A per-item override (accessoryArt.placementOverrides — see
  // @/utils/pet-accessories.ts) always takes precedence when present.
  // Without one: only 'neckCollar' falls back to the shared slot
  // placement below — every bow is similar enough in shape that one
  // placement works well for all 26. Hats and bandanas vary far more in
  // shape (confirmed by the Rainbow Party Hat needing very different
  // numbers from the White Cat-Ear Beanie), so 'headHat'/'neckBandana'
  // items with no override of their own normally render nothing, rather
  // than guessing with another item's placement — they equip and persist
  // normally, they just stay invisible on the pet until tuned.
  //
  // The one exception: while DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP is true
  // (see @/utils/dev-flags.ts), an un-overridden 'headHat' item instead
  // gets a testing-only fallback placement, so it's actually visible to
  // tune rather than invisible. This is purely a render-time fallback —
  // it's never written to PET_ACCESSORY_ART, never becomes a real
  // placementOverride, and disappears (back to rendering nothing) the
  // moment that flag goes back to false.
  const accessoryPlacement = accessoryArt
    ? (accessoryArt.placementOverrides?.home?.[stage] ??
        (accessoryArt.slot === 'neckCollar'
          ? getAccessoryPlacement('home', accessoryArt.slot, stage)
          : DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP && accessoryArt.slot === 'headHat'
            ? DEV_UNTUNED_HEADHAT_FALLBACK_PLACEMENT
            : undefined))
    : undefined;
  // Rounded for display only — the real, unrounded value is what's stored
  // and what Feed's +20 math (see @/utils/pet-feeding.ts) operates on.
  const hungerPercent = hunger !== undefined ? Math.round(hunger) : null;
  const cleanlinessPercent = cleanliness !== undefined ? Math.round(cleanliness) : null;
  const happinessPercent = happiness !== undefined ? Math.round(happiness) : null;
  const energyPercent = energy !== undefined ? Math.round(energy) : null;

  return (
    <View style={styles.wrapper}>
      {message ? (
        <ThemedView type="backgroundElement" style={styles.bubble}>
          <ThemedText type="smallBold">{message}</ThemedText>
        </ThemedView>
      ) : null}

      <View style={[styles.petWrap, { aspectRatio }]}>
        <Image
          source={source}
          style={[styles.petImage, { transform: [{ translateY: kittyOffsetY }] }]}
          contentFit="contain"
        />

        {/* The equipped accessory, layered on top of the pet art itself
            (not a separate Shop-card-style image) — positioned/scaled as
            a percentage of the pet's own box so it tracks the pet's
            responsive size at any stage, using the exact same crop data
            (@/utils/pet-accessories.ts) the Shop card for this item reads.
            Purely decorative, so it never intercepts touches. Shifted by
            the same kittyOffsetY as the pet Image above, so an equipped
            accessory keeps tracking Kitty's own (now nudged-up) body
            instead of staying behind at the old position. */}
        {accessoryArt && accessoryPlacement ? (
          <View style={[styles.accessoryOverlay, { transform: [{ translateY: kittyOffsetY }] }]} pointerEvents="none">
            <View
              style={[
                styles.accessoryFrame,
                {
                  width: accessoryPlacement.width,
                  marginTop: accessoryPlacement.marginTop,
                  marginLeft: accessoryPlacement.marginLeft,
                  aspectRatio: accessoryArt.cropWidth / accessoryArt.cropHeight,
                  // scaleX (if any) listed before rotate so the horizontal
                  // stretch happens in the accessory's own original axes,
                  // then rotate tilts the already-stretched shape — see
                  // AccessoryPlacement.scaleX in pet-accessory-placement.ts.
                  transform: [
                    ...(accessoryPlacement.scaleX !== undefined ? [{ scaleX: accessoryPlacement.scaleX }] : []),
                    ...(accessoryPlacement.rotate ? [{ rotate: accessoryPlacement.rotate }] : []),
                  ],
                },
              ]}>
              <Image
                source={accessoryArt.source}
                contentFit="fill"
                style={{
                  position: 'absolute',
                  width: `${(accessoryArt.sheetWidth / accessoryArt.cropWidth) * 100}%`,
                  height: `${(accessoryArt.sheetHeight / accessoryArt.cropHeight) * 100}%`,
                  left: `${-(accessoryArt.cropX / accessoryArt.cropWidth) * 100}%`,
                  top: `${-(accessoryArt.cropY / accessoryArt.cropHeight) * 100}%`,
                }}
              />
            </View>
          </View>
        ) : null}

        {/* Simple explanation: this draws one picture + tappable area for
            EACH poop pile in the list. Tapping/clicking it calls
            handlePilePress above.
            Poop floor artwork (getPoopArt above) — one per accumulated
            pile, sized/positioned at the bottom of the same box the pet
            art itself sits in, so it reads as "on the floor near Kitty"
            without overlapping her own image (a separate layered View per
            pile, same technique as the accessory overlay above — easy to
            reposition independently later).
            Each pile's position is RANDOM but STABLE: offsetXPx/offsetYPx
            were resolved ONCE, at creation time, by a collision-aware
            placement search against the pile's siblings' own real
            footprints (see placePoopPile in @/utils/pet-poop.ts — it
            picks a random side of Kitty each time, so piles end up on
            both sides rather than one fixed direction per stage) and are
            persisted on the pile itself (@/utils/pet-profile.ts), so a
            pile's position never changes just from rerendering or
            reopening the app — only a brand-new pile gets a fresh random,
            collision-checked spot.
            The artwork ITSELF is the cleanup control — pressing it (click
            on web, tap on Android/iOS) is what calls handlePilePress
            above, instead of a separate visible button. hitSlop pads the
            tappable area a little beyond the small art itself without
            reaching all the way to a neighboring pile at the minimum
            required gap (POOP_PILE_MIN_GAP_PX in @/utils/pet-poop.ts).
            accessibilityRole="button" + accessibilityLabel give screen
            readers a real label (the art has no visible text of its own),
            and — same as every other Pressable "button" already in this
            app (Feed/Bath/Play/Rest, the three-dot task menu, etc.) —
            react-native-web makes this focusable and Enter/Space-
            activatable on its own, no extra keyboard handling needed.
            disabled (tied to pressedPileIds) blocks a second press while
            this pile's own feedback animation/real update is still in
            flight. The outer Pressable only owns position/hit-testing/
            accessibility; the inner Animated.View owns the actual
            scale/opacity feedback, so they compose independently. */}
        {piles.map((pile) => {
          const art = getPoopArt(pile.size);
          const anims = getPileAnims(pile.id);
          return (
            <Pressable
              key={pile.id}
              onPress={() => handlePilePress(pile)}
              disabled={pressedPileIds.has(pile.id)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Clean up ${capitalizePoopSize(pile.size)} poop pile${
                pile.cleanupRemaining > 1 ? `, ${pile.cleanupRemaining} clicks needed` : ''
              }`}
              style={({ pressed }) => [
                styles.poopFloorIndicator,
                {
                  width: art.displayWidthPercent,
                  aspectRatio: art.aspectRatio,
                  transform: [{ translateX: pile.offsetXPx }, { translateY: pile.offsetYPx }],
                },
                pressed && styles.poopPilePressed,
              ]}>
              <Animated.View
                style={[styles.poopFloorImageWrap, { transform: [{ scale: anims.scale }], opacity: anims.opacity }]}>
                <Image source={art.source} style={styles.poopFloorImage} contentFit="contain" />
              </Animated.View>

              {/* Ephemeral "N left!" bubble — only while this pile has a
                  flashRemaining entry (set in handlePilePress, only ever
                  for a non-final Medium/Large click), fading in then out
                  on its own without needing a timer here. */}
              {flashRemaining[pile.id] !== undefined ? (
                <Animated.View
                  style={[styles.poopFlashBubble, { opacity: anims.flashOpacity }]}
                  pointerEvents="none">
                  <ThemedText type="smallBold" style={styles.poopFlashText}>
                    {flashRemaining[pile.id]} left!
                  </ThemedText>
                </Animated.View>
              ) : null}

              {/* Small sparkle, only animated (fades/scales in) on the
                  FINAL click, alongside the art's own shrink/fade above —
                  see the `else` branch of handlePilePress. Sits at
                  sparkleOpacity: 0 the rest of the time, so it's invisible
                  but cheap to always render rather than conditionally
                  mounting it. */}
              <Animated.Text
                style={[
                  styles.poopSparkle,
                  { opacity: anims.sparkleOpacity, transform: [{ scale: anims.sparkleScale }] },
                ]}
                pointerEvents="none">
                ✨
              </Animated.Text>
            </Pressable>
          );
        })}
      </View>

      {/* Simple explanation: shows Hunger, Cleanliness, Happiness, and
          Energy as 4 bars in a row. On a narrow phone screen, they wrap
          into a 2x2 grid instead of squeezing into one line.
          The 4 need bars side by side in one wrapping row instead of
          stacked — each is still its own independently-gated block (only
          renders once that particular value has loaded, same as before),
          just laid out horizontally now. flexWrap on needsRow is what
          gives "4 across on a wide Living Room, 2x2 on a narrow phone
          screen" for free: each bar has a flexBasis/minWidth
          (styles.needBarHorizontal) rather than a fixed width, so the row
          naturally wraps to 2 columns once 4 of them wouldn't fit at
          their minimum width — no separate breakpoint logic needed. This
          also meaningfully shortens the panel vertically versus 4 stacked
          rows, leaving more of the floor below visibly free for poop
          piles (see POOP_ZONE_Y_MAX_PX in @/utils/pet-poop.ts).
          Calculation/storage of each need is completely unchanged — this
          is a display-only layout change. */}
      <View style={styles.needsRow}>
        {/* Hunger status bar — reads the real petProfile.hunger value
            passed down from Home, no separate/fake value. Re-renders
            immediately whenever Home's petProfile state updates (e.g.
            right after Feed). */}
        {hungerPercent !== null ? (
          <View style={styles.needBarHorizontal}>
            <View style={styles.needLabelRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Hunger
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {hungerPercent}%
              </ThemedText>
            </View>
            <View style={[styles.needTrack, { backgroundColor: theme.backgroundElement }]}>
              <View style={{ flex: hungerPercent, backgroundColor: theme.accent }} />
              <View style={{ flex: 100 - hungerPercent }} />
            </View>
          </View>
        ) : null}

        {/* Cleanliness status bar — same shape as Hunger, reads the real
            petProfile.cleanliness value. Uses sky (the same pastel blue
            as the Bath button) to stay visually distinct from Hunger's
            pink. */}
        {cleanlinessPercent !== null ? (
          <View style={styles.needBarHorizontal}>
            <View style={styles.needLabelRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Cleanliness
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {cleanlinessPercent}%
              </ThemedText>
            </View>
            <View style={[styles.needTrack, { backgroundColor: theme.backgroundElement }]}>
              <View style={{ flex: cleanlinessPercent, backgroundColor: theme.sky }} />
              <View style={{ flex: 100 - cleanlinessPercent }} />
            </View>
          </View>
        ) : null}

        {/* Happiness status bar — same shape as the others, reads the
            real petProfile.happiness value. Uses mint (the same pastel
            green as the Play button) to stay visually distinct from
            Hunger's pink and Cleanliness's blue. */}
        {happinessPercent !== null ? (
          <View style={styles.needBarHorizontal}>
            <View style={styles.needLabelRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Happiness
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {happinessPercent}%
              </ThemedText>
            </View>
            <View style={[styles.needTrack, { backgroundColor: theme.backgroundElement }]}>
              <View style={{ flex: happinessPercent, backgroundColor: theme.mint }} />
              <View style={{ flex: 100 - happinessPercent }} />
            </View>
          </View>
        ) : null}

        {/* Energy status bar — same shape as the others, reads the real
            petProfile.energy value. Uses purple (a soft lavender already
            used elsewhere in the app, e.g. the active nav pill) rather
            than backgroundSelected — that was too close in lightness to
            the track color below to read clearly against it, unlike
            accent/sky/mint's stronger contrast on the other three bars. */}
        {energyPercent !== null ? (
          <View style={styles.needBarHorizontal}>
            <View style={styles.needLabelRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Energy
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {energyPercent}%
              </ThemedText>
            </View>
            <View style={[styles.needTrack, { backgroundColor: theme.backgroundElement }]}>
              <View style={{ flex: energyPercent, backgroundColor: theme.purple }} />
              <View style={{ flex: 100 - energyPercent }} />
            </View>
          </View>
        ) : null}
      </View>

      {/* Basic Feed/Bath/Play/Rest interactions — call the persistent
          feedPet()/bathePet()/playWithPet()/restPet() actions (see
          @/utils/pet-feeding.ts, @/utils/pet-bathing.ts,
          @/utils/pet-playing.ts, and @/utils/pet-resting.ts) via the
          callbacks passed down from Home; this component doesn't know or
          duplicate any of those calculations. disabled (while
          isFeeding/isBathing/isPlaying/isResting) both greys each button
          out and makes React Native itself ignore extra taps, so an
          action already in flight can't be triggered again.
          Temporary/basic — just enough to manually test the persistent
          actions. Rest is a manual Energy top-up only — it never touches
          isSleeping, which stays entirely owned by the automatic 8 PM-8 AM
          bedtime system (see restPet itself, and resolvePetNeedsAcrossBedtime
          in pet-needs.ts). */}
      {onFeed || onBathe || onPlay || onRest ? (
        <View style={styles.actionsRow}>
          {onFeed ? (
            <Pressable
              onPress={onFeed}
              disabled={isFeeding}
              style={({ pressed }) => [pressed && styles.pressed, isFeeding && styles.actionButtonDisabled]}>
              <ThemedView type="accent" style={styles.actionButton}>
                <ThemedText type="smallBold" style={styles.feedButtonText}>
                  {isFeeding ? 'Feeding…' : 'Feed'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ) : null}
          {onBathe ? (
            <Pressable
              onPress={onBathe}
              disabled={isBathing}
              style={({ pressed }) => [pressed && styles.pressed, isBathing && styles.actionButtonDisabled]}>
              <ThemedView type="sky" style={styles.actionButton}>
                <ThemedText type="smallBold">{isBathing ? 'Bathing…' : 'Bath'}</ThemedText>
              </ThemedView>
            </Pressable>
          ) : null}
          {onPlay ? (
            <Pressable
              onPress={onPlay}
              disabled={isPlaying}
              style={({ pressed }) => [pressed && styles.pressed, isPlaying && styles.actionButtonDisabled]}>
              <ThemedView type="mint" style={styles.actionButton}>
                <ThemedText type="smallBold">{isPlaying ? 'Playing…' : 'Play'}</ThemedText>
              </ThemedView>
            </Pressable>
          ) : null}
          {onRest ? (
            <Pressable
              onPress={onRest}
              disabled={isResting}
              style={({ pressed }) => [pressed && styles.pressed, isResting && styles.actionButtonDisabled]}>
              <ThemedView type="backgroundSelected" style={styles.actionButton}>
                <ThemedText type="smallBold">{isResting ? 'Resting…' : 'Rest'}</ThemedText>
              </ThemedView>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    alignItems: 'center',
  },
  bubble: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
    marginBottom: Spacing.one,
  },
  petWrap: {
    width: '46%',
    minWidth: 150,
    maxWidth: 260,
  },
  petImage: {
    width: '100%',
    height: '100%',
  },
  // Fills the same petWrap box the pet image itself sits in, so a
  // percentage-sized accessory frame inside it scales correctly off the
  // pet's own responsive size — no fixed pixel size needed (unlike
  // SpriteCrop, which the Shop's cards use, this is positioned/sized
  // entirely in percentages since this box's own pixel size varies).
  accessoryOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
  },
  // width/marginTop (and marginLeft, when a stage needs one) come from
  // getAccessoryPlacement (@/utils/pet-accessory-placement.ts) per the
  // pet's current stage and the accessory's own slot (e.g. bows are worn
  // at the neck/collar) — this base style only owns the clipping.
  accessoryFrame: {
    overflow: 'hidden',
  },
  // Bottom-left of the same petWrap box, "on the floor" near Kitty's feet
  // rather than overlapping her face/body — each pile gets its own
  // separate layered box (not part of the pet Image itself), so they can
  // be repositioned independently later without touching Kitty's own
  // art. width/aspectRatio are set inline per pile (getPoopArt's
  // displayWidthPercent/aspectRatio, from that pile's own size); height
  // follows automatically from aspectRatio, same technique the
  // accessoryFrame style above uses. left: '6%'/bottom: '4%' is the
  // shared base anchor every pile starts from; each pile's actual
  // on-screen position also includes its own fully-resolved
  // translateX/translateY (pile.offsetXPx/offsetYPx, computed once by the
  // collision-aware placement logic in @/utils/pet-poop.ts — see
  // placePoopPile there to retune the floor zones/spacing).
  poopFloorIndicator: {
    position: 'absolute',
    left: '6%',
    bottom: '4%',
  },
  // A light, immediate press affordance on top of the art's own
  // wiggle/shrink animation (handlePilePress) — same `pressed &&` dim
  // convention every other Pressable "button" in this app already uses.
  poopPilePressed: {
    opacity: 0.85,
  },
  // Fills the Pressable above; this is the layer handlePilePress actually
  // animates (scale/opacity) — kept separate from the outer Pressable so
  // the position transform (translateX/Y, on the Pressable) and the
  // feedback transform (scale, on this View) never fight over the same
  // style's `transform` array.
  poopFloorImageWrap: {
    width: '100%',
    height: '100%',
  },
  poopFloorImage: {
    width: '100%',
    height: '100%',
  },
  // The "N left!" bubble — centered directly above the pile it belongs
  // to (bottom: '100%' sits it just above the pile's own box), so with
  // several piles on screen it's unambiguous which one it's reporting on.
  // pointerEvents: 'none' at its usage site keeps it from ever stealing
  // the tap meant for the pile underneath.
  poopFlashBubble: {
    position: 'absolute',
    bottom: '100%',
    alignSelf: 'center',
    marginBottom: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Spacing.five,
    backgroundColor: '#FFFFFF',
  },
  poopFlashText: {
    fontSize: 11,
  },
  // Centered over the pile's own art, scaling/fading in only during the
  // final-click animation (handlePilePress's `else` branch) — invisible
  // (sparkleOpacity starts at 0) the rest of the time.
  poopSparkle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -10,
    marginTop: -10,
    fontSize: 20,
  },
  // The shared row all 4 bars live in — flexWrap is what makes this
  // responsive: on a wide Living Room there's enough width for all 4
  // needBarHorizontal items at once, and on a narrow phone screen the
  // same items wrap onto a second line (2x2) once 4 wouldn't fit at
  // their minWidth, with no separate breakpoint check needed. Wider
  // (maxWidth 480 vs the old single bar's 240) and shorter overall than
  // the previous 4-stacked-rows layout, which is what frees up more
  // vertical floor space above the actions row below.
  needsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: '92%',
    maxWidth: 480,
    marginTop: Spacing.two,
    gap: Spacing.three,
  },
  // flexGrow+flexBasis+minWidth (rather than a fixed width) is what lets
  // 4 of these share a row's width evenly when there's room, while still
  // giving flexWrap on needsRow above a concrete minimum size to decide
  // "wrap to a new line" against.
  needBarHorizontal: {
    flexGrow: 1,
    flexBasis: 100,
    minWidth: 100,
    gap: Spacing.half,
  },
  needLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  needTrack: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  actionButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  feedButtonText: {
    color: '#FFFFFF',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.7,
  },
});
