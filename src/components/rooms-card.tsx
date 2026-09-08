import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type RoomPreview = {
  name: string;
  source: number;
};

// All 6 previews are cropped from assets/images/rooms/room_previews.png (a
// 3x2 grid, one card per room, each with its own baked-in pastel label pill
// — so no separate text label is rendered below the image here, unlike the
// other icon grids in this app). Cropped into standalone files rather than
// sprite-cropped at runtime, same reasoning as the pet growth stages: these
// grid cells are responsively sized (percentage width), so there's no known
// pixel size to compute a runtime crop against.
const ROOMS: RoomPreview[] = [
  { name: 'Living Room', source: require('@/assets/images/rooms/room_preview_living.png') },
  { name: 'Study Room', source: require('@/assets/images/rooms/room_preview_study.png') },
  { name: 'Gym', source: require('@/assets/images/rooms/room_preview_gym.png') },
  { name: 'Bedroom', source: require('@/assets/images/rooms/room_preview_bedroom.png') },
  { name: 'Bathroom', source: require('@/assets/images/rooms/room_preview_bathroom.png') },
  { name: 'Kitchen', source: require('@/assets/images/rooms/room_preview_kitchen.png') },
];

const SELECTED_ROOM = 'Living Room';

// Visual layout only for now — cards are not pressable and room switching
// does not work yet, per instructions.
export function RoomsCard() {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.headerRow}>
        <ThemedText style={styles.title}>Rooms</ThemedText>
        <ThemedText type="smallBold" themeColor="textSecondary">
          View All →
        </ThemedText>
      </View>

      <View style={styles.grid}>
        {ROOMS.map((room) => {
          const isSelected = room.name === SELECTED_ROOM;
          return (
            <View
              key={room.name}
              style={[
                styles.roomPreview,
                { borderColor: theme.backgroundElement },
                isSelected && { borderColor: theme.accent },
              ]}>
              <Image source={room.source} style={styles.previewImage} contentFit="contain" />
            </View>
          );
        })}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  roomPreview: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: Spacing.three,
    borderWidth: 2,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
});
