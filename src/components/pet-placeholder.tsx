import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { PetStage } from '@/utils/pet-stage';

type PetPlaceholderProps = {
  stage: PetStage;
  message?: string | null;
};

// Egg and Hatchling each have their own dedicated full illustration.
// Baby/Young/Adult are pre-cropped from the shared growth sprite sheet
// (assets/images/pets/pet_growth_stages.png) into their own files, so every
// stage is simply "one image, sized to its own real aspect ratio" — no
// runtime sprite-cropping needed here (that technique needs a known pixel
// size, which this responsively-sized component doesn't have).
function getStageImage(stage: PetStage) {
  switch (stage) {
    case 'Egg':
      return { source: require('@/assets/images/pets/egg_nest.png'), aspectRatio: 1536 / 1024 };
    case 'Hatchling':
      return { source: require('@/assets/images/pets/kitten_nest.png'), aspectRatio: 1381 / 1139 };
    case 'Baby':
      return { source: require('@/assets/images/pets/pet_baby.png'), aspectRatio: 1 };
    case 'Young':
      return { source: require('@/assets/images/pets/pet_young.png'), aspectRatio: 1 };
    case 'Adult':
      return { source: require('@/assets/images/pets/pet_adult.png'), aspectRatio: 1 };
  }
}

export function PetPlaceholder({ stage, message }: PetPlaceholderProps) {
  const { source, aspectRatio } = getStageImage(stage);

  return (
    <View style={styles.wrapper}>
      {message ? (
        <ThemedView type="backgroundElement" style={styles.bubble}>
          <ThemedText type="smallBold">{message}</ThemedText>
        </ThemedView>
      ) : null}

      <View style={[styles.petWrap, { aspectRatio }]}>
        <Image source={source} style={styles.petImage} contentFit="contain" />
      </View>
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
});
