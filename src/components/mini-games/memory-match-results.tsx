import { StyleSheet, View } from 'react-native';

import { HoverPressable as Pressable } from '@/components/hover-pressable';

import { useT } from '@/i18n';
import { PawTokenCoin } from '@/components/paw-token-coin';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { difficultyLabel } from '@/utils/memory-match';
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
  const { t } = useT();

  const completionLimitLine =
    !result.completionReward.awarded && result.completionReward.reason === 'daily-limit-reached'
      ? t('mmLimit')
      : null;

  const newBestLimitLine =
    result.newBestBonus.eligible && !result.newBestBonus.awarded && result.newBestBonus.reason === 'daily-limit-reached'
      ? t('mmBestLimit')
      : null;

  // happinessAwarded is the exact real delta applied to the stored (float,
  // continuously-decaying) Happiness value — same convention as Kitty
  // Catch's results screen: the stored value stays exactly as computed
  // (still capped at 100), only this display rounds it to a simple whole
  // number so it never shows an ugly decimal.
  const roundedHappinessAwarded = Math.round(result.happinessAwarded);
  const happinessLine =
    roundedHappinessAwarded > 0 ? t('mgHappy', { n: roundedHappinessAwarded }) : t('mgHappyFull');

  return (
    <View style={styles.wrapper}>
      <ThemedView type="peachOverlay" style={styles.card}>
        <ThemedText type="subtitle" style={styles.title}>
          {t('mmComplete')}
        </ThemedText>
        {result.isNewBest ? (
          <ThemedView type="mint" style={styles.newBestBadge}>
            <ThemedText type="smallBold" style={styles.newBestBadgeText}>
              {t('mmNewBest')}
            </ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundSelected" style={styles.difficultyPill}>
          <ThemedText type="smallBold">{difficultyLabel(result.difficulty)}</ThemedText>
        </ThemedView>

        <View style={styles.scoreRow}>
          <View style={styles.scoreBlock}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('mmMovesLabel')}
            </ThemedText>
            <ThemedText type="title" style={styles.scoreNumber}>
              {result.moves}
            </ThemedText>
          </View>
          <View style={styles.scoreBlock}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('mmBestMovesLabel')}
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
            <ThemedText type="smallBold">{t('mgTokens', { n: result.totalPawTokensAwarded })}</ThemedText>
          </View>

          {result.totalPawTokensAwarded > 0 ? (
            <>
              {result.completionReward.awarded ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('mmCompletion', { n: result.completionReward.amount })}
                </ThemedText>
              ) : null}
              {result.newBestBonus.awarded ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('mmNewBestLine', { n: result.newBestBonus.amount })}
                </ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                {t('mmTotal', { n: result.totalPawTokensAwarded })}
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
                {t('mgPlayAgain')}
              </ThemedText>
            </ThemedView>
          </Pressable>
          <Pressable onPress={onExit} style={styles.buttonPressable}>
            <ThemedView type="backgroundSelected" style={styles.button}>
              <ThemedText type="smallBold">{t('mgExit')}</ThemedText>
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
