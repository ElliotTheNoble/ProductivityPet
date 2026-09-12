import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { RoomInfo } from '@/utils/rooms';

type RoomDetailScreenProps = {
  room: RoomInfo;
};

// Below this height we treat a wide (width > height) viewport as a phone
// turned sideways rather than a desktop/tablet browser that merely happens
// to be wider than it is tall — typical landscape phone heights are roughly
// 360-430px, while tablets (iPad landscape ~768-834px) and ordinary desktop
// windows (usually 800px+) sit safely above this threshold and keep the
// normal stacked layout below.
const COMPACT_LANDSCAPE_MAX_HEIGHT = 500;

export function RoomDetailScreen({ room }: RoomDetailScreenProps) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isCompactLandscape = width > height && height < COMPACT_LANDSCAPE_MAX_HEIGHT;

  const backButton = (
    <Pressable
      onPress={() => router.push('/rooms')}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="accent" style={styles.backButton}>
        <ThemedText type="smallBold" style={styles.backButtonText}>
          ← Back to Rooms
        </ThemedText>
      </ThemedView>
    </Pressable>
  );

  if (isCompactLandscape) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeAreaLandscape}>
          <View style={styles.landscapeRow}>
            {/* Sized via flex instead of full width, so its height is
                derived from its own share of the row rather than the
                whole screen width — this is what keeps the art from
                becoming oversized in a short landscape viewport. */}
            <View
              style={[
                styles.artWrapLandscape,
                { aspectRatio: room.aspectRatio },
              ]}>
              <Image source={room.image} style={styles.art} contentFit="contain" />
            </View>

            <ScrollView
              style={styles.landscapeTextCol}
              contentContainerStyle={styles.landscapeTextContent}
              showsVerticalScrollIndicator={false}>
              <ThemedText type="subtitle" style={styles.roomNameLandscape}>
                {room.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.descriptionLandscape}>
                {room.description}
              </ThemedText>
              {backButton}
            </ScrollView>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {/* Full-width, aspect-locked art — same treatment as the living
              room background on Home (see PetRoom) — so it reads as the
              main, prominent focus of the page rather than a small thumbnail. */}
          <View style={[styles.artWrap, { aspectRatio: room.aspectRatio }]}>
            <Image source={room.image} style={styles.art} contentFit="contain" />
          </View>

          <ThemedText type="subtitle" style={styles.roomName}>
            {room.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
            {room.description}
          </ThemedText>

          {backButton}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  artWrap: {
    width: '100%',
    borderRadius: Spacing.four,
    overflow: 'hidden',
  },
  art: {
    width: '100%',
    height: '100%',
  },
  roomName: {
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    maxWidth: 360,
  },
  backButton: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
  },
  backButtonText: {
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.7,
  },
  // Landscape-only styles below. Wider max width than the portrait/desktop
  // MaxContentWidth so the side-by-side row can actually use the extra
  // horizontal space a sideways phone provides.
  safeAreaLandscape: {
    flex: 1,
    width: '100%',
    maxWidth: 900,
  },
  landscapeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    gap: Spacing.four,
  },
  artWrapLandscape: {
    flex: 1.3,
    borderRadius: Spacing.four,
    overflow: 'hidden',
  },
  landscapeTextCol: {
    flex: 1,
  },
  landscapeTextContent: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  roomNameLandscape: {
    textAlign: 'left',
  },
  descriptionLandscape: {
    textAlign: 'left',
  },
});
