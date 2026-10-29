import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { YOUNG_SCALE, getStageImage } from '@/components/pet-placeholder';
import { DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP, DEV_UNTUNED_HEADHAT_FALLBACK_PLACEMENT } from '@/utils/dev-flags';
import { PET_ACCESSORY_ART } from '@/utils/pet-accessories';
import { getAccessoryPlacement, getPlacementStageForArtwork } from '@/utils/pet-accessory-placement';
import { getHealthAccessoryTransform, getHealthArt } from '@/utils/pet-health-art';
import { MEMORIAL_TOMBSTONE_SOURCE } from '@/utils/resurrection-art';
import type { PetStage } from '@/utils/pet-stage';

type PetAvatarProps = {
  stage: PetStage;
  // The ids to draw on the pet — up to one hat and one bow (see
  // @/utils/pet-equipment.ts), in any order; null/undefined entries and an
  // omitted/empty list all mean "nothing shown there". Callers that need
  // the Egg-stage no-accessories rule (see BUG-006 in bugs.md) get it for
  // free by simply not passing any ids while stage === 'Egg', the same
  // convention Home itself already follows (see isDisplayedEgg in
  // src/app/index.tsx).
  equippedAccessoryIds?: readonly (string | null | undefined)[];
  // Square size, in pixels, of the rendered avatar.
  size: number;
  // The pet's real health state: Sick / Critical show their own picture (see
  // @/utils/pet-health-art.ts); anything else shows the normal one.
  healthState?: 'healthy' | 'sick' | 'critical' | 'deceased';
};

// A small, display-only portrait of the player's real pet — reusing the
// exact same body-art lookup (getStageImage) and equipped-accessory data
// (PET_ACCESSORY_ART, getAccessoryPlacement) that Home's own pet renderer
// (@/components/pet-placeholder.tsx) reads from, so it always matches
// whatever stage/accessory is actually saved, never a separate copy of
// either. Deliberately its own small component rather than a prop/mode
// added to PetPlaceholder: Home's own rendering (needs bars, buttons,
// message bubble, dirty/bathing art, hatch-intro animation) is unrelated
// to a tiny portrait and is left completely untouched by this file.
//
// BUG-021 (see bugs.md): this used to skip Home's own per-stage body
// enlargement (YOUNG_SCALE) entirely, on the theory that a fixed, always-
// 1x size was simplest. That was wrong — every Young-stage accessory
// placement (pet-accessory-placement.ts / pet-accessories.ts) was tuned
// BY EYE against Home's body image already rendered at YOUNG_SCALE
// (1.21x), and the accessory's own frame is positioned purely as a
// percentage of this component's box, which never itself gets scaled
// (same as Home's own accessoryOverlay, which only ever carries
// translateY, never scale — see pet-placeholder.tsx). So the exact same
// placement percentages only land in the right spot relative to a body
// that's ALSO rendered at that same scale — rendering the body at a flat
// 1x (as this used to) left every Young-stage accessory positioned for a
// body bigger than the one actually on screen, which is what pushed hats
// like the White Cat-Ear Beanie up and off the top of her head. Now
// mirrors Home exactly: youngScale applied to the body Image's own
// transform (not the accessory frame), and the outer box no longer clips
// (overflow: 'hidden' removed) — same as Home's own petWrap, which
// deliberately never clips either, specifically so a stage's scaled-up
// body (and any accessory near its edge) is never cut off. In practice
// this means a Young-stage avatar can render very slightly larger than
// `size` x `size`, exactly mirroring how Young Kitty is deliberately
// allowed to overflow her own box on Home.
export function PetAvatar({ stage, equippedAccessoryIds, size, healthState }: PetAvatarProps) {
  // A pet that has passed away is always the memorial tombstone (never a living kitty), wearing nothing.
  if (healthState === 'deceased') {
    return (
      <View pointerEvents="none" style={{ width: size, height: size }}>
        <Image source={MEMORIAL_TOMBSTONE_SOURCE} contentFit="contain" style={StyleSheet.absoluteFill} />
      </View>
    );
  }
  const { source } = getStageImage(stage);
  // Identical to Home's own youngScale (src/components/pet-placeholder.tsx)
  // — imported from there, not a second hardcoded `1.21`, so retuning it
  // in one place always keeps both screens in sync.
  const youngScale = stage === 'Young' ? YOUNG_SCALE : 1;
  // Placements follow the kitty ARTWORK, not the stage name — Hatchling and
  // Baby artwork are swapped, so their placement entries are too (see
  // getPlacementStageForArtwork).
  const placementStage = getPlacementStageForArtwork(stage);
  const healthArt = getHealthArt(stage, healthState);
  const healthAccessoryStyle = healthArt
    ? { transform: getHealthAccessoryTransform(healthArt, youngScale, size, size) }
    : null;

  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      {healthArt ? (
        <View style={[StyleSheet.absoluteFill, { transform: [{ scale: youngScale }] }]}>
          <Image
            source={healthArt.source}
            contentFit="contain"
            style={{
              position: 'absolute',
              left: `${healthArt.box.left * 100}%`,
              top: `${healthArt.box.top * 100}%`,
              width: `${healthArt.box.width * 100}%`,
              height: `${healthArt.box.height * 100}%`,
            }}
          />
        </View>
      ) : (
        <Image
          source={source}
          contentFit="contain"
          style={[StyleSheet.absoluteFill, { transform: [{ scale: youngScale }] }]}
        />
      )}
      {/* One overlay per equipped accessory (a hat and a bow can both be
          worn — see @/utils/pet-equipment.ts), each positioned from its own
          unchanged placement data; later ids draw on top of earlier ones. */}
      {(equippedAccessoryIds ?? []).map((accessoryId) => {
        const accessoryArt = accessoryId ? PET_ACCESSORY_ART[accessoryId] : undefined;
        const accessoryPlacement = accessoryArt
          ? (accessoryArt.placementOverrides?.home?.[placementStage] ??
              (accessoryArt.slot === 'neckCollar'
                ? getAccessoryPlacement('home', accessoryArt.slot, placementStage)
                : DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP && accessoryArt.slot === 'headHat'
                  ? DEV_UNTUNED_HEADHAT_FALLBACK_PLACEMENT
                  : undefined))
          : undefined;
        if (!accessoryId || !accessoryArt || !accessoryPlacement) return null;
        return (
          <View key={accessoryId} style={[styles.accessoryOverlay, healthAccessoryStyle]} pointerEvents="none">
            <View
              style={[
                styles.accessoryFrame,
                {
                  width: accessoryPlacement.width,
                  marginTop: accessoryPlacement.marginTop,
                  marginLeft: accessoryPlacement.marginLeft,
                  aspectRatio: accessoryArt.cropWidth / accessoryArt.cropHeight,
                  transform: [
                    ...(accessoryPlacement.scaleX !== undefined ? [{ scaleX: accessoryPlacement.scaleX }] : []),
                    ...(accessoryPlacement.scaleY !== undefined ? [{ scaleY: accessoryPlacement.scaleY }] : []),
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
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  accessoryOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
  },
  accessoryFrame: {
    overflow: 'hidden',
  },
});
