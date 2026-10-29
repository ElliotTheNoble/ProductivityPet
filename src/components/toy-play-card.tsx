import { StyleSheet, View } from 'react-native';

import { SpriteCrop } from '@/components/sprite-crop';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePetFamily } from '@/hooks/use-pet-family';
import { getSelectedPet, getToyCounts, isPetHatched } from '@/utils/pet-family';
import { useToySession } from '@/utils/pet-toy-session';
import { getToy, getToyArtFor, TOY_SPECIES } from '@/utils/toys/toy-catalog';

// Home Features -> Toys: the player's toy inventory (counts only). Toys are played from their Shop cards,
// so there are no play controls duplicated here. Hidden for a pet that has passed away or is still an egg.
export function ToyPlayCard() {
  const family = usePetFamily();
  const pet = family ? getSelectedPet(family) : null;
  const session = useToySession(pet?.id);
  if (!family || !pet) return null;
  if (pet.lifecycle.state === 'deceased' || !isPetHatched(pet)) return null;

  const counts = getToyCounts(family);
  const owned = TOY_SPECIES.flatMap((s) => s.toys).filter((t) => (counts[t.id] ?? 0) > 0);
  const playingToy = session ? getToy(session.toyId) : undefined;

  return (
    <ThemedView type="backgroundElementOverlay" style={styles.card}>
      <ThemedText type="smallBold">Toys</ThemedText>
      {owned.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No toys yet — buy one in the Shop with Paw Tokens.
        </ThemedText>
      ) : (
        <>
          {owned.map((toy) => {
            const art = getToyArtFor(toy);
            return (
              <View key={toy.id} style={styles.row}>
                {art ? <SpriteCrop {...art} size={44} /> : null}
                <View style={styles.info}>
                  <ThemedText type="smallBold">{toy.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {`You own: ${counts[toy.id]}`}
                  </ThemedText>
                </View>
              </View>
            );
          })}
          <ThemedText type="small" themeColor="textSecondary">
            Play toys from their cards in the Shop.
          </ThemedText>
        </>
      )}
      {playingToy ? (
        <ThemedText type="small" themeColor="textSecondary">
          {`${playingToy.name} is out to play…`}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  info: { flex: 1, minWidth: 0 },
});
