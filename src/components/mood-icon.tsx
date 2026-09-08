import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { Mood } from '@/utils/mood';

type MoodIconProps = {
  mood: Mood;
  size?: number;
};

// assets/images/moods/pet_moods.png is a single 1945x809 image containing 6
// rounded-card mood icons (each with its own baked-in pastel background)
// laid out left to right, plus text-label pills below them which we don't
// use — TodayMood renders its own labels. Same sprite-crop technique as
// TaskIcon/PetStageIcon, just with a taller (non-square) crop to match these
// cards' own rounded-rect shape.
const SOURCE_WIDTH = 1945;
const SOURCE_HEIGHT = 809;
const CROP_WIDTH = 320;
const CROP_HEIGHT = 380;
const CROP_TOP = 198;
const MOOD_CENTER_X: Record<Mood, number> = {
  Happy: 187,
  Calm: 505,
  Focused: 817,
  Stressed: 1129,
  Tired: 1440,
  Sick: 1753,
};

export function MoodIcon({ mood, size = 56 }: MoodIconProps) {
  const scale = size / CROP_WIDTH;
  const height = CROP_HEIGHT * scale;
  const cropLeft = MOOD_CENTER_X[mood] - CROP_WIDTH / 2;

  return (
    <View style={[styles.frame, { width: size, height }]}>
      <Image
        source={require('@/assets/images/moods/pet_moods.png')}
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
