import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { TaskCategory } from '@/utils/categorize-task';

type TaskIconProps = {
  category: TaskCategory;
  size?: number;
};

// assets/images/task_icons/task_icons.png is a single 1350x1165 image
// containing a 2x2 grid of icons: Study | Exercise
//                                 Clean | Personal
// Each cell is displayed by rendering the full sprite at 2x the icon size
// inside a fixed-size, overflow-hidden frame, offset so only the right
// quadrant is visible — a plain CSS-sprite-style crop, no extra assets.
// Health has its own separate (same-aspect-ratio) image instead, since it
// was added later as its own file rather than a fifth sprite cell.
const ICON_ASPECT_RATIO = 1350 / 1165;

type SpriteCategory = Exclude<TaskCategory, 'Health'>;
const GRID_POSITION: Record<SpriteCategory, { col: 0 | 1; row: 0 | 1 }> = {
  Study: { col: 0, row: 0 },
  Exercise: { col: 1, row: 0 },
  Clean: { col: 0, row: 1 },
  Personal: { col: 1, row: 1 },
};

export function TaskIcon({ category, size = 28 }: TaskIconProps) {
  const width = size;
  const height = size / ICON_ASPECT_RATIO;

  if (category === 'Health') {
    return (
      <Image
        source={require('@/assets/images/task_icons/health_icon.png')}
        contentFit="contain"
        style={{ width, height }}
      />
    );
  }

  const { col, row } = GRID_POSITION[category];

  return (
    <View style={[styles.frame, { width, height }]}>
      <Image
        source={require('@/assets/images/task_icons/task_icons.png')}
        contentFit="fill"
        style={{
          position: 'absolute',
          width: width * 2,
          height: height * 2,
          left: -col * width,
          top: -row * height,
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
