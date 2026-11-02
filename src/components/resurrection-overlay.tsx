import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { AccessibilityInfo, Animated, Easing, Modal, StyleSheet, View, useWindowDimensions } from 'react-native';

import { HoverPressable as Pressable } from '@/components/hover-pressable';

import { PetAvatar } from '@/components/pet-avatar';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePetFamily } from '@/hooks/use-pet-family';
import { completeRevivalAnimation } from '@/utils/pet-family';
import { RESURRECTION_ANIMATION_MS, GROWTH_UNITS_PER_TASK } from '@/utils/pet-family-config';
import { getRenderedStage } from '@/utils/pet-growth';
import { getResurrectionHappyMessage } from '@/utils/pet-life-messages';
import { HOSPITAL_TRUCK_ASPECT_RATIO, HOSPITAL_TRUCK_SOURCE } from '@/utils/resurrection-art';

// The pastel hospital-truck sequence shown after a successful resurrection:
// the truck drives in, stops, a progress bar fills over about 60 seconds, the
// truck drives away, and the revived pet appears with a happy message.
//
// It is PURELY VISUAL. The 500-token payment and the revival were already
// completed atomically before this appears (see resurrectPet in
// @/utils/pet-family.ts), so nothing here can charge anyone or decide whether
// the resurrection worked. Progress is computed from the saved start time, so
// if the app is closed and reopened the sequence resumes where it should (or
// goes straight to the happy ending if the time has already passed), and
// "Skip" jumps to the ending. Reduced-motion users get the progress bar and
// messages without the truck sliding.

const ARRIVE_MS = 2500;
const LEAVE_MS = 2500;
// The truck is sized from the screen width (so it suits a phone and a wide web
// window alike), within these limits.
const TRUCK_MAX_WIDTH = 480;
const TRUCK_MIN_WIDTH = 180;
const TRUCK_SCREEN_FRACTION = 0.7;

type Phase = 'arriving' | 'working' | 'leaving' | 'reveal';

export function ResurrectionOverlay() {
  const { t } = useT();
  const family = usePetFamily();
  const { width } = useWindowDimensions();
  const pending = family?.pets.find((pet) => pet.revival && !pet.revival.done) ?? null;
  // The on-screen sequence for one revived pet. Kept locally so the happy
  // ending can stay up after the saved record has been marked done.
  const [session, setSession] = useState<{ petId: string; startedMs: number } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [skipped, setSkipped] = useState(false);
  const truckWidth = Math.max(TRUCK_MIN_WIDTH, Math.min(TRUCK_MAX_WIDTH, width * TRUCK_SCREEN_FRACTION));
  const truckHeight = truckWidth / HOSPITAL_TRUCK_ASPECT_RATIO;
  const truckX = useRef(new Animated.Value(-TRUCK_MAX_WIDTH - 40)).current;
  const lastAnimated = useRef<Phase | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  // A resurrection whose animation hasn't finished (including one left over
  // from before the app was closed) starts or resumes the sequence.
  useEffect(() => {
    if (!session && pending?.revival) {
      const started = new Date(pending.revival.startedAt).getTime();
      setSession({ petId: pending.id, startedMs: Number.isNaN(started) ? Date.now() : started });
      setSkipped(false);
      lastAnimated.current = null;
    }
  }, [pending, session]);

  const active = session !== null;
  const petForView = family?.pets.find((p) => p.id === session?.petId) ?? null;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);

  // Which part of the sequence we are in, from the saved start time.
  let phase: Phase = 'reveal';
  let progress = 1;
  if (session && !skipped) {
    const elapsed = Math.max(0, now - session.startedMs);
    progress = Math.min(1, elapsed / RESURRECTION_ANIMATION_MS);
    if (elapsed < ARRIVE_MS) phase = 'arriving';
    else if (elapsed < RESURRECTION_ANIMATION_MS) phase = 'working';
    else if (elapsed < RESURRECTION_ANIMATION_MS + LEAVE_MS) phase = 'leaving';
    else phase = 'reveal';
  }

  // Slide the truck when the phase changes.
  useEffect(() => {
    if (!active) return;
    if (lastAnimated.current === phase) return;
    lastAnimated.current = phase;
    const centerX = Math.max(0, (width - truckWidth) / 2);
    if (phase === 'arriving') {
      truckX.setValue(-truckWidth - 40);
      Animated.timing(truckX, {
        toValue: centerX,
        duration: reduceMotion ? 0 : ARRIVE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (phase === 'working') {
      truckX.setValue(centerX);
    } else if (phase === 'leaving') {
      Animated.timing(truckX, {
        toValue: width + 40,
        duration: reduceMotion ? 0 : LEAVE_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [phase, active, width, truckWidth, reduceMotion, truckX]);

  // Once the sequence is over, record that it was shown so it never replays.
  useEffect(() => {
    if (session && phase === 'reveal') completeRevivalAnimation(session.petId);
  }, [session, phase]);

  if (!active || !petForView) return null;

  const stage = getRenderedStage(Math.floor(petForView.growthUnits / GROWTH_UNITS_PER_TASK), petForView.profile.paidStageIndex);
  const percent = Math.round(progress * 100);
  const showTruck = phase !== 'reveal';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.hearts} pointerEvents="none">
          <ThemedText style={styles.deco}>🐾 💗 🐾 💗 🐾</ThemedText>
        </View>

        <View style={[styles.stage, { height: Math.max(180, truckHeight + 20) }]}>
          {showTruck ? (
            <Animated.View
              style={[styles.truckWrap, { width: truckWidth, height: truckHeight, transform: [{ translateX: truckX }] }]}>
              {/* One picture, moved as a whole — no wheels, lights or parts are animated. */}
              <Image
                source={HOSPITAL_TRUCK_SOURCE}
                contentFit="contain"
                accessibilityLabel={t('rezTruckAlt')}
                style={{ width: truckWidth, height: truckHeight }}
              />
            </Animated.View>
          ) : (
            <View style={styles.reveal}>
              <PetAvatar
                stage={stage}
                equippedAccessoryIds={stage === 'Egg' ? [] : [petForView.equipped.bow, petForView.equipped.hat]}
                size={180}
              />
              <ThemedText style={styles.revealMessage}>{getResurrectionHappyMessage()}</ThemedText>
              <Pressable
                onPress={() => {
                  setSession(null);
                  setSkipped(false);
                }}
                accessibilityRole="button">
                <View style={[styles.button, styles.pointer]}>
                  <ThemedText type="smallBold" style={styles.buttonText}>
                    {t('rezYay')}
                  </ThemedText>
                </View>
              </Pressable>
            </View>
          )}
        </View>

        {showTruck ? (
          <View style={styles.footer}>
            <ThemedText type="smallBold" style={styles.title}>
              {phase === 'arriving'
                ? t('rezArriving')
                : phase === 'working'
                  ? t('rezWorking')
                  : t('rezLeaving')}
            </ThemedText>
            <View
              style={styles.track}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: percent }}>
              <View style={[styles.fill, { width: `${percent}%` }]} />
            </View>
            <ThemedText type="small" style={styles.percent}>
              {percent}%
            </ThemedText>
            <Pressable
              onPress={() => {
                setSkipped(true);
                if (session) completeRevivalAnimation(session.petId);
              }}
              accessibilityRole="button">
              <View style={[styles.skip, styles.pointer]}>
                <ThemedText type="smallBold">{t('rezSkip')}</ThemedText>
              </View>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#FFF4EC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
    gap: Spacing.four,
  },
  hearts: { position: 'absolute', top: 40, left: 0, right: 0, alignItems: 'center' },
  deco: { fontSize: 22 },
  stage: { width: '100%', minHeight: 180, justifyContent: 'center' },
  truckWrap: { position: 'absolute', left: 0 },
  footer: { width: '100%', maxWidth: 420, alignItems: 'center', gap: Spacing.two },
  title: { textAlign: 'center', color: '#6B4A5A' },
  track: { width: '100%', height: 18, borderRadius: 9, backgroundColor: '#E9DDF5', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#7FD9B6', borderRadius: 9 },
  percent: { color: '#6B4A5A' },
  skip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.five, backgroundColor: '#FBE3EC' },
  reveal: { alignItems: 'center', gap: Spacing.three },
  revealMessage: { fontSize: 18, lineHeight: 26, textAlign: 'center', color: '#6B4A5A', maxWidth: 360 },
  button: { backgroundColor: '#F28DAE', paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: Spacing.five },
  buttonText: { color: '#FFFFFF' },
  pointer: { cursor: 'pointer' },
});
