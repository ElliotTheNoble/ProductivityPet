import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { DetailEmptyState } from '@/components/detail-page-parts';
import { SpriteCrop } from '@/components/sprite-crop';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { getPostcardDesign, type PostcardDesign, type PostcardRegion } from '@/utils/pawadise-art';
import { sortPostcards, usePawadisePostcards, type PawadisePostcard } from '@/utils/pawadise-postcards';

// A pet's Pawadise scrapbook: ONLY the postcards whose petId is this pet's unique id (never another
// pet's), newest first, read from the permanent postcard collection (@/utils/pawadise-postcards.ts).
// Nothing is created here: with no postcards it shows an empty state, never placeholder entries. The same
// component is used on the pet's Pawadise page and on its Pet Album profile, so the scrapbook is the
// same wherever the pet is (retired or home) and keeps growing if the pet retires again.

const SPECIES_LABELS: Record<string, string> = { cat: 'Cat' };
const POSTCARD_BACKGROUND = '#FFF4E3';

export function speciesLabel(species: string): string {
  return SPECIES_LABELS[species] ?? species.charAt(0).toUpperCase() + species.slice(1);
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function Side({ design, region, width, height }: { design: PostcardDesign; region: PostcardRegion; width: number; height: number }) {
  return (
    <SpriteCrop
      source={design.source}
      sheetWidth={design.sheetWidth}
      sheetHeight={design.sheetHeight}
      cropX={region.x}
      cropY={region.y}
      cropWidth={region.width}
      cropHeight={region.height}
      width={width}
      height={height}
    />
  );
}

// The two-sided postcard viewer. It shows ONE side at a time (the front first); swiping or mouse-dragging
// left or right turns it over, and so does the labelled "Flip" button (the accessible alternative). Each
// side is a crop of the player's original picture, so neither side shows the other.
export function PostcardViewer({
  card,
  petLabel,
  onClose,
}: {
  card: PawadisePostcard | null;
  petLabel: string;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [side, setSide] = useState<'front' | 'back'>('front');
  const scaleX = useRef(new Animated.Value(1)).current;
  const flipping = useRef(false);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const sideRef = useRef(side);
  sideRef.current = side;

  // Every newly opened postcard starts on its front.
  const cardId = card?.id ?? null;
  useEffect(() => {
    setSide('front');
    scaleX.setValue(1);
    flipping.current = false;
  }, [cardId, scaleX]);

  const flipRef = useRef<() => void>(() => {});
  flipRef.current = () => {
    if (flipping.current) return;
    const toggle = () => setSide((s) => (s === 'front' ? 'back' : 'front'));
    if (reducedRef.current) {
      toggle();
      return;
    }
    flipping.current = true;
    Animated.timing(scaleX, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      toggle();
      Animated.timing(scaleX, { toValue: 1, duration: 140, useNativeDriver: true }).start(() => {
        flipping.current = false;
      });
    });
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) > 40) flipRef.current();
      },
    })
  ).current;

  const design = card ? getPostcardDesign(card.image) : null;
  // One box for both sides, from the front's real proportions, so the card never changes size when turned.
  const aspect = design ? design.front.width / design.front.height : 1;
  // A short (landscape) window puts the card on the left and the title/buttons beside it, so the postcard
  // can stay large; a tall one stacks everything.
  const compact = height < 520;
  const maxW = compact ? Math.min(width - 300, 620) : Math.min(width - 4 * Spacing.three, 620);
  const maxH = compact ? Math.max(160, height - 3 * Spacing.four) : Math.max(160, height - 250);
  const boxW = Math.min(maxW, maxH * aspect);
  const boxH = boxW / aspect;

  const cardNode = design ? (
    <View style={[styles.cardBox, { width: boxW, height: boxH }]} {...pan.panHandlers}>
      {/* pointerEvents none: the picture itself must not be mouse-draggable by the browser, or that would cancel the swipe. */}
      <Animated.View pointerEvents="none" style={{ width: boxW, height: boxH, transform: [{ scaleX }] }}>
        <Side design={design} region={side === 'front' ? design.front : design.back} width={boxW} height={boxH} />
      </Animated.View>
    </View>
  ) : (
    <View style={styles.plainCard}>
      <ThemedText style={styles.sheetMessage}>{card?.message || 'A postcard from Pawadise. 💌'}</ThemedText>
    </View>
  );

  const infoNode = (
    <View style={compact ? styles.sideColumn : styles.column}>
      <ThemedText style={styles.sheetTitle}>{card?.title ?? 'Postcard'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
        {`From ${petLabel}${card && formatDate(card.receivedAt) ? ` · ${formatDate(card.receivedAt)}` : ''}`}
      </ThemedText>
      {compact ? null : cardNode}
      {design ? (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            {`${side === 'front' ? 'Front' : 'Back'} · Swipe to flip`}
          </ThemedText>
          <View style={styles.buttons}>
            <Pressable
              onPress={() => flipRef.current()}
              accessibilityRole="button"
              accessibilityLabel={side === 'front' ? 'Flip postcard to see the back' : 'Flip postcard to see the front'}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="mint" style={styles.button}>
                <ThemedText type="smallBold">Flip</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close postcard" style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={styles.button}>
                <ThemedText type="smallBold">Close</ThemedText>
              </ThemedView>
            </Pressable>
          </View>
        </>
      ) : (
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.pressedWrap}>
          <ThemedView type="backgroundElement" style={styles.button}>
            <ThemedText type="smallBold">Close</ThemedText>
          </ThemedView>
        </Pressable>
      )}
    </View>
  );

  return (
    <Modal visible={card !== null} transparent animationType="fade" onRequestClose={onClose}>
      {/* The dim area is a SIBLING behind the sheet (not its parent), so the sheet's swipe gesture isn't fought over by a parent button. */}
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close postcard" />
        <View style={styles.sheetWrap}>
          <ThemedView type="background" style={[styles.sheet, compact && styles.sheetRow]}>
            {compact ? cardNode : null}
            {infoNode}
          </ThemedView>
        </View>
      </View>
    </Modal>
  );
}

export function PetPostcards({ petId, petLabel }: { petId: string; petLabel: string }) {
  const all = usePawadisePostcards();
  const [open, setOpen] = useState<PawadisePostcard | null>(null);
  const cards = all ? sortPostcards(all.filter((c) => c.petId === petId)) : [];

  if (cards.length === 0) {
    return (
      <DetailEmptyState
        icon={<ThemedText style={styles.emptyEmoji}>💌</ThemedText>}
        title="No postcards yet!"
        text={`${petLabel}'s adventures are just beginning. Every postcard they send will be kept here forever.`}
      />
    );
  }

  return (
    <View style={styles.list}>
      {cards.map((card) => {
        const design = getPostcardDesign(card.image);
        return (
          <Pressable
            key={card.id}
            onPress={() => setOpen(card)}
            accessibilityRole="button"
            accessibilityLabel={`Open postcard: ${card.title}`}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <View style={styles.thumb}>
              {design ? (
                <SpriteCrop
                  source={design.source}
                  sheetWidth={design.sheetWidth}
                  sheetHeight={design.sheetHeight}
                  cropX={design.front.x}
                  cropY={design.front.y}
                  cropWidth={design.front.width}
                  cropHeight={design.front.height}
                  size={76}
                />
              ) : (
                <ThemedText style={styles.noPictureSmall}>💌</ThemedText>
              )}
            </View>
            <View style={styles.cardText}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {card.title}
              </ThemedText>
              {card.message ? (
                <ThemedText type="small" numberOfLines={2}>
                  {card.message}
                </ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                {formatDate(card.receivedAt) ?? ''}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
      <PostcardViewer card={open} petLabel={petLabel} onClose={() => setOpen(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyEmoji: { fontSize: 40, lineHeight: 48 },
  list: { gap: Spacing.two },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Spacing.three,
    backgroundColor: POSTCARD_BACKGROUND,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    cursor: 'pointer',
  },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  thumb: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  noPictureSmall: { fontSize: 32, lineHeight: 40 },
  pressed: { opacity: 0.75 },
  pressedWrap: { alignSelf: 'center' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(60, 40, 70, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  sheetWrap: { width: '100%', maxWidth: 700, alignItems: 'center' },
  sheet: {
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two,
    alignItems: 'center',
    maxWidth: '100%',
  },
  column: { alignItems: 'center', gap: Spacing.two },
  sideColumn: { alignItems: 'center', gap: Spacing.two, width: 200 },
  centerText: { textAlign: 'center' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  sheetTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800', textAlign: 'center' },
  sheetMessage: { fontSize: 17, lineHeight: 26, textAlign: 'center' },
  plainCard: { padding: Spacing.four, borderRadius: Spacing.three, backgroundColor: POSTCARD_BACKGROUND },
  cardBox: { alignItems: 'center', justifyContent: 'center' },
  hint: { textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center' },
  button: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: Spacing.five },
});
