import { Image } from 'expo-image';
import { usePathname } from 'expo-router';
import { useT } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, View, useWindowDimensions } from 'react-native';

import { HoverPressable as Pressable } from '@/components/hover-pressable';

import { PostcardViewer } from '@/components/pawadise-postcard-views';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePetFamily } from '@/hooks/use-pet-family';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { getPetLabel } from '@/utils/pet-family';
import { ENVELOPE_ART, ENVELOPE_ASPECT_RATIO, MAILBOX_ART, MAILBOX_ASPECT_RATIO } from '@/utils/pawadise-art';
import { openPendingMail, usePendingMail } from '@/utils/pawadise-mail';
import type { PawadisePostcard } from '@/utils/pawadise-postcards';

// The Pawadise mailbox on Home. When a postcard has arrived (see @/utils/pawadise-mail.ts) the player's
// mailbox HOPS around the upper part of the screen (crouch, jump in an arc while moving sideways, land with a
// little squash-and-bounce, rest, repeat) until it is tapped:
//   moving  --tap-->  stopped  --double-tap (or the "Open mail" button)-->  envelope
//   envelope --double-tap (or "Open")--> the two-sided postcard viewer (the postcard is saved to the
//   sending pet's scrapbook at this moment).
// Closing the envelope goes back to the stopped mailbox, so unopened mail is never lost. Several waiting
// postcards are queued: only one mailbox is ever shown, then the next one starts moving.
// Taps on the mailbox are handled by the mailbox itself, so nothing underneath is activated.

type Stage = 'moving' | 'stopped' | 'envelope' | 'viewer';

const DOUBLE_TAP_MS = 450;
const EDGE = 46; // keeps clear of the side-panel tabs
// The mailbox's drawn size is matched to the Home kitty's VISIBLE size (passed in by Home): the mailbox's
// visible part comes out about 5% bigger than the kitty. The mailbox picture itself has almost no empty
// margin (its visible part is about 93% of the file).
const KITTY_VISUAL_FACTOR = 1.05;
// Room kept below the mailbox for its "Double-tap to open" bubble and the Open mail button (they hang under it
// once it stops), plus a small margin, so they are never pushed past the bottom of the screen.
const STOPPED_EXTRAS_H = 76;
const BOTTOM_MARGIN = 8;
const MAILBOX_VISIBLE_FRACTION = 0.926;

function rand(min: number, max: number): number {
  return min + Math.random() * Math.max(0, max - min);
}

export function PawadiseMailbox({ kittyVisiblePx }: { kittyVisiblePx: number }) {
  const { t } = useT();
  const pending = usePendingMail();
  const family = usePetFamily();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [stage, setStage] = useState<Stage>('moving');
  const [opened, setOpened] = useState<{ card: PawadisePostcard; petLabel: string } | null>(null);
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  // Hop animation values: `arc` is the extra height above the ground during a jump, `squash` the body squash.
  const arc = useRef(new Animated.Value(0)).current;
  const squash = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const envelopeWobble = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);
  const placed = useRef(false);
  const busy = useRef(false);
  const current = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const id = pos.addListener((v) => {
      current.current = v;
    });
    return () => pos.removeListener(id);
  }, [pos]);

  const active = pending[0] ?? null;
  const onHome = pathname === '/' || pathname === '';
  // Width of the picture so that its VISIBLE mailbox is about as big as the visible kitty (never wider than
  // half the Home area, and never so tall that it doesn't fit above the pet's needs bars).
  const wanted = (kittyVisiblePx * KITTY_VISUAL_FACTOR) / MAILBOX_VISIBLE_FRACTION;
  const size = Math.max(110, Math.min(wanted, area.w > 0 ? area.w * 0.5 : wanted, area.h > 0 ? area.h * 0.62 * MAILBOX_ASPECT_RATIO : wanted));
  const boxH = size / MAILBOX_ASPECT_RATIO;

  const labelFor = (petId: string) => {
    const pet = family?.pets.find((p) => p.id === petId);
    return pet && family ? getPetLabel(pet, family.pets) : t('mbYourPet');
  };

  // A new piece of mail (or the next one in the queue) starts moving again (still, if motion is reduced).
  const activeId = active?.id ?? null;
  useEffect(() => {
    if (stage === 'viewer') return;
    lastTap.current = 0;
    setStage(reduced ? 'stopped' : 'moving');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, reduced]);

  // Where the mailbox may hop (relative to the Home area, which starts below the header): clear of the
  // side-panel tabs and, as far as the room allows, above the pet's needs bars and care buttons.
  const minX = EDGE;
  const maxX = Math.max(minX, area.w - size - EDGE);
  // How high a jump goes (always clearly visible); the resting spots start that far down, so even the top of
  // a jump stays inside the Home area.
  const hopHeight = Math.max(36, Math.min(boxH * 0.4, 80));
  const minY = hopHeight + 6;
  // The "Double-tap to open" bubble and Open mail button normally hang UNDER the mailbox. On a short area
  // (landscape) there is no room for that, so they go BESIDE it instead (on the side with more space), and the
  // mailbox may rest lower. `safeMaxY` is the lowest resting spot that keeps whichever layout inside the area.
  const extrasBelowFit = area.h - boxH - STOPPED_EXTRAS_H - BOTTOM_MARGIN - minY >= 30;
  const extrasBeside = area.h > 0 && !extrasBelowFit;
  const safeMaxY = extrasBeside ? area.h - boxH - BOTTOM_MARGIN : area.h - boxH - STOPPED_EXTRAS_H - BOTTOM_MARGIN;
  const maxY = Math.max(minY, Math.min(Math.max(minY + 10, area.h * 0.5 - boxH * 0.6), safeMaxY));

  // Hop from spot to spot until tapped: crouch -> jump (up and down in an arc while moving sideways) ->
  // land with a squash-and-bounce -> rest a moment -> repeat. Sideways movement only happens in the air.
  useEffect(() => {
    if (!active || !onHome || stage !== 'moving' || reduced || area.w === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!placed.current) {
      pos.setValue({ x: rand(minX, maxX), y: rand(minY, maxY) });
      placed.current = true;
    }
    arc.setValue(0);
    squash.setValue(1);
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    const hop = () => {
      if (cancelled) return;
      const from = current.current;
      // A hop of 80-170 px sideways, turning around at the edges, and a little up or down.
      let dir = Math.random() < 0.5 ? -1 : 1;
      if (from.x - minX < 80) dir = 1;
      else if (maxX - from.x < 80) dir = -1;
      const nx = clamp(from.x + dir * rand(80, 170), minX, maxX);
      const ny = clamp(from.y + rand(-24, 24), minY, maxY);
      const air = 720;

      Animated.timing(squash, { toValue: 0.84, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => {
        if (cancelled) return;
        Animated.parallel([
          Animated.timing(pos, { toValue: { x: nx, y: ny }, duration: air, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(arc, { toValue: -hopHeight, duration: air / 2, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(arc, { toValue: 0, duration: air / 2, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ]),
          // Stretch while rising, then back to normal before landing.
          Animated.sequence([
            Animated.timing(squash, { toValue: 1.1, duration: air * 0.35, useNativeDriver: true }),
            Animated.timing(squash, { toValue: 1, duration: air * 0.65, useNativeDriver: true }),
          ]),
        ]).start(({ finished }) => {
          if (!finished || cancelled) return;
          Animated.sequence([
            Animated.timing(squash, { toValue: 0.8, duration: 80, useNativeDriver: true }),
            Animated.timing(squash, { toValue: 1.07, duration: 110, useNativeDriver: true }),
            Animated.timing(squash, { toValue: 1, duration: 100, useNativeDriver: true }),
          ]).start(({ finished: bounced }) => {
            if (!bounced || cancelled) return;
            timer = setTimeout(hop, rand(500, 900)); // a short rest before the next jump
          });
        });
      });
    };
    hop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      pos.stopAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onHome, stage, reduced, area.w, area.h, size]);

  // Reduced motion: the mailbox simply sits at a fixed spot.
  useEffect(() => {
    if (reduced && area.w > 0 && stage === 'stopped') {
      pos.setValue({ x: Math.max(minX, area.w - size - EDGE), y: minY });
      placed.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, area.w, stage]);

  // If the screen changes size (rotation, resizing) while the mailbox is waiting, keep it inside the new bounds.
  useEffect(() => {
    if (area.w === 0 || !placed.current || stage === 'moving' || stage === 'viewer') return;
    const x = Math.min(Math.max(current.current.x, minX), maxX);
    const y = Math.min(Math.max(current.current.y, minY), maxY);
    if (x !== current.current.x || y !== current.current.y) pos.setValue({ x, y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.w, area.h, size]);

  // A soft pulse when the mailbox stops.
  useEffect(() => {
    if (stage !== 'stopped' || reduced) return;
    pulse.setValue(1);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.25, duration: 160, useNativeDriver: true }),
      Animated.spring(pulse, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [stage, reduced, pulse]);

  // The envelope sways gently while it waits to be opened.
  useEffect(() => {
    if (stage !== 'envelope' || reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(envelopeWobble, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(envelopeWobble, { toValue: -1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      envelopeWobble.setValue(0);
    };
  }, [stage, reduced, envelopeWobble]);

  // One tap stops the hopping at once. If it was in the air it drops straight down onto the spot below it
  // (a quick landing) and then stays completely still.
  function stopMailbox() {
    pos.stopAnimation((value) => pos.setValue(value));
    squash.stopAnimation(() => squash.setValue(1));
    arc.stopAnimation((height) => {
      if (height < -1) Animated.timing(arc, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
      else arc.setValue(0);
    });
    lastTap.current = 0; // the tap that stops it doesn't count toward the double-tap
    setStage('stopped');
  }

  function onMailboxPress() {
    if (stage === 'moving') {
      stopMailbox();
      return;
    }
    if (stage === 'stopped') {
      const now = Date.now();
      if (now - lastTap.current <= DOUBLE_TAP_MS) {
        lastTap.current = 0;
        setStage('envelope');
      } else {
        lastTap.current = now;
      }
    }
  }

  function onEnvelopePress() {
    const now = Date.now();
    if (now - lastTap.current <= DOUBLE_TAP_MS) {
      lastTap.current = 0;
      void openEnvelope();
    } else {
      lastTap.current = now;
    }
  }

  async function openEnvelope() {
    if (!active || busy.current) return;
    busy.current = true;
    const mail = active;
    const card = await openPendingMail(mail.id);
    busy.current = false;
    if (!card) return; // could not be saved: the mail stays pending, nothing is lost
    setOpened({ card, petLabel: labelFor(mail.petId) });
    setStage('viewer');
  }

  const envelopeW = Math.min(width - 2 * Spacing.four, 460, (height - 220) * ENVELOPE_ASPECT_RATIO);
  const stopped = stage === 'stopped';
  // Beside layout: the side with more room (left when the mailbox is in the right half).
  const extrasOnLeft = current.current.x + size / 2 > area.w / 2;
  const extrasSideStyle = extrasBeside
    ? { position: 'absolute' as const, top: Math.max(0, boxH / 2 - 30), width: 150, marginTop: 0, ...(extrasOnLeft ? { right: size + 4 } : { left: size + 4 }) }
    : null;

  return (
    <>
      {active && onHome && (stage === 'moving' || stage === 'stopped' || stage === 'envelope') ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          <Animated.View
            style={[styles.mailbox, { width: size, left: 0, top: 0, transform: [{ translateX: pos.x }, { translateY: Animated.add(pos.y, arc) }] }]}
            pointerEvents="box-none">
            <Pressable
              onPress={onMailboxPress}
              accessibilityRole="button"
              accessibilityLabel={stopped ? t('mbAriaStopped') : t('mbAriaMoving')}
              style={styles.hit}>
              <Animated.View
                style={{
                  transformOrigin: 'bottom',
                  transform: [
                    { scale: pulse },
                    { scaleY: squash },
                    { scaleX: squash.interpolate({ inputRange: [0.8, 1, 1.1], outputRange: [1.14, 1, 0.95] }) },
                  ],
                }}>
                {stopped ? <View style={[styles.glow, { width: size + 16, height: boxH + 16, borderRadius: (size + 16) / 2 }]} /> : null}
                <Image source={MAILBOX_ART} contentFit="contain" style={{ width: size, height: boxH }} />
              </Animated.View>
            </Pressable>
            {stopped ? (
              <View style={[styles.stopped, extrasSideStyle]}>
                <ThemedView type="backgroundElement" style={styles.bubble}>
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.bubbleText}>
                    {t('mbDoubleTap')}
                  </ThemedText>
                </ThemedView>
                <Pressable onPress={() => setStage('envelope')} accessibilityRole="button" accessibilityLabel={t('mbOpenMail')} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="accent" style={styles.openButton}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.whiteText}>
                      {t('mbOpenMail')}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </View>
            ) : null}
          </Animated.View>
        </View>
      ) : null}

      {/* Envelope: opened with a double-tap (or the Open button). Closing it keeps the mail waiting. */}
      <Modal visible={!!active && stage === 'envelope'} transparent animationType="fade" onRequestClose={() => setStage('stopped')}>
        <View style={styles.backdrop}>
          <View style={styles.envelopeWrap}>
            <ThemedText style={styles.envelopeTitle}>
              {active ? t('mbEnvelopeTitle', { pet: labelFor(active.petId) }) : ''}
            </ThemedText>
            <Pressable
              onPress={onEnvelopePress}
              accessibilityRole="button"
              accessibilityLabel={t('mbEnvelopeAria')}
              style={{ width: envelopeW, height: envelopeW / ENVELOPE_ASPECT_RATIO }}>
              <Animated.View
                style={{
                  width: '100%',
                  height: '100%',
                  transform: [{ rotate: envelopeWobble.interpolate({ inputRange: [-1, 1], outputRange: ['-2deg', '2deg'] }) }],
                }}>
                <Image source={ENVELOPE_ART} contentFit="contain" style={styles.fill} />
              </Animated.View>
            </Pressable>
            <ThemedText type="smallBold" style={styles.envelopeHint}>
              {t('mbEnvelopeHint')}
            </ThemedText>
            <View style={styles.envelopeButtons}>
              <Pressable onPress={() => void openEnvelope()} accessibilityRole="button" accessibilityLabel={t('mbOpen')} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="accent" style={styles.openButton}>
                  <ThemedText type="smallBold" style={styles.whiteText}>
                    {t('mbOpen')}
                  </ThemedText>
                </ThemedView>
              </Pressable>
              <Pressable onPress={() => setStage('stopped')} accessibilityRole="button" accessibilityLabel={t('mbLaterAria')} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundElement" style={styles.openButton}>
                  <ThemedText type="smallBold">{t('mbLater')}</ThemedText>
                </ThemedView>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <PostcardViewer
        card={stage === 'viewer' ? (opened?.card ?? null) : null}
        petLabel={opened?.petLabel ?? ''}
        onClose={() => {
          setOpened(null);
          setStage(reduced ? 'stopped' : 'moving');
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  mailbox: { position: 'absolute', alignItems: 'center', zIndex: 50 },
  hit: { padding: 6, cursor: 'pointer' },
  glow: {
    position: 'absolute',
    left: -8,
    top: -8,
    borderWidth: 3,
    borderColor: '#F28DAE',
    backgroundColor: 'rgba(255, 214, 232, 0.55)',
  },
  stopped: { alignItems: 'center', gap: Spacing.one, marginTop: Spacing.one, width: 160 },
  bubble: { paddingHorizontal: Spacing.two, paddingVertical: 4, borderRadius: Spacing.three },
  bubbleText: { fontSize: 12, lineHeight: 16 },
  openButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Spacing.five },
  whiteText: { color: '#FFFFFF' },
  pressed: { opacity: 0.7 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(60, 40, 70, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  envelopeWrap: { alignItems: 'center', gap: Spacing.two },
  envelopeTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  envelopeHint: { color: '#FFFFFF', textAlign: 'center' },
  envelopeButtons: { flexDirection: 'row', gap: Spacing.two },
  fill: { width: '100%', height: '100%' },
});
