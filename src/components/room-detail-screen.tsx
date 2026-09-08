import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { RoomInfo } from '@/utils/rooms';

type RoomDetailScreenProps = {
  room: RoomInfo;
};

export function RoomDetailScreen({ room }: RoomDetailScreenProps) {
  const router = useRouter();

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

          <Pressable
            onPress={() => router.push('/rooms')}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="accent" style={styles.backButton}>
              <ThemedText type="smallBold" style={styles.backButtonText}>
                ← Back to Rooms
              </ThemedText>
            </ThemedView>
          </Pressable>
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
});
