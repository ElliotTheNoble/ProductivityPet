import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type PetPlaceholderProps = {
  message?: string | null;
};

// Matches assets/images/pets/egg_nest.png (1536x1024) so it's never stretched.
const EGG_ASPECT_RATIO = 1536 / 1024;
// Matches assets/images/pets/kitten_nest.png (1381x1139) so it's never stretched.
const KITTEN_ASPECT_RATIO = 1381 / 1139;
const DOUBLE_TAP_DELAY_MS = 300;
const CRACK_MESSAGE_DURATION_MS = 1800;

export function PetPlaceholder({ message }: PetPlaceholderProps) {
  const [hasHatched, setHasHatched] = useState(false);
  const [showCrackMessage, setShowCrackMessage] = useState(false);
  const lastTapAtRef = useRef(0);
  const crackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (crackTimeoutRef.current) clearTimeout(crackTimeoutRef.current);
    };
  }, []);

  function handlePress() {
    if (hasHatched) return;

    const now = Date.now();
    const wasDoubleTap = now - lastTapAtRef.current < DOUBLE_TAP_DELAY_MS;
    lastTapAtRef.current = now;
    if (!wasDoubleTap) return;

    setHasHatched(true);
    setShowCrackMessage(true);
    if (crackTimeoutRef.current) clearTimeout(crackTimeoutRef.current);
    crackTimeoutRef.current = setTimeout(
      () => setShowCrackMessage(false),
      CRACK_MESSAGE_DURATION_MS
    );
  }

  const bubbleText = showCrackMessage ? 'Crack!' : message;

  return (
    <View style={styles.wrapper}>
      {bubbleText ? (
        <ThemedView type="backgroundElement" style={styles.bubble}>
          <ThemedText type="smallBold">{bubbleText}</ThemedText>
        </ThemedView>
      ) : null}

      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [styles.pressableBase, pressed && styles.pressed]}>
        <View
          style={[
            styles.petWrap,
            { aspectRatio: hasHatched ? KITTEN_ASPECT_RATIO : EGG_ASPECT_RATIO },
          ]}>
          <Image
            source={
              hasHatched
                ? require('@/assets/images/pets/kitten_nest.png')
                : require('@/assets/images/pets/egg_nest.png')
            }
            style={styles.petImage}
            contentFit="contain"
          />
        </View>
      </Pressable>
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
  pressableBase: {
    width: '100%',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.8,
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
