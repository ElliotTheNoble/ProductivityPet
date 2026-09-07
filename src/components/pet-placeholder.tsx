import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type PetPlaceholderProps = {
  message?: string | null;
};

export function PetPlaceholder({ message }: PetPlaceholderProps) {
  return (
    <ThemedView style={styles.wrapper}>
      <ThemedView type="backgroundElement" style={styles.container}>
        <ThemedText style={styles.emoji}>🐾</ThemedText>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Your Pet
        </ThemedText>
      </ThemedView>
      {message ? <ThemedText type="smallBold">{message}</ThemedText> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  emoji: {
    fontSize: 64,
  },
});
