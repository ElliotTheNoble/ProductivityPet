import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';
import { stageLabel } from '@/utils/pet-stage';

import { HoverPressable as Pressable } from '@/components/hover-pressable';

import { DetailPanel } from '@/components/detail-page-parts';
import { formatDate, PetPostcards, speciesLabel } from '@/components/pawadise-postcard-views';
import { PetAvatar } from '@/components/pet-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { PetAlbumEntry } from '@/utils/pet-album';

// One pet's Pawadise adventure page, shown INSIDE the Pet Album's Pet Pawadise tab when a retired pet is
// chosen: its artwork, name, species, growth stage and its own postcards (only this pet's).
const PAGE_CARD = '#E4F4F1';

export function PawadisePetPage({ entry, onBack }: { entry: PetAlbumEntry; onBack: () => void }) {
  const { t } = useT();
  const since = formatDate(entry.retiredAt);
  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack} accessibilityRole="button" style={({ pressed }) => [styles.backWrap, pressed && styles.pressed]}>
        <ThemedView type="backgroundElement" style={styles.backButton}>
          <ThemedText type="smallBold">{t('pwBackTo')}</ThemedText>
        </ThemedView>
      </Pressable>

      <View style={[styles.hero, { backgroundColor: PAGE_CARD }]}>
        <View style={styles.avatar}>
          <PetAvatar stage={entry.stage} equippedAccessoryIds={entry.isEgg ? [] : entry.equippedAccessoryIds} size={150} />
        </View>
        <View style={styles.heroText}>
          <ThemedText style={styles.name}>{entry.label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t('pwSpecies', { species: speciesLabel(entry.species) })}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t('pwGrowth', { stage: stageLabel(entry.stage) })}</ThemedText>
          <ThemedText type="smallBold">
            {entry.isRetired ? (since ? t('pwRelaxingSince', { date: since }) : t('pwRelaxing')) : t('pwHomeAgain')}
          </ThemedText>
        </View>
      </View>

      <DetailPanel title={t('pwPostcardsTitle')}>
        <PetPostcards petId={entry.id} petLabel={entry.label} />
      </DetailPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  backWrap: { alignSelf: 'flex-start' },
  backButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.five },
  hero: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  avatar: { width: 170, height: 160, alignItems: 'center', justifyContent: 'center' },
  heroText: { gap: 4, alignItems: 'flex-start', flexShrink: 1, minWidth: 180 },
  name: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
