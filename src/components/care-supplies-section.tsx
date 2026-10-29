import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PawTokenCoin } from '@/components/paw-token-coin';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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
  description: string;
  tint: string;
  border: string;
}[] = [
  {
    kind: 'washcloth',
    name: 'Gentle Washcloth',
    icon: 'water',
    price: WASHCLOTH_PRICE,
    description: 'Used up by one completed Gentle Wipe-Down in the Bathroom: +25 Cleanliness for a Sick or Critical pet.',
    tint: '#D8EEF9',
    border: '#8CC8E6',
  },
  {
    kind: 'medicine',
    name: 'Pet Medicine',
    icon: 'medkit',
    price: MEDICINE_PRICE,
    description: `Gives a Sick or Critical pet +${MEDICINE_NEED_BOOST} Hunger and +${MEDICINE_NEED_BOOST} Happiness. It doesn't cure by itself — she recovers once Hunger, Cleanliness and Happiness are all 50 or more.`,
    tint: '#FBD9E6',
    border: '#F28DAE',
  },
];

function messageFor(kind: CareSupplyKind, result: CareSupplyResult, action: 'buy' | 'use'): string {
  if (result.ok) {
    if (action === 'buy') return kind === 'washcloth' ? 'Bought a Gentle Washcloth!' : 'Bought Pet Medicine!';
    return 'Medicine given. She feels a little better.';
  }
  switch (result.reason) {
    case 'insufficient':
      return 'Not enough Paw Tokens yet. Complete your tasks to earn more!';
    case 'deceased':
      return 'Supplies are paused while your pet is resting in memory.';
    case 'none-left':
      return 'You have none left.';
    case 'not-needed':
      return 'Medicine is only for a Sick or Critical pet that has hatched.';
    default:
      return 'That did not work. Please try again.';
  }
}

export function CareSuppliesSection() {
  const family = usePetFamily();
  const [message, setMessage] = useState<string | null>(null);
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
        Pet Care Supplies
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
              <ThemedText type="smallBold">{item.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
                {item.description}
              </ThemedText>
              <ThemedText type="smallBold" accessibilityLabel={`You own ${owned}`}>
                {`You own: ${owned}`}
              </ThemedText>
              <Pressable
                disabled={buyDisabled}
                onHoverIn={() => setHoveredButton(`buy-${item.kind}`)}
                onHoverOut={() => setHoveredButton(null)}
                onPress={() => setMessage(messageFor(item.kind, buyCareSupply(item.kind), 'buy'))}
                accessibilityRole="button"
                accessibilityLabel={`Buy ${item.name} for ${item.price} Paw Tokens`}
                style={({ pressed }) => [pressed && styles.pressed, buyDisabled && styles.disabled]}>
                <ThemedView
                  type="accent"
                  style={[styles.button, hoveredButton === `buy-${item.kind}` && !buyDisabled && styles.buttonHover]}>
                  <PawTokenCoin size={16} />
                  <ThemedText type="smallBold" style={styles.buttonText}>
                    {`Buy ${item.price}`}
                  </ThemedText>
                </ThemedView>
              </Pressable>
              {!canAfford && !buyDisabled ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Need {item.price - family.wallet.pawTokens} more Paw Tokens — complete your tasks to earn them!
                </ThemedText>
              ) : null}
              {item.kind === 'medicine' ? (
                <Pressable
                  disabled={!canUseMedicine}
                  onHoverIn={() => setHoveredButton('give-medicine')}
                  onHoverOut={() => setHoveredButton(null)}
                  onPress={() => setMessage(messageFor('medicine', giveMedicine(pet.id), 'use'))}
                  accessibilityRole="button"
                  accessibilityLabel="Give Pet Medicine to the selected pet"
                  style={({ pressed }) => [pressed && styles.pressed, !canUseMedicine && styles.disabled]}>
                  <ThemedView
                    type="mint"
                    style={[styles.button, hoveredButton === 'give-medicine' && canUseMedicine && styles.buttonHover]}>
                    <ThemedText type="smallBold">Give to {pet.name ?? 'her'}</ThemedText>
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
          Supplies can't be bought or used while your pet is resting in memory. Resurrect her from the memorial card
          on Home to care for her again.
        </ThemedText>
      ) : null}
      {message ? (
        <ThemedText type="smallBold" accessibilityRole="alert">
          {message}
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
