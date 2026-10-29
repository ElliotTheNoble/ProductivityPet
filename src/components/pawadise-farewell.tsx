import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  FAREWELL_CHARACTER_LAYOUT,
  FAREWELL_DEPARTURE_FOCUS_X,
  FAREWELL_DEPARTURE_HOLD_MS,
  FAREWELL_FADE_MS,
  getFarewellScenes,
  pickFarewellMessages,
} from '@/utils/pawadise-farewell';

// The Pet Pawadise farewell, shown full-screen AFTER a pet has been retired successfully (the retirement is
// already saved, so closing the app during this changes nothing).
//   farewell scene: the Pawadise entrance picture as the background with a separate transparent kitty in
//   front (centred); three different farewell messages, one at a time, in a speech bubble beside her head;
//   a real "Tap to Continue" button (or a tap anywhere) moves on;
//   departure scene: "Kitty leaves" - a complete picture it fades to (no kitty drawn on top), shown for about
//   five seconds, then the farewell ends.
// Skip ends it at once at any time. Reduced motion swaps the fade for an instant change. Every path calls
// onDone exactly once, so the overlay can't get stuck.
//
// The "tap anywhere" layer, the Tap to Continue button and Skip are SIBLINGS (never nested), so pressing a
// button can't also trigger the full-screen tap, and a short lock stops one press advancing twice.

type Phase = 'bye' | 'leaves';
const ADVANCE_LOCK_MS = 350;

export function PawadiseFarewell({ species, onDone }: { species: string; onDone: () => void }) {
  const scenes = getFarewellScenes(species);
  const messages = useMemo(() => pickFarewellMessages(), []);
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('bye');
  const [hover, setHover] = useState<'continue' | 'skip' | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(false);
  const lastAdvance = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    fade.stopAnimation();
    onDone();
  }

  // No scene for this species: nothing to show.
  useEffect(() => {
    if (!scenes) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes]);

  // Departure: fade to "Kitty leaves", show it for about five seconds, finish.
  useEffect(() => {
    if (phase !== 'leaves') return;
    if (reduced) {
      fade.setValue(1);
      timer.current = setTimeout(finish, FAREWELL_DEPARTURE_HOLD_MS);
    } else {
      Animated.timing(fade, { toValue: 1, duration: FAREWELL_FADE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) timer.current = setTimeout(finish, FAREWELL_DEPARTURE_HOLD_MS);
        }
      );
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduced]);

  // Never leaves a timer behind if the screen goes away.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  if (!scenes) return null;

  // Moves to the next message (or to the departure after the last). Ignored during the departure (only Skip
  // ends that early, so tapping through the messages can't skip the goodbye picture), and locked briefly so
  // one press can never advance two messages.
  function advance() {
    if (phase !== 'bye') return;
    const now = Date.now();
    if (now - lastAdvance.current < ADVANCE_LOCK_MS) return;
    lastAdvance.current = now;
    if (index < messages.length - 1) setIndex(index + 1);
    else setPhase('leaves');
  }

  const wide = width / height >= 1.2;
  const layout = wide ? FAREWELL_CHARACTER_LAYOUT.wide : FAREWELL_CHARACTER_LAYOUT.tall;

  // Character: a separate layer, whole (contain) at her real proportions. Her horizontal position is set so the
  // VISIBLE kitty (the artwork's own bounds, which have a little transparent margin) is centred at
  // `layout.centerX` of the screen width.
  const charW = Math.min(width * layout.maxWidthFraction, height * layout.maxHeightFraction * scenes.characterAspectRatio);
  const charH = charW / scenes.characterAspectRatio;
  const vis = scenes.characterVisible;
  const visibleCenterInPicture = ((vis.left + vis.right) / 2) * charW;
  const charLeft = width * layout.centerX - visibleCenterInPicture;
  const charBottomPx = height * layout.bottom;
  const charTop = height - charBottomPx - charH;
  const headTop = charTop + vis.top * charH;
  const visibleRight = charLeft + vis.right * charW;

  // Speech bubble, right next to her head. Tall screens: just above her hat, centred over her. Wide screens
  // (little room above her): beside her head on the right, level with it, clear of her face and raised paw.
  const bubbleW = wide ? Math.max(200, Math.min(380, width - visibleRight - Spacing.three)) : Math.min(width - 2 * Spacing.three, 340);
  const bubblePos = wide
    ? { left: Math.min(visibleRight + Spacing.one, width - bubbleW - Spacing.two), top: Math.max(insets.top + 8, headTop + 0.04 * charH), width: bubbleW }
    : {
        left: Math.max(Spacing.three, Math.min(width * layout.centerX - bubbleW / 2, width - bubbleW - Spacing.three)),
        bottom: height - headTop + Spacing.two,
        width: bubbleW,
      };

  const background = (
    <Image source={scenes.background} contentFit="cover" contentPosition={{ left: '50%', top: '50%' }} style={StyleSheet.absoluteFill} />
  );
  const character = (
    <Image
      source={scenes.character}
      contentFit="contain"
      accessibilityLabel="Your kitty waving goodbye with her suitcase"
      style={{ position: 'absolute', left: charLeft, bottom: charBottomPx, width: charW, height: charH }}
    />
  );
  // Departure scene: a complete picture that fills the screen at its real proportions; which part of it shows
  // is set per orientation (see FAREWELL_DEPARTURE_FOCUS_X).
  const departure = (
    <Image
      source={scenes.leaves}
      contentFit="cover"
      contentPosition={{ left: wide ? FAREWELL_DEPARTURE_FOCUS_X.wide : FAREWELL_DEPARTURE_FOCUS_X.portrait, top: '50%' }}
      style={StyleSheet.absoluteFill}
    />
  );

  return (
    <Modal visible transparent={false} animationType={reduced ? 'none' : 'fade'} statusBarTranslucent onRequestClose={finish}>
      <View style={styles.root}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {background}
          {character}
        </View>
        {phase === 'leaves' ? (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
            {departure}
          </Animated.View>
        ) : null}

        {/* Tap anywhere to continue (a sibling of the buttons below, never their parent). */}
        {phase === 'bye' ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={advance}
            accessibilityRole="button"
            accessibilityLabel="Farewell. Tap anywhere to continue."
          />
        ) : null}

        {phase === 'bye' ? (
          <View style={[styles.bubbleWrap, bubblePos]} pointerEvents="box-none">
            <View style={styles.bubble}>
              <ThemedText style={styles.bubbleText} accessibilityRole="alert">
                {messages[index]}
              </ThemedText>
              <View style={styles.continueRow}>
                <Pressable
                  onPress={advance}
                  onHoverIn={() => setHover('continue')}
                  onHoverOut={() => setHover(null)}
                  accessibilityRole="button"
                  accessibilityLabel={index < messages.length - 1 ? 'Tap to Continue to the next message' : 'Tap to Continue to the goodbye'}
                  style={({ pressed }) => [
                    styles.continueButton,
                    hover === 'continue' && styles.continueHover,
                    pressed && styles.continuePressed,
                  ]}>
                  <ThemedText type="smallBold" style={styles.continueText}>
                    Tap to Continue
                  </ThemedText>
                </Pressable>
                <ThemedText type="smallBold" style={styles.counter}>
                  {`${index + 1} of ${messages.length}`}
                </ThemedText>
              </View>
            </View>
          </View>
        ) : null}

        {/* Skip: bigger, clear of the screen edges and the phone's safe area. */}
        <Pressable
          onPress={finish}
          onHoverIn={() => setHover('skip')}
          onHoverOut={() => setHover(null)}
          accessibilityRole="button"
          accessibilityLabel="Skip the farewell"
          style={({ pressed }) => [
            styles.skip,
            { top: insets.top + Spacing.three, right: Math.max(insets.right, 0) + Spacing.three },
            hover === 'skip' && styles.skipHover,
            pressed && styles.skipPressed,
          ]}>
          <ThemedText style={styles.skipText}>Skip</ThemedText>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FBE7D0' },
  bubbleWrap: { position: 'absolute', alignItems: 'center' },
  bubble: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 250, 244, 0.96)',
    borderRadius: Spacing.four,
    borderWidth: 3,
    borderColor: '#F7B6CB',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
    alignItems: 'center',
  },
  bubbleText: { fontSize: 19, lineHeight: 26, fontWeight: '800', textAlign: 'center', color: '#5A3A47' },
  continueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  continueButton: {
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.five,
    backgroundColor: '#F7B6CB',
    borderWidth: 2,
    borderColor: '#F28DAE',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  continueHover: {
    backgroundColor: '#F59AB9',
    borderColor: '#E56C98',
    transform: [{ scale: 1.06 }, { translateY: -2 }],
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  continuePressed: { transform: [{ scale: 0.96 }], opacity: 0.85 },
  continueText: { color: '#5A2A3C', fontSize: 16, lineHeight: 22 },
  counter: { color: '#9A7A86' },
  skip: {
    position: 'absolute',
    minHeight: 48,
    minWidth: 96,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.five,
    backgroundColor: 'rgba(255, 250, 244, 0.95)',
    borderWidth: 2,
    borderColor: '#F7B6CB',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  skipHover: { backgroundColor: '#FFFFFF', borderColor: '#F28DAE', transform: [{ scale: 1.06 }] },
  skipPressed: { transform: [{ scale: 0.95 }], opacity: 0.85 },
  skipText: { color: '#5A3A47', fontSize: 18, lineHeight: 24, fontWeight: '800' },
});
