import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PawTokenCoin } from '@/components/paw-token-coin';
import { SpriteCrop } from '@/components/sprite-crop';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { tr, trName, useT } from '@/i18n';
import { usePetFamily } from '@/hooks/use-pet-family';
import {
  buyToy,
  getSelectedPet,
  getToyCounts,
  isPetHatched,
  playWithToy,
  type ToyResult,
} from '@/utils/pet-family';
import { useToySession } from '@/utils/pet-toy-session';
import { getToyArtFor, TOY_SPECIES, type ToyDef } from '@/utils/toys/toy-catalog';

const ART_SIZE = 96;

export function toyMessage(result: ToyResult, action: 'buy' | 'play', toy: ToyDef): string {
  if (result.ok) {
    return action === 'buy'
      ? tr('toyBought', { name: trName(toy.name) })
      : tr('toyPlaying', { name: trName(toy.name), happy: toy.happiness });
  }
  switch (result.reason) {
    case 'insufficient':
      return tr('toyNotEnough');
    case 'deceased':
      return tr('toyPaused');
    case 'egg':
      return tr('toyEgg');
    case 'none-left':
      return tr('toyNoneLeft');
    case 'busy':
      return tr('toyBusy');
    default:
      return tr('toyFailed');
  }
}

// Shop -> Toys: one block per pet species (see @/utils/toys/toy-catalog.ts). Toys are consumable (one
// short note per section says so, not every card); buying works for Healthy, Sick and Critical pets (never a passed-away one), and a toy is
// played with from here or from Home's Home Features panel.
export function ToyShopSection() {
  const family = usePetFamily();
  const { t } = useT();
  // The last result is kept (not its text), so the message follows the language if it changes.
  const [last, setLast] = useState<{ result: ToyResult; action: 'buy' | 'play'; toy: ToyDef } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);
  const pet = family ? getSelectedPet(family) : null;
  const session = useToySession(pet?.id);
  if (!family || !pet) return null;

  const counts = getToyCounts(family);
  const deceased = pet.lifecycle.state === 'deceased';
  const hatched = isPetHatched(pet);
  const playing = !!session;

  return (
    <View style={styles.wrap}>
      {TOY_SPECIES.map((species) => (
        <View key={species.id} style={styles.species}>
          <ThemedText type="smallBold" style={styles.title}>
            {trName(species.label)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('toyIntro')}
          </ThemedText>
          <View style={styles.row}>
            {species.toys.map((toy) => {
              const art = getToyArtFor(toy);
              const owned = counts[toy.id] ?? 0;
              const canPlay = owned > 0 && !deceased && hatched && !playing;
              return (
                <Pressable
                  key={toy.id}
                  accessible={false}
                  onHoverIn={() => setHoveredId(toy.id)}
                  onHoverOut={() => setHoveredId(null)}
                  style={styles.cardWrap}>
                  <ThemedView
                    type="backgroundElementOverlay"
                    style={[styles.card, hoveredId === toy.id && styles.cardHovered]}>
                    <View style={styles.art}>
                      {art ? <SpriteCrop {...art} size={ART_SIZE} /> : null}
                    </View>
                    <ThemedText type="smallBold">{trName(toy.name)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('toyHappiness', { happy: toy.happiness })}
                    </ThemedText>
                    <ThemedText type="smallBold" accessibilityLabel={t('careOwnLabel', { n: owned })}>
                      {t('toyYouOwn', { n: owned })}
                    </ThemedText>
                    {/* Buy and Play side by side (wrapping only if a card is too narrow for both). */}
                    <View style={styles.buttonRow}>
                    <Pressable
                      disabled={deceased}
                      onHoverIn={() => setHoveredButton(`buy-${toy.id}`)}
                      onHoverOut={() => setHoveredButton(null)}
                      onPress={() => setLast({ result: buyToy(toy.id), action: 'buy', toy })}
                      accessibilityRole="button"
                      accessibilityLabel={t('toyBuyLabel', { name: trName(toy.name), price: toy.price })}
                      style={({ pressed }) => [styles.btnWrap, pressed && styles.pressed, deceased && styles.disabled]}>
                      <ThemedView
                        type="accent"
                        style={[styles.button, hoveredButton === `buy-${toy.id}` && !deceased && styles.buttonHover]}>
                        <PawTokenCoin size={16} />
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.buttonText}>
                          {`${toy.price}`}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                    <Pressable
                      disabled={!canPlay}
                      onHoverIn={() => setHoveredButton(`play-${toy.id}`)}
                      onHoverOut={() => setHoveredButton(null)}
                      onPress={() => setLast({ result: playWithToy(pet.id, toy.id), action: 'play', toy })}
                      accessibilityRole="button"
                      accessibilityLabel={t('toyPlayLabel', { name: trName(toy.name) })}
                      style={({ pressed }) => [styles.btnWrap, pressed && styles.pressed, !canPlay && styles.disabled]}>
                      <ThemedView
                        type="mint"
                        style={[styles.button, hoveredButton === `play-${toy.id}` && canPlay && styles.buttonHover]}>
                        <ThemedText type="smallBold">{t('toyPlay')}</ThemedText>
                      </ThemedView>
                    </Pressable>
                    </View>
                  </ThemedView>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {deceased ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('toyRestingNote')}
        </ThemedText>
      ) : !hatched ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('toyEggNote')}
        </ThemedText>
      ) : null}
      {last ? (
        <ThemedText type="smallBold" accessibilityRole="alert">
          {toyMessage(last.result, last.action, last.toy)}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    marginVertical: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  species: { gap: Spacing.two },
  title: { fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  cardWrap: { flexGrow: 1, flexBasis: 160, minWidth: 0 },
  card: {
    width: '100%',
    borderWidth: 2,
    borderColor: 'transparent',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one + 2,
    alignItems: 'flex-start',
  },
  art: { width: ART_SIZE, height: ART_SIZE, alignItems: 'center', justifyContent: 'center' },
  // Buy and Play ALWAYS share one row (portrait, landscape, desktop): no wrapping, and each button may
  // shrink a little instead of dropping to a second line (e.g. a narrow card or a large phone font).
  buttonRow: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', alignSelf: 'stretch', gap: Spacing.two },
  btnWrap: { flexShrink: 1, minWidth: 0 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    // Compact so a Paw Token price (the coin + number, no "Buy" word) is never clipped on a narrow card.
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.one + 2,
    borderRadius: Spacing.five,
  },
  buttonText: { color: '#FFFFFF' },
  buttonHover: {
    transform: [{ scale: 1.06 }, { translateY: -2 }],
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  cardHovered: {
    transform: [{ scale: 1.03 }, { translateY: -3 }],
    backgroundColor: 'rgba(255, 238, 245, 0.98)',
    borderColor: '#F28DAE',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
