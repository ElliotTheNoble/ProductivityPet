import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { PetStage } from '@/utils/pet-stage';

type PetStageIconProps = {
  stage: PetStage;
  size?: number;
};

// assets/images/pets/pet_stages.png is a single 1774x887 illustration with
// all 5 stages laid out left to right (it also has arrows and text labels
// baked in, which we don't use — Pet Progress renders its own labels/arrows
// around this icon). Each stage is revealed via a fixed source-pixel square
// crop, the same sprite-crop technique already used for task_icons.png.
const SOURCE_WIDTH = 1774;
const SOURCE_HEIGHT = 887;
const CROP_SIZE = 460;
const CROP_TOP = 140;
const STAGE_CENTER_X: Record<PetStage, number> = {
  Egg: 178,
  Hatchling: 516,
  Baby: 858,
  Young: 1200,
  Adult: 1569,
};

export function PetStageIcon({ stage, size = 44 }: PetStageIconProps) {
  const scale = size / CROP_SIZE;
  const cropLeft = STAGE_CENTER_X[stage] - CROP_SIZE / 2;

  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={require('@/assets/images/pets/pet_stages.png')}
        contentFit="fill"
        style={{
          position: 'absolute',
          width: SOURCE_WIDTH * scale,
          height: SOURCE_HEIGHT * scale,
          left: -cropLeft * scale,
          top: -CROP_TOP * scale,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
  },
});
