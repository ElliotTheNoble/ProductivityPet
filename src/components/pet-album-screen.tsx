import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DetailEmptyState, DetailPageShell, DetailPanel, DetailTitleCard } from '@/components/detail-page-parts';
import { PetAvatar } from '@/components/pet-avatar';
import { ResurrectControl } from '@/components/resurrect-control';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePetFamily } from '@/hooks/use-pet-family';
import { useTheme } from '@/hooks/use-theme';
import { EVENT_LABELS, buildAlbumEntries, type PetAlbumEntry } from '@/utils/pet-album';
import { selectPet } from '@/utils/pet-family';
import { MEMORIAL_MESSAGE } from '@/utils/pet-life-messages';

// Pet Album pages — the overview grid of every kitty raised (living and passed
// away) and a detail page per kitty. All data comes from the pet family store
// (see @/utils/pet-album.ts), which keeps every pet and its history.

const ALBUM_BACKGROUND = '#EFE9FA'; // pastel lavender
const MEMORY_BACKGROUND = '#FCEEF1';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// "Born On" is the day the egg HATCHED (never the day the egg arrived). A pet
// that hasn't hatched yet says so; one whose hatch was never recorded says
// "Birth date unknown" instead of guessing.
function bornOnText(entry: PetAlbumEntry): string {
  const hatched = formatDate(entry.hatchedAt);
  if (hatched) return `Born On: ${hatched}`;
  if (entry.isEgg) return 'Born On: not hatched yet';
  return 'Birth date unknown';
}

// Eggs never wear accessories.
function accessoryIdsFor(entry: PetAlbumEntry): string[] {
  return entry.isEgg ? [] : entry.equippedAccessoryIds;
}

function statusText(entry: PetAlbumEntry): string {
  if (entry.lifeState === 'deceased') return '🌈 Passed away';
  if (entry.lifeState === 'critical') return '🚨 Critical';
  if (entry.lifeState === 'sick') return '🤒 Sick';
  return entry.isSelected ? '💚 Living · Selected' : '💚 Living';
}

function StatusBadge({ entry }: { entry: PetAlbumEntry }) {
  return (
    <ThemedView type={entry.isActive ? 'mint' : 'backgroundSelected'} style={styles.badge}>
      <ThemedText type="smallBold" style={styles.badgeText}>
        {statusText(entry)}
      </ThemedText>
    </ThemedView>
  );
}

function AlbumCard({ entry }: { entry: PetAlbumEntry }) {
  const theme = useTheme();
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/stats/lifetime/pets/[petId]', params: { petId: entry.id } })}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={`View ${entry.label}`}
      style={({ pressed }) => [
        styles.card,
        styles.cardInteractive,
        !entry.isActive && styles.cardDeceased,
        hovered && [styles.cardHovered, { borderColor: theme.accent }],
        pressed && styles.cardPressed,
      ]}>
      <View style={styles.cardAvatar}>
        <PetAvatar stage={entry.stage} equippedAccessoryIds={accessoryIdsFor(entry)} size={120} />
      </View>
      <ThemedText type="smallBold" style={styles.cardName}>
        {entry.label}
      </ThemedText>
      <StatusBadge entry={entry} />
      <View style={styles.cardFacts}>
        <ThemedText type="small" themeColor="textSecondary">
          Highest stage: <ThemedText type="smallBold">{entry.stage}</ThemedText>
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Highest level: <ThemedText type="smallBold">{entry.highestLevel}</ThemedText>
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {bornOnText(entry)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export function PetAlbumScreen() {
  const family = usePetFamily();
  const entries = family ? buildAlbumEntries(family) : null;
  return (
    <DetailPageShell>
      <DetailTitleCard
        icon={<ThemedText style={styles.titleEmoji}>🐾</ThemedText>}
        title="Pet Album"
        backgroundColor={ALBUM_BACKGROUND}
      />
      <DetailPanel title="📖 Every kitty you've raised">
        {entries === null ? null : entries.length === 0 ? (
          <DetailEmptyState
            icon={<ThemedText style={styles.titleEmoji}>🐱</ThemedText>}
            title="Your album is empty"
            text="Your kitty's story will appear here as soon as your pet profile is ready."
          />
        ) : (
          <View style={styles.grid}>
            {entries.map((entry) => (
              <AlbumCard key={entry.id} entry={entry} />
            ))}
          </View>
        )}
      </DetailPanel>
    </DetailPageShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.factLabel}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={styles.factValue}>
        {value}
      </ThemedText>
    </View>
  );
}

export function PetAlbumDetailScreen({ petId }: { petId: string }) {
  const family = usePetFamily();
  const entries = family ? buildAlbumEntries(family) : null;
  const entry = entries?.find((candidate) => candidate.id === petId) ?? null;

  const shellProps = { backHref: '/stats/lifetime/pets' as const, backLabel: '← Back to Pet Album' };

  if (entries === null) {
    return <DetailPageShell {...shellProps}>{null}</DetailPageShell>;
  }
  if (!entry) {
    return (
      <DetailPageShell {...shellProps}>
        <DetailPanel title="Pet not found">
          <DetailEmptyState
            icon={<ThemedText style={styles.titleEmoji}>🔍</ThemedText>}
            title="We couldn't find that kitty"
            text="Head back to the Pet Album to see everyone you've raised."
          />
        </DetailPanel>
      </DetailPageShell>
    );
  }

  const created = formatDate(entry.createdAt);
  const died = formatDate(entry.diedAt);

  return (
    <DetailPageShell {...shellProps}>
      <DetailTitleCard
        icon={<PetAvatar stage={entry.stage} equippedAccessoryIds={accessoryIdsFor(entry)} size={160} />}
        title={entry.label}
        backgroundColor={ALBUM_BACKGROUND}
      />

      <View style={styles.badgeRow}>
        <StatusBadge entry={entry} />
      </View>

      <DetailPanel title="✨ About this kitty">
        <Fact label="Highest stage reached" value={entry.stage} />
        <Fact label="Highest level" value={String(entry.highestLevel)} />
        <Fact label="Tasks completed while with you" value={String(entry.tasksCounted)} />
        <Fact label="Born On" value={bornOnText(entry).replace(/^Born On: /, '')} />
        <Fact label="Egg arrived" value={created ?? 'Not recorded'} />
        {entry.diedAt ? <Fact label="Passed away" value={died ?? 'Not recorded'} /> : null}
        {entry.resurrectionCount > 0 ? <Fact label="Times brought back" value={String(entry.resurrectionCount)} /> : null}
      </DetailPanel>

      <View style={[styles.memory, { backgroundColor: MEMORY_BACKGROUND }]}>
        <ThemedText style={styles.memoryText}>
          {entry.lifeState === 'deceased'
            ? `${MEMORIAL_MESSAGE} 🌈`
            : entry.lifeState === 'critical'
              ? 'This kitty is in critical condition and needs care right away. It is free — feed, bathe or play until all three needs are at 50 or more. 💗'
              : entry.lifeState === 'sick'
                ? "This kitty isn't feeling well. Caring for them (it's free) will help them recover. 💗"
                : 'This kitty is growing with you — every task you finish makes your story together a little bigger. 💗'}
        </ThemedText>
        {entry.lifeState === 'deceased' ? <ResurrectControl petId={entry.id} /> : null}
        {entry.isActive && !entry.isSelected ? (
          <Pressable onPress={() => selectPet(entry.id)} accessibilityRole="button" style={({ pressed }) => pressed && styles.cardPressed}>
            <ThemedView type="backgroundElement" style={[styles.switchButton, styles.cardInteractive]}>
              <ThemedText type="smallBold">Switch to this kitty</ThemedText>
            </ThemedView>
          </Pressable>
        ) : null}
      </View>

      <DetailPanel title="🕰️ History">
        {entry.events.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing recorded yet.
          </ThemedText>
        ) : (
          entry.events.map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <ThemedText type="smallBold">{EVENT_LABELS[event.type]}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDateTime(event.at)}
              </ThemedText>
            </View>
          ))
        )}
      </DetailPanel>
    </DetailPageShell>
  );
}

const styles = StyleSheet.create({
  titleEmoji: { fontSize: 48, lineHeight: 56 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, justifyContent: 'center' },
  card: {
    width: 220,
    alignItems: 'center',
    gap: Spacing.one,
    padding: Spacing.three - 2,
    borderRadius: Spacing.four,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    backgroundColor: ALBUM_BACKGROUND,
  },
  cardDeceased: { opacity: 0.85 },
  // Same hover/press treatment as the Stats category cards.
  cardInteractive: {
    cursor: 'pointer',
    transitionProperty: 'transform, border-color, box-shadow',
    transitionDuration: '160ms',
  },
  cardHovered: {
    transform: [{ scale: 1.03 }, { translateY: -3 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  cardPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  // Fixed box so a Young kitty (drawn slightly larger than her box) and any
  // accessory near her edge don't push neighbouring content around.
  cardAvatar: { width: 150, height: 140, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 17, lineHeight: 22 },
  cardFacts: { alignItems: 'center', gap: 2, marginTop: Spacing.one },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Spacing.five },
  badgeText: { fontSize: 12, lineHeight: 18 },
  badgeRow: { alignItems: 'center' },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three, paddingVertical: 2 },
  factLabel: { flexShrink: 1 },
  factValue: { textAlign: 'right', flexShrink: 1 },
  memory: {
    padding: Spacing.four,
    borderRadius: Spacing.five,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    alignItems: 'center',
    gap: Spacing.three,
  },
  memoryText: { fontSize: 17, lineHeight: 26, textAlign: 'center' },
  switchButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.five },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.one,
    borderBottomWidth: 1,
    borderColor: 'rgba(150, 130, 160, 0.2)',
  },
});
