import { StyleSheet, View } from 'react-native';

import { PetPlaceholder } from '@/components/pet-placeholder';
import { Spacing } from '@/constants/theme';
import type { PoopPile } from '@/utils/pet-profile';
import type { PetStage } from '@/utils/pet-stage';

type PetRoomProps = {
  stage: PetStage;
  message?: string | null;
  // True on the wide/desktop two-column layout, where the pet gets a whole
  // dedicated column instead of sharing space with other cards — gives it
  // a tall, open area and anchors it near the bottom (the rug) rather than
  // vertically centering it in a cramped space. Narrow/mobile layouts stay
  // compact, same as before.
  spacious?: boolean;
  // The id of the currently-equipped Pet Accessory, passed straight
  // through to PetPlaceholder — see that component and
  // @/utils/pet-equipment.ts.
  equippedAccessoryId?: string | null;
  // The real Hunger value, passed straight through to PetPlaceholder —
  // see that component. Optional so the room-detail screens keep working
  // unchanged without it.
  hunger?: number;
  // Same as hunger, for Cleanliness.
  cleanliness?: number;
  // Same as hunger, for Happiness.
  happiness?: number;
  // Same as hunger, for Energy.
  energy?: number;
  // The real petProfile.poopPiles value, passed straight through to
  // PetPlaceholder — see that component, @/utils/pet-needs.ts's
  // isPetDirty, and @/utils/pet-poop.ts's accumulation system.
  poopPiles?: PoopPile[];
  // Same as poopPiles, for needsBath — see PetPlaceholder and
  // @/utils/pet-needs.ts's isPetDirty.
  needsBath?: boolean;
  // Passed straight through to PetPlaceholder, which renders the
  // Feed/Bath/Play/Rest buttons only when their own handler is provided —
  // see that component. Optional so the room-detail screens (which also
  // render PetRoom, but shouldn't get these buttons) keep working
  // unchanged.
  onFeed?: () => void;
  isFeeding?: boolean;
  onBathe?: () => void;
  isBathing?: boolean;
  onPlay?: () => void;
  isPlaying?: boolean;
  onRest?: () => void;
  isResting?: boolean;
  // Passed straight through to PetPlaceholder's per-pile "Clean Up!"
  // buttons — see that component and @/utils/pet-poop.ts.
  onCleanUpPile?: (pileId: string) => void;
  // Passed straight through to PetPlaceholder — see that component and
  // @/utils/pet-profile.ts's hatchedAt field.
  hatchedAt?: string;
  isStagePreviewActive?: boolean;
};

// The living-room background now lives once, fixed behind the whole Home
// screen (see src/app/index.tsx), instead of inside its own framed box
// here — this just places the pet (+ speech bubble) with some breathing
// room so it reads as standing in that room rather than floating in a card.
export function PetRoom({
  stage,
  message,
  spacious = false,
  equippedAccessoryId,
  hunger,
  cleanliness,
  happiness,
  energy,
  poopPiles,
  needsBath,
  onFeed,
  isFeeding,
  onBathe,
  isBathing,
  onPlay,
  isPlaying,
  onRest,
  isResting,
  onCleanUpPile,
  hatchedAt,
  isStagePreviewActive,
}: PetRoomProps) {
  return (
    <View style={[styles.scene, spacious && styles.sceneSpacious]}>
      <PetPlaceholder
        stage={stage}
        message={message}
        equippedAccessoryId={equippedAccessoryId}
        hunger={hunger}
        cleanliness={cleanliness}
        happiness={happiness}
        energy={energy}
        poopPiles={poopPiles}
        needsBath={needsBath}
        onFeed={onFeed}
        isFeeding={isFeeding}
        onBathe={onBathe}
        isBathing={isBathing}
        onPlay={onPlay}
        isPlaying={isPlaying}
        onRest={onRest}
        isResting={isResting}
        onCleanUpPile={onCleanUpPile}
        hatchedAt={hatchedAt}
        isStagePreviewActive={isStagePreviewActive}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: Spacing.four,
  },
  sceneSpacious: {
    minHeight: 440,
    paddingBottom: Spacing.five,
  },
});
