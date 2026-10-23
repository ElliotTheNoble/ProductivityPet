import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { getStageImage } from '@/components/pet-placeholder';
import { DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP, DEV_UNTUNED_HEADHAT_FALLBACK_PLACEMENT } from '@/utils/dev-flags';
import { PET_ACCESSORY_ART } from '@/utils/pet-accessories';
import { getAccessoryPlacement } from '@/utils/pet-accessory-placement';
import type { PetStage } from '@/utils/pet-stage';

type PetAvatarProps = {
  stage: PetStage;
  // null/undefined both mean "no accessory shown" — callers that need the
  // Egg-stage no-accessories rule (see BUG-006 in bugs.md) get it for free
  // by simply not passing an id while stage === 'Egg', the same convention
  // Home itself already follows (see isDisplayedEgg in src/app/index.tsx).
  equippedAccessoryId?: string | null;
  // Square size, in pixels, of the rendered avatar.
  size: number;
};

// A small, display-only portrait of the player's real pet — reusing the
// exact same body-art lookup (getStageImage) and equipped-accessory data
// (PET_ACCESSORY_ART, getAccessoryPlacement) that Home's own pet renderer
// (@/components/pet-placeholder.tsx) reads from, so it always matches
// whatever stage/accessory is actually saved, never a separate copy of
// either. Deliberately its own small component rather than a prop/mode
// added to PetPlaceholder: Home's own rendering (needs bars, buttons,
// message bubble, dirty/bathing art, hatch-intro animation, per-stage
// enlargement) is unrelated to a tiny mascot portrait and is left
// completely untouched by this file.
//
// Unlike Home, this always renders at a fixed `size`, clipped
// (overflow: 'hidden') and scaled via contentFit="contain" — intentionally
// skipping Home's own per-stage enlargement (e.g. YOUNG_SCALE) so the
// avatar can never overflow whatever small circular/square slot it's
// placed in, regardless of stage.
export function PetAvatar({ stage, equippedAccessoryId, size }: PetAvatarProps) {
  const { source } = getStageImage(stage);
  const accessoryArt = equippedAccessoryId ? PET_ACCESSORY_ART[equippedAccessoryId] : undefined;
  const accessoryPlacement = accessoryArt
    ? (accessoryArt.placementOverrides?.home?.[stage] ??
        (accessoryArt.slot === 'neckCollar'
          ? getAccessoryPlacement('home', accessoryArt.slot, stage)
          : DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP && accessoryArt.slot === 'headHat'
            ? DEV_UNTUNED_HEADHAT_FALLBACK_PLACEMENT
            : undefined))
    : undefined;

  return (
    <View pointerEvents="none" style={{ width: size, height: size, overflow: 'hidden' }}>
      <Image source={source} contentFit="contain" style={StyleSheet.absoluteFill} />
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
      ) : null}
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
