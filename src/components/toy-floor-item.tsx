import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { SpriteCrop } from '@/components/sprite-crop';
import { getToy, getToyArtFor } from '@/utils/toys/toy-catalog';

// The temporary toy shown beside the kitty during a toy session (see @/utils/pet-toy-session.ts).
// Purely visual: not interactive, never saved, and it only exists while a session is running. Sized
// as a percentage of the pet's own box so it scales with the pet in portrait, landscape and desktop.
// The gentle bounce is the default "animation"; a toy with its own animation can later be handled
// here by toyId without touching the pet or the Shop.
export function ToyFloorItem({ toyId }: { toyId: string }) {
  const toy = getToy(toyId);
  const art = toy ? getToyArtFor(toy) : null;
  const [width, setWidth] = useState(0);
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bounce]);

  if (!art) return null;
  const height = width * (art.cropHeight / art.cropWidth);
  return (
    <View
      pointerEvents="none"
      accessibilityLabel={toy ? `${toy.name} is out to play` : undefined}
      style={[styles.slot, { aspectRatio: art.cropWidth / art.cropHeight }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Animated.View style={{ transform: [{ translateY: bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -width * 0.08] }) }] }}>
          <SpriteCrop {...art} width={width} height={height} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Floor level, to the right of the pet (the poop piles sit on the left side).
  slot: {
    position: 'absolute',
    right: '-8%',
    bottom: '-2%',
    width: '40%',
    zIndex: 1,
  },
});
