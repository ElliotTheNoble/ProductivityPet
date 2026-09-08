import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ConfettiBurstProps = {
  active: boolean;
};

// Pieces are arranged in horizontal bands stacked down the full screen height
// (ROW_COUNT bands x PIECES_PER_ROW pieces each) so the celebration reads as
// "confetti everywhere" rather than a single strip falling from the top.
const ROW_COUNT = 7;
const PIECES_PER_ROW = 11;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

type Piece = {
  color: string;
  marginTop: number;
  fallDistance: number;
  drift: number;
  rotateStart: number;
  rotateEnd: number;
  size: number;
  delay: number;
  duration: number;
};

function makePiece(colors: string[]): Piece {
  return {
    color: colors[Math.floor(Math.random() * colors.length)],
    marginTop: randomBetween(0, 16),
    fallDistance: randomBetween(70, 130),
    drift: randomBetween(-24, 24),
    rotateStart: randomBetween(-30, 30),
    rotateEnd: randomBetween(200, 340),
    size: randomBetween(6, 11),
    delay: randomBetween(0, 250),
    duration: randomBetween(900, 1400),
  };
}

// A short, lightweight confetti burst built on React Native's core Animated
// API (no extra dependency, works the same on native and web). Pieces are
// laid out as normal flex children (not absolutely-positioned percentages)
// so their spread never needs a DimensionValue-typed percentage string.
export function ConfettiBurst({ active }: ConfettiBurstProps) {
  const theme = useTheme();

  const rows = useMemo<Piece[][]>(() => {
    if (!active) return [];
    const colors = [theme.accent, theme.mint, theme.peach, theme.purple, theme.backgroundSelected];
    return Array.from({ length: ROW_COUNT }, () =>
      Array.from({ length: PIECES_PER_ROW }, () => makePiece(colors))
    );
    // Reshuffle only when a celebration actually (re)starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (rows.length === 0) return null;

  return (
    <View style={styles.container}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((piece, index) => (
            <ConfettiPiece key={index} piece={piece} />
          ))}
        </View>
      ))}
    </View>
  );
}

function ConfettiPiece({ piece }: { piece: Piece }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: piece.duration,
      delay: piece.delay,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, piece.fallDistance],
  });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, piece.drift] });
  const opacity = progress.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] });
  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [`${piece.rotateStart}deg`, `${piece.rotateEnd}deg`],
  });

  return (
    <Animated.View
      style={{
        width: piece.size,
        height: piece.size,
        marginTop: piece.marginTop,
        borderRadius: piece.size / 3,
        backgroundColor: piece.color,
        opacity,
        transform: [{ translateY }, { translateX }, { rotate }],
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.two,
  },
});
