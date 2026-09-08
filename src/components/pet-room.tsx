import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { PetPlaceholder } from '@/components/pet-placeholder';
import { Spacing } from '@/constants/theme';
import type { PetStage } from '@/utils/pet-stage';

type PetRoomProps = {
  stage: PetStage;
  message?: string | null;
};

// Matches the pixel dimensions of assets/images/rooms/living-room.png (1536x1024)
// so the image is never stretched or cropped.
const ROOM_ASPECT_RATIO = 1536 / 1024;

export function PetRoom({ stage, message }: PetRoomProps) {
  return (
    <View style={styles.scene}>
      <Image
        source={require('@/assets/images/rooms/living-room.png')}
        style={styles.image}
        contentFit="contain"
      />
      <View style={styles.petOverlay} pointerEvents="box-none">
        <View style={styles.topSpacer} />
        <PetPlaceholder stage={stage} message={message} />
        <View style={styles.bottomSpacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    width: '100%',
    aspectRatio: ROOM_ASPECT_RATIO,
    borderRadius: Spacing.four,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  petOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
  },
  topSpacer: {
    flexGrow: 7,
  },
  bottomSpacer: {
    flexGrow: 3,
  },
});
