import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  MEMORY_MATCH_DIFFICULTIES,
  MEMORY_MATCH_DIFFICULTY_INFO,
  type MemoryMatchDifficulty,
} from '@/utils/memory-match';

type MemoryMatchDifficultySelectProps = {
  bestMoves: Partial<Record<MemoryMatchDifficulty, number>>;
  onSelect: (difficulty: MemoryMatchDifficulty) => void;
  onExit: () => void;
};

// Shown once, before a Kitty Memory Match round starts (see
// memory-match-game.tsx's 'select' phase) — purely a picker, no game
// state of its own. Visually matches the Mini-Games hub's own card style
// (ThemedView backgroundElementOverlay, rounded + bordered) so this reads
// as part of the same app, while the pastel-per-card coloring gives
// Memory Match its own identity within that.
export function MemoryMatchDifficultySelect({ bestMoves, onSelect, onExit }: MemoryMatchDifficultySelectProps) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper}>
      <ThemedText type="title" style={styles.heading}>
        Kitty Memory Match
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
        Choose a difficulty to begin!
      </ThemedText>

      <View style={styles.grid}>
        {MEMORY_MATCH_DIFFICULTIES.map((difficulty) => {
          const info = MEMORY_MATCH_DIFFICULTY_INFO[difficulty];
          const best = bestMoves[difficulty];
          return (
            <Pressable key={difficulty} onPress={() => onSelect(difficulty)} style={styles.cardPressable}>
              <ThemedView
                type="backgroundElementOverlay"
                style={[styles.card, { borderColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold" style={styles.cardName}>
                  {info.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.cardSubtext}>
                  {info.pairs} Pairs • {info.pairs * 2} Cards
                </ThemedText>
                {best !== undefined ? (
                  <ThemedView type="mint" style={styles.bestBadge}>
                    <ThemedText type="small" style={styles.bestBadgeText}>
                      Best: {best} moves
                    </ThemedText>
                  </ThemedView>
                ) : null}
              </ThemedView>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={onExit} style={styles.exitPressable}>
        <ThemedText type="small" themeColor="textSecondary">
          ← Back to Mini-Games
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  heading: {
    textAlign: 'center',
  },
  subheading: {
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  cardPressable: {
    width: 150,
  },
  card: {
    borderRadius: Spacing.three,
    borderWidth: 2,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
  },
  cardName: {
    textAlign: 'center',
  },
  cardSubtext: {
    textAlign: 'center',
  },
  bestBadge: {
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
  bestBadgeText: {
    color: '#FFFFFF',
  },
  exitPressable: {
    marginTop: Spacing.one,
  },
});
