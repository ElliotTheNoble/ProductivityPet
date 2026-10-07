import { Pressable, StyleSheet, View } from 'react-native';

import { PawTokenCoin } from '@/components/paw-token-coin';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  KITTY_CATCH_DAILY_HIGH_SCORE_BONUS_LIMIT,
  type KittyCatchRoundResult,
} from '@/utils/kitty-catch-rewards';
import { KITTY_CATCH_MIN_SCORE_FOR_BONUS } from '@/utils/kitty-catch';

type KittyCatchResultsProps = {
  result: KittyCatchRoundResult;
  onPlayAgain: () => void;
  onExit: () => void;
};

// Game Over / results screen shown once a Kitty Catch round ends — purely
// a display of whatever @/utils/kitty-catch-rewards.ts already decided
// and already saved; this component never grants or calculates any reward
// itself, only explains what happened and why.
export function KittyCatchResults({ result, onPlayAgain, onExit }: KittyCatchResultsProps) {
  const theme = useTheme();

  const playRewardLine = result.playReward.awarded
    ? `+${result.playReward.amount} Playing Reward`
    : result.playReward.reason === 'daily-limit-reached'
      ? 'Daily Paw Token limit reached! 🐾\nKeep playing for fun and high scores!'
      : null;

  const highScoreBonusLine = result.highScoreBonus.awarded
    ? `+${result.highScoreBonus.amount} New High Score Bonus`
    : result.highScoreBonus.eligible && result.highScoreBonus.reason === 'daily-limit-reached'
      ? `Daily high-score bonus limit reached (${KITTY_CATCH_DAILY_HIGH_SCORE_BONUS_LIMIT}/day) — your new best is still saved!`
      : result.isNewHighScore && !result.highScoreBonus.eligible
        ? `Scores need to be at least ${KITTY_CATCH_MIN_SCORE_FOR_BONUS} to earn the High Score Bonus — your new best is still saved!`
        : null;

  // happinessAwarded is the exact real delta applied to the stored (float,
  // continuously-decaying) Happiness value — e.g. 0.0225 instead of a
  // clean 10 when Happiness was already nearly at the 100 cap. The STORED
  // value stays exactly as computed (same clamp-at-100 convention as every
  // other need in the app); only this display rounds it to a simple whole
  // number, same convention pet-placeholder.tsx already uses for its need
  // bars (Math.round(hunger), etc.) — never shown as a raw float here.
  const roundedHappinessAwarded = Math.round(result.happinessAwarded);
  const happinessLine =
    roundedHappinessAwarded > 0 ? `+${roundedHappinessAwarded} Happiness` : 'Happiness is already full 💛';

  return (
    <View style={styles.wrapper}>
      <ThemedView type="peachOverlay" style={styles.card}>
        <ThemedText type="subtitle" style={styles.title}>
          {result.isNewHighScore ? 'New High Score! 🎉' : 'Game Over'}
        </ThemedText>

        <View style={styles.scoreRow}>
          <View style={styles.scoreBlock}>
            <ThemedText type="small" themeColor="textSecondary">
              Round Score
            </ThemedText>
            <ThemedText type="title" style={styles.scoreNumber}>
              {result.score}
            </ThemedText>
          </View>
          <View style={styles.scoreBlock}>
            <ThemedText type="small" themeColor="textSecondary">
              Best Score
            </ThemedText>
            <ThemedText type="title" style={styles.scoreNumber}>
              {result.highScore}
            </ThemedText>
          </View>
        </View>

        <ThemedView type="backgroundElementOverlay" style={styles.rewardsCard}>
          <ThemedText type="smallBold">{happinessLine}</ThemedText>

          <View style={styles.tokensRow}>
            <PawTokenCoin size={18} />
            <ThemedText type="smallBold">{result.totalPawTokensAwarded} Paw Tokens earned</ThemedText>
          </View>

          {playRewardLine ? (
            <ThemedText type="small" themeColor="textSecondary">
              {playRewardLine}
            </ThemedText>
          ) : null}
          {highScoreBonusLine ? (
            <ThemedText type="small" themeColor="textSecondary">
              {highScoreBonusLine}
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
