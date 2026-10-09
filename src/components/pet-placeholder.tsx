import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP, DEV_UNTUNED_HEADHAT_FALLBACK_PLACEMENT } from '@/utils/dev-flags';
import { PET_ACCESSORY_ART } from '@/utils/pet-accessories';
import { getAccessoryPlacement } from '@/utils/pet-accessory-placement';
import type { PetStage } from '@/utils/pet-stage';

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
function getStageImage(stage: PetStage) {
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

export function PetPlaceholder({
  stage,
  message,
  equippedAccessoryId,
  hunger,
  cleanliness,
  happiness,
  energy,
  onFeed,
  isFeeding = false,
  onBathe,
  isBathing = false,
  onPlay,
  isPlaying = false,
  onRest,
  isResting = false,
}: PetPlaceholderProps) {
  const theme = useTheme();
  const { source, aspectRatio } = getStageImage(stage);
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
        <Image source={source} style={styles.petImage} contentFit="contain" />

        {/* The equipped accessory, layered on top of the pet art itself
            (not a separate Shop-card-style image) — positioned/scaled as
            a percentage of the pet's own box so it tracks the pet's
            responsive size at any stage, using the exact same crop data
            (@/utils/pet-accessories.ts) the Shop card for this item reads.
            Purely decorative, so it never intercepts touches. */}
        {accessoryArt && accessoryPlacement ? (
          <View style={styles.accessoryOverlay} pointerEvents="none">
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
      </View>

      {/* Hunger status bar — reads the real petProfile.hunger value passed
          down from Home, no separate/fake value. Only renders once a real
          number has loaded, and re-renders immediately whenever Home's
          petProfile state updates (e.g. right after Feed). */}
      {hungerPercent !== null ? (
        <View style={styles.needBar}>
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

      {/* Cleanliness status bar — same shape as the Hunger bar above, reads
          the real petProfile.cleanliness value, no separate/fake value.
          Uses sky (the same pastel blue as the Bath button) to stay
          visually distinct from Hunger's pink. */}
      {cleanlinessPercent !== null ? (
        <View style={styles.needBar}>
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

      {/* Happiness status bar — same shape as the bars above, reads the
          real petProfile.happiness value, no separate/fake value. Uses
          mint (the same pastel green as the Play button) to stay visually
          distinct from Hunger's pink and Cleanliness's blue. */}
      {happinessPercent !== null ? (
        <View style={styles.needBar}>
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

      {/* Energy status bar — same shape as the bars above, reads the real
          petProfile.energy value, no separate/fake value. Uses purple (a
          soft lavender already used elsewhere in the app, e.g. the active
          nav pill) rather than backgroundSelected — that was too close in
          lightness to the track color below to read clearly against it,
          unlike accent/sky/mint's stronger contrast on the other three
          bars. */}
      {energyPercent !== null ? (
        <View style={styles.needBar}>
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
  needBar: {
    width: '70%',
    minWidth: 150,
    maxWidth: 240,
    marginTop: Spacing.two,
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
