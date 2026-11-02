import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';

// The Bathroom's "Gentle Wipe-Down" mini-game, used instead of the normal
// soap / shower / blow-dry bath while a pet is Sick or Critical (see
// @/utils/pet-bathing.ts). The player drags a soft pastel washcloth over the
// kitty — with a mouse on desktop or a finger on a phone — and a small
// progress bar fills as they wipe. It is a fully controlled interaction: it
// only reports ONE `onComplete` per session when the bar reaches 100%, and the
// parent (@/components/room-detail-screen.tsx) awards the Cleanliness. It is
// free and changes nothing else.
//
// Progress comes only from real dragging: the distance the pointer travels
// while it is over the kitty's box. Resting still or moving outside the box
// adds nothing, so the cleaning can never complete by itself.

// How far (in px of pointer travel over the kitty) one full wipe-down takes.
const WIPE_PATH_PX = 1800;
const CLOTH_WIDTH = 72;
const CLOTH_HEIGHT = 54;

type Props = {
  // Called once when a session reaches 100%.
  onComplete: () => void;
  // Whether to offer "Wipe again" after a finished session (the pet still
  // needs more Cleanliness).
  canWipeAgain: boolean;
};

export function GentleWipeGame({ onComplete, canWipeAgain }: Props) {
  const { t } = useT();
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [sparkle, setSparkle] = useState<{ x: number; y: number; key: number } | null>(null);

  const progressRef = useRef(0);
  const doneRef = useRef(false);
  const boxRef = useRef(box);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const cloth = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const sparkleOpacity = useRef(new Animated.Value(0)).current;
  const sparkleCount = useRef(0);

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    const next = { width, height };
    boxRef.current = next;
    setBox(next);
  }

  // Resting spot for the washcloth (lower right of the kitty) until dragged.
  useEffect(() => {
    if (box.width > 0 && !lastPoint.current) {
      cloth.setValue({ x: box.width * 0.78 - CLOTH_WIDTH / 2, y: box.height * 0.72 - CLOTH_HEIGHT / 2 });
    }
  }, [box.width, box.height, cloth]);

  function moveCloth(x: number, y: number) {
    cloth.setValue({ x: x - CLOTH_WIDTH / 2, y: y - CLOTH_HEIGHT / 2 });
  }

  function addProgress(delta: number, x: number, y: number) {
    if (doneRef.current || delta <= 0) return;
    const before = progressRef.current;
    const next = Math.min(100, before + (delta / WIPE_PATH_PX) * 100);
    progressRef.current = next;
    setProgress(next);
    // A little sparkle each time another 10% is wiped.
    if (Math.floor(next / 10) > Math.floor(before / 10)) {
      sparkleCount.current += 1;
      setSparkle({ x, y, key: sparkleCount.current });
      sparkleOpacity.setValue(1);
      Animated.timing(sparkleOpacity, { toValue: 0, duration: 600, useNativeDriver: true }).start();
    }
    if (next >= 100) {
      doneRef.current = true;
      setDone(true);
      lastPoint.current = null;
      onCompleteRef.current();
    }
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !doneRef.current,
      onMoveShouldSetPanResponder: () => !doneRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const { locationX, locationY } = event.nativeEvent;
        lastPoint.current = { x: locationX, y: locationY };
        moveCloth(locationX, locationY);
      },
      onPanResponderMove: (event) => {
        if (doneRef.current) return;
        const { locationX: x, locationY: y } = event.nativeEvent;
        moveCloth(x, y);
        const last = lastPoint.current;
        lastPoint.current = { x, y };
        if (!last) return;
        const { width, height } = boxRef.current;
        // Only wiping over the kitty's own box counts.
        const inside = x >= 0 && y >= 0 && x <= width && y <= height;
        if (inside) addProgress(Math.hypot(x - last.x, y - last.y), x, y);
      },
      onPanResponderRelease: () => {
        lastPoint.current = null;
      },
      onPanResponderTerminate: () => {
        lastPoint.current = null;
      },
    })
  ).current;

  function wipeAgain() {
    progressRef.current = 0;
    doneRef.current = false;
    lastPoint.current = null;
    setProgress(0);
    setDone(false);
    setSparkle(null);
  }

  const percent = Math.round(progress);

  return (
    <View style={styles.wrapper} onLayout={handleLayout}>
      {/* The drag surface: children never take touches, so the pointer
          positions are always relative to this box. */}
      <View
        style={[styles.dragSurface, Platform.OS === 'web' ? (webDragStyle as object) : null]}
        {...panResponder.panHandlers}>
        <Animated.View
          pointerEvents="none"
          style={[styles.cloth, { transform: cloth.getTranslateTransform() }, done && styles.clothDone]}>
          <Text style={styles.clothHeart}>♡</Text>
        </Animated.View>
        {sparkle ? (
          <Animated.View
            key={sparkle.key}
            pointerEvents="none"
            style={[styles.sparkle, { left: sparkle.x - 12, top: sparkle.y - 12, opacity: sparkleOpacity }]}>
            <Text style={styles.sparkleText}>✨</Text>
          </Animated.View>
        ) : null}
      </View>

      {/* Small, cute progress bar above the kitty. */}
      <View pointerEvents="none" style={styles.barWrap}>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${percent}%` }]} />
        </View>
        <ThemedText type="smallBold" style={styles.barLabel}>
          {done ? t('wipeDone') : `🧽 ${percent}%`}
        </ThemedText>
      </View>

      {done && canWipeAgain ? (
        <View style={styles.againWrap} pointerEvents="box-none">
          <Text onPress={wipeAgain} accessibilityRole="button" style={styles.againButton}>
            {t('wipeAgain')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Stops the browser from scrolling / selecting text while the player drags.
const webDragStyle = { touchAction: 'none', userSelect: 'none', cursor: 'grab' };

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFill,
  },
  dragSurface: {
    ...StyleSheet.absoluteFill,
  },
  cloth: {
    position: 'absolute',
    width: CLOTH_WIDTH,
    height: CLOTH_HEIGHT,
    borderRadius: 18,
    backgroundColor: '#FFD9E8',
    borderWidth: 3,
    borderColor: '#F7A8C8',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.92,
  },
  clothDone: {
    opacity: 0.5,
  },
  clothHeart: {
    fontSize: 22,
    color: '#F28DAE',
  },
  sparkle: {
    position: 'absolute',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleText: {
    fontSize: 20,
  },
  barWrap: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    top: -34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  barTrack: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 2,
    borderColor: '#F7C6DA',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#F28DAE',
  },
  barLabel: {
    minWidth: 70,
  },
  againWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 6,
    alignItems: 'center',
  },
  againButton: {
    overflow: 'hidden',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    backgroundColor: '#B8E0F6',
    color: '#3C2A3A',
    fontWeight: '700',
    cursor: 'pointer',
  } as object,
});
