import { Pressable, StyleSheet, View } from 'react-native';

import { PawTokenCoin } from '@/components/paw-token-coin';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { MEMORY_MATCH_DIFFICULTY_INFO } from '@/utils/memory-match';
import type { MemoryMatchRoundResult } from '@/utils/memory-match-rewards';

type MemoryMatchResultsProps = {
  result: MemoryMatchRoundResult;
  onPlayAgain: () => void;
  onExit: () => void;
};

// Game Over / results screen shown once a Memory Match round ends —
// purely a display of whatever @/utils/memory-match-rewards.ts already
// decided and already saved; this component never grants or calculates
// any reward itself. Deliberately mirrors kitty-catch-results.tsx's
// layout/colors/button shape so the two mini-games read as one system,
// while using Memory Match's own wording per its own spec.
export function MemoryMatchResults({ result, onPlayAgain, onExit }: MemoryMatchResultsProps) {

  const completionLimitLine =
    !result.completionReward.awarded && result.completionReward.reason === 'daily-limit-reached'
      ? 'Daily Paw Token limit reached! 🐾\nKeep playing for fun and better scores!'
      : null;

  const newBestLimitLine =
    result.newBestBonus.eligible && !result.newBestBonus.awarded && result.newBestBonus.reason === 'daily-limit-reached'
      ? 'Daily New Best bonus limit reached! 🐾\nYour new best is still saved!'
      : null;

  // happinessAwarded is the exact real delta applied to the stored (float,
  // continuously-decaying) Happiness value — same convention as Kitty
  // Catch's results screen: the stored value stays exactly as computed
  // (still capped at 100), only this display rounds it to a simple whole
  // number so it never shows an ugly decimal.
  const roundedHappinessAwarded = Math.round(result.happinessAwarded);
  const happinessLine =
    roundedHappinessAwarded > 0 ? `+${roundedHappinessAwarded} Happiness` : 'Happiness is already full 💛';

  return (
    <View style={styles.wrapper}>
      <ThemedView type="peachOverlay" style={styles.card}>
        <ThemedText type="subtitle" style={styles.title}>
          Memory Match Complete!
        </ThemedText>
        {result.isNewBest ? (
          <ThemedView type="mint" style={styles.newBestBadge}>
            <ThemedText type="smallBold" style={styles.newBestBadgeText}>
              New Best! 🎉
            </ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundSelected" style={styles.difficultyPill}>
          <ThemedText type="smallBold">{MEMORY_MATCH_DIFFICULTY_INFO[result.difficulty].label}</ThemedText>
        </ThemedView>

        <View style={styles.scoreRow}>
          <View style={styles.scoreBlock}>
            <ThemedText type="small" themeColor="textSecondary">
              Moves
            </ThemedText>
            <ThemedText type="title" style={styles.scoreNumber}>
              {result.moves}
            </ThemedText>
          </View>
          <View style={styles.scoreBlock}>
            <ThemedText type="small" themeColor="textSecondary">
              Best Moves
            </ThemedText>
            <ThemedText type="title" style={styles.scoreNumber}>
              {result.bestMoves}
            </ThemedText>
          </View>
        </View>

        <ThemedView type="backgroundElementOverlay" style={styles.rewardsCard}>
          <ThemedText type="smallBold">{happinessLine}</ThemedText>

          <View style={styles.tokensRow}>
            <PawTokenCoin size={18} />
            <ThemedText type="smallBold">{result.totalPawTokensAwarded} Paw Tokens earned</ThemedText>
          </View>

          {result.totalPawTokensAwarded > 0 ? (
            <>
              {result.completionReward.awarded ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Completion: +{result.completionReward.amount}
                </ThemedText>
              ) : null}
              {result.newBestBonus.awarded ? (
                <ThemedText type="small" themeColor="textSecondary">
                  New Best: +{result.newBestBonus.amount}
                </ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                Total: +{result.totalPawTokensAwarded} Paw Tokens
              </ThemedText>
            </>
          ) : null}

          {completionLimitLine ? (
            <ThemedText type="small" themeColor="textSecondary">
              {completionLimitLine}
            </ThemedText>
          ) : null}
          {newBestLimitLine ? (
            <ThemedText type="small" themeColor="textSecondary">
              {newBestLimitLine}
            </ThemedText>
          ) : null}
        </ThemedView>

        <View style={styles.buttonsRow}>
          <Pressable onPress={onPlayAgain} style={styles.buttonPressable}>
            <ThemedView type="accent" style={styles.button}>
              <ThemedText type="smallBold" style={styles.buttonTextLight}>
                Play Again
              </ThemedText>
            </ThemedView>
          </Pressable>
          <Pressable onPress={onExit} style={styles.buttonPressable}>
            <ThemedView type="backgroundSelected" style={styles.button}>
              <ThemedText type="smallBold">Exit Game</ThemedText>
            </ThemedView>
          </Pressable>
        </View>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
  },
  newBestBadge: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  newBestBadgeText: {
    color: '#FFFFFF',
  },
  difficultyPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
  scoreRow: {
    flexDirection: 'row',
    gap: Spacing.five,
  },
  scoreBlock: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  scoreNumber: {
    fontSize: 36,
    lineHeight: 40,
  },
  rewardsCard: {
    width: '100%',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  tokensRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  buttonPressable: {
    flexShrink: 1,
  },
  button: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    alignItems: 'center',
  },
  buttonTextLight: {
    color: '#FFFFFF',
  },
});
