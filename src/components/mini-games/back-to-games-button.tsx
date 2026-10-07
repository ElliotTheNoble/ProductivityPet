import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type BackToGamesButtonProps = {
  onPress: () => void;
};

// Shared "Back to Games" pill for every mini-game's ACTIVE GAMEPLAY HUD
// (Kitty Catch, Memory Match, and any future mini-game) — always just
// calls onPress (each game wires this straight to its own onExit) without
// touching any game state first. completeKittyCatchRound /
// completeMemoryMatchRound are only ever called from each game's own
// "round just ended" effect (phase === 'ended'); leaving through this
// button never flips phase to 'ended', so it can't award Happiness or Paw
// Tokens, update a high score/Best Moves, or consume a daily reward slot
// — the round is simply abandoned. Same `backgroundSelected` lavender
// already used for the "Exit Game" button on both games' results screens,
// so it reads as the same kind of action.
export function BackToGamesButton({ onPress }: BackToGamesButtonProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <ThemedView type="backgroundSelected" style={styles.pill}>
        <ThemedText type="smallBold">← Back to Games</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignSelf: 'flex-start',
  },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  pressed: {
    opacity: 0.7,
  },
});
