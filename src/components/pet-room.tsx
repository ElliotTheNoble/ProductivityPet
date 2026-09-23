import { StyleSheet, View } from 'react-native';

import { PetPlaceholder } from '@/components/pet-placeholder';
import { Spacing } from '@/constants/theme';
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
};

// The living-room background now lives once, fixed behind the whole Home
// screen (see src/app/index.tsx), instead of inside its own framed box
// here — this just places the pet (+ speech bubble) with some breathing
// room so it reads as standing in that room rather than floating in a card.
export function PetRoom({ stage, message, spacious = false }: PetRoomProps) {
  return (
    <View style={[styles.scene, spacious && styles.sceneSpacious]}>
      <PetPlaceholder stage={stage} message={message} />
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
