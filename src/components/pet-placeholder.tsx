import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export function PetPlaceholder() {
  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <ThemedText style={styles.emoji}>🐾</ThemedText>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Your Pet
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
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
