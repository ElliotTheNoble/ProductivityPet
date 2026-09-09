import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { RoomSlug } from '@/utils/rooms';

type RoomPreview = {
  name: string;
  // null means "not a /rooms/[room] detail page" — Living Room instead
  // navigates straight back to Home, which already is the living room.
  slug: RoomSlug | null;
  source: number;
};

// All 6 previews are cropped from assets/images/rooms/room_previews.png (a
// 3x2 grid, one card per room, each with its own baked-in pastel label pill
// — so no separate text label is rendered below the image here, unlike the
// other icon grids in this app). Cropped into standalone files rather than
// sprite-cropped at runtime, same reasoning as the pet growth stages: these
// grid cells are responsively sized (percentage width), so there's no known
// pixel size to compute a runtime crop against.
//
// This preview art is intentionally kept separate from src/utils/rooms.ts's
// room data (used by the 5 functional room detail pages) — those use full-
// size backgrounds, not these small square preview cards.
const ROOMS: RoomPreview[] = [
  {
    name: 'Living Room',
    slug: null,
    source: require('@/assets/images/rooms/room_preview_living.png'),
  },
  {
    name: 'Study Room',
    slug: 'study-room',
    source: require('@/assets/images/rooms/room_preview_study.png'),
  },
  { name: 'Gym', slug: 'gym', source: require('@/assets/images/rooms/room_preview_gym.png') },
  {
    name: 'Bedroom',
    slug: 'bedroom',
    source: require('@/assets/images/rooms/room_preview_bedroom.png'),
  },
  {
    name: 'Bathroom',
    slug: 'bathroom',
    source: require('@/assets/images/rooms/room_preview_bathroom.png'),
  },
  {
    name: 'Kitchen',
    slug: 'kitchen',
    source: require('@/assets/images/rooms/room_preview_kitchen.png'),
  },
];

const SELECTED_ROOM = 'Living Room';

// How long the tapped card stays highlighted before navigating away — long
// enough to see, short enough not to feel like a delay.
const TAP_HIGHLIGHT_DELAY_MS = 250;

// The room preview cards are now clickable. Living Room goes back to Home
// (the existing living room); the other 5 open their own detail page. The
// cards' own look is unchanged — only a Pressable wrapper was added.
export function RoomsCard() {
  const theme = useTheme();
  const router = useRouter();
  const [tappedRoom, setTappedRoom] = useState<string | null>(null);
  const navigateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (navigateTimeoutRef.current) clearTimeout(navigateTimeoutRef.current);
    };
  }, []);

  function openRoom(slug: RoomSlug | null) {
    if (slug === null) {
      router.push('/');
    } else {
      router.push({ pathname: '/rooms/[room]', params: { room: slug } });
    }
  }

  function handlePressRoom(room: RoomPreview) {
    setTappedRoom(room.name);
    if (navigateTimeoutRef.current) clearTimeout(navigateTimeoutRef.current);
    navigateTimeoutRef.current = setTimeout(() => {
      openRoom(room.slug);
    }, TAP_HIGHLIGHT_DELAY_MS);
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.headerRow}>
        <ThemedText style={styles.title}>Rooms</ThemedText>
        <Pressable
          onPress={() => router.push('/rooms')}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            View All →
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {ROOMS.map((room) => {
          const isHighlighted = room.name === SELECTED_ROOM || room.name === tappedRoom;
          return (
            <Pressable
              key={room.name}
              onPress={() => handlePressRoom(room)}
              style={({ pressed }) => [styles.roomItem, pressed && styles.pressed]}>
              <View
                style={[
                  styles.roomPreview,
                  { borderColor: theme.backgroundElement },
                  isHighlighted && { borderColor: theme.accent },
                ]}>
                <Image source={room.source} style={styles.previewImage} contentFit="contain" />
              </View>
            </Pressable>
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
  pressed: {
    opacity: 0.7,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  roomItem: {
    width: '31%',
  },
  roomPreview: {
    width: '100%',
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
