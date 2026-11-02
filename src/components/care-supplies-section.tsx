import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PawTokenCoin } from '@/components/paw-token-coin';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { trName, useT } from '@/i18n';
import { usePetFamily } from '@/hooks/use-pet-family';
import {
  MEDICINE_NEED_BOOST,
  MEDICINE_PRICE,
  WASHCLOTH_PRICE,
} from '@/utils/pet-family-config';
import {
  buyCareSupply,
  getCareSupplies,
  getSelectedPet,
  giveMedicine,
  type CareSupplyKind,
  type CareSupplyResult,
} from '@/utils/pet-family';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Shop -> "Pet Care Supplies": two consumables that live in a persistent inventory (see
// @/utils/pet-family.ts). Temporary Ionicons stand in for artwork. Buying is allowed for Healthy,
// Sick and Critical pets (never a passed-away one); Pet Medicine can be given to a Sick or
// Critical, hatched pet; a Gentle Washcloth is used up by a COMPLETED Bathroom wipe-down.
const ITEMS: {
  kind: CareSupplyKind;
  name: string;
  icon: IconName;
  price: number;
  descKey: 'careWashclothDesc' | 'careMedicineDesc';
  tint: string;
  border: string;
}[] = [
  {
    kind: 'washcloth',
    name: 'Gentle Washcloth',
    icon: 'water',
    price: WASHCLOTH_PRICE,
    descKey: 'careWashclothDesc',
    tint: '#D8EEF9',
    border: '#8CC8E6',
  },
  {
    kind: 'medicine',
    name: 'Pet Medicine',
    icon: 'medkit',
    price: MEDICINE_PRICE,
    descKey: 'careMedicineDesc',
    tint: '#FBD9E6',
    border: '#F28DAE',
  },
];

// The message is chosen as a KEY (not text) so the shown message follows the language if it changes.
type CareMessageKey =
  | 'careBoughtWashcloth'
  | 'careBoughtMedicine'
  | 'careGivenMedicine'
  | 'careNotEnough'
  | 'carePaused'
  | 'careNoneLeft'
  | 'careNotNeeded'
  | 'careFailed';

function messageFor(kind: CareSupplyKind, result: CareSupplyResult, action: 'buy' | 'use'): CareMessageKey {
  if (result.ok) {
    if (action === 'buy') return kind === 'washcloth' ? 'careBoughtWashcloth' : 'careBoughtMedicine';
    return 'careGivenMedicine';
  }
  switch (result.reason) {
    case 'insufficient':
      return 'careNotEnough';
    case 'deceased':
      return 'carePaused';
    case 'none-left':
      return 'careNoneLeft';
    case 'not-needed':
      return 'careNotNeeded';
    default:
      return 'careFailed';
  }
}

export function CareSuppliesSection() {
  const { t } = useT();
  const family = usePetFamily();
  const [message, setMessage] = useState<CareMessageKey | null>(null);
  // Which card the mouse is over (web); touch devices get pressed feedback instead.
  const [hoveredKind, setHoveredKind] = useState<CareSupplyKind | null>(null);
  const [pressedKind, setPressedKind] = useState<CareSupplyKind | null>(null);
  // Which action button the mouse is over (web); only enabled buttons highlight.
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);
  if (!family) return null;

  const pet = getSelectedPet(family);
  const supplies = getCareSupplies(family);
  const deceased = pet.lifecycle.state === 'deceased';
  const ill = pet.lifecycle.state === 'sick' || pet.lifecycle.state === 'critical';

  return (
    <View style={styles.wrap}>
      <ThemedText type="smallBold" style={styles.title}>
        {t('careTitle')}
      </ThemedText>
      <View style={styles.row}>
        {ITEMS.map((item) => {
          const owned = supplies[item.kind];
          const canAfford = family.wallet.pawTokens >= item.price;
          const buyDisabled = deceased;
          const canUseMedicine = item.kind === 'medicine' && ill && owned > 0;
          return (
            <Pressable
              key={item.kind}
              // The card itself has no action (its buttons do); this wrapper only gives the same gentle
              // hover lift as the other Shop items, and pressed feedback on touch.
              accessible={false}
              onHoverIn={() => setHoveredKind(item.kind)}
              onHoverOut={() => setHoveredKind(null)}
              onPressIn={() => setPressedKind(item.kind)}
              onPressOut={() => setPressedKind(null)}
              style={styles.cardWrap}>
            <ThemedView
              type="backgroundElementOverlay"
              style={[
                styles.card,
                hoveredKind === item.kind && [styles.cardHovered, { borderColor: item.border }],
                pressedKind === item.kind && styles.cardPressed,
              ]}>
              <View style={[styles.iconCircle, { backgroundColor: item.tint }]}>
                <Ionicons name={item.icon} size={26} color="#6B4A5A" />
              </View>
              <ThemedText type="smallBold">{trName(item.name)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
                {t(item.descKey, { boost: MEDICINE_NEED_BOOST })}
              </ThemedText>
              <ThemedText type="smallBold" accessibilityLabel={t('careOwnLabel', { n: owned })}>
                {t('careOwn', { n: owned })}
              </ThemedText>
              <Pressable
                disabled={buyDisabled}
                onHoverIn={() => setHoveredButton(`buy-${item.kind}`)}
                onHoverOut={() => setHoveredButton(null)}
                onPress={() => setMessage(messageFor(item.kind, buyCareSupply(item.kind), 'buy'))}
                accessibilityRole="button"
                accessibilityLabel={t('careBuyLabel', { name: trName(item.name), price: item.price })}
                style={({ pressed }) => [pressed && styles.pressed, buyDisabled && styles.disabled]}>
                <ThemedView
                  type="accent"
                  style={[styles.button, hoveredButton === `buy-${item.kind}` && !buyDisabled && styles.buttonHover]}>
                  <PawTokenCoin size={16} />
                  <ThemedText type="smallBold" style={styles.buttonText}>
                    {`${t('shopBuy')} ${item.price}`}
                  </ThemedText>
                </ThemedView>
              </Pressable>
              {!canAfford && !buyDisabled ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('careNeedMore', { n: item.price - family.wallet.pawTokens })}
                </ThemedText>
              ) : null}
              {item.kind === 'medicine' ? (
                <Pressable
                  disabled={!canUseMedicine}
                  onHoverIn={() => setHoveredButton('give-medicine')}
                  onHoverOut={() => setHoveredButton(null)}
                  onPress={() => setMessage(messageFor('medicine', giveMedicine(pet.id), 'use'))}
                  accessibilityRole="button"
                  accessibilityLabel={t('careGiveLabel')}
                  style={({ pressed }) => [pressed && styles.pressed, !canUseMedicine && styles.disabled]}>
                  <ThemedView
                    type="mint"
                    style={[styles.button, hoveredButton === 'give-medicine' && canUseMedicine && styles.buttonHover]}>
                    <ThemedText type="smallBold">{t('careGiveTo', { name: pet.name ?? t('careGiveToHer') })}</ThemedText>
                  </ThemedView>
                </Pressable>
              ) : null}
            </ThemedView>
            </Pressable>
          );
        })}
      </View>
      {deceased ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('careResting')}
        </ThemedText>
      ) : null}
      {message ? (
        <ThemedText type="smallBold" accessibilityRole="alert">
          {t(message)}
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
  title: { fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  // Two cards side by side where there is room; stacked one per row on a narrow phone.
  cardWrap: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 0,
  },
  card: {
    width: '100%',
    borderWidth: 2,
    borderColor: 'transparent',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one + 2,
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: { lineHeight: 18 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Spacing.five,
  },
  buttonText: { color: '#FFFFFF' },
  // Same gentle lift as the cards, on the enabled action buttons only.
  buttonHover: {
    transform: [{ scale: 1.06 }, { translateY: -2 }],
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  // Same gentle lift as the other Shop cards (see shop-screen's cardHovered).
  cardHovered: {
    transform: [{ scale: 1.03 }, { translateY: -3 }],
    backgroundColor: 'rgba(255, 238, 245, 0.98)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  cardPressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
