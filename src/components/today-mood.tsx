import { Pressable, StyleSheet, View } from 'react-native';

import { MoodIcon } from '@/components/mood-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MOODS, type Mood } from '@/utils/mood';

type TodayMoodProps = {
  mood: Mood;
  message: string;
  onSelectMood: (mood: Mood) => void;
};

export function TodayMood({ mood, message, onSelectMood }: TodayMoodProps) {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText style={styles.title}>Today&apos;s Mood</ThemedText>

      <View style={styles.selectedRow}>
        <MoodIcon mood={mood} size={72} />
        <View style={styles.selectedTextGroup}>
          <ThemedText type="smallBold">{mood}!</ThemedText>
          <ThemedView type="background" style={styles.bubble}>
            <ThemedText type="small">{message}</ThemedText>
          </ThemedView>
        </View>
      </View>

      <View style={styles.optionsRow}>
        {MOODS.map((option) => (
          <Pressable
            key={option}
            onPress={() => onSelectMood(option)}
            style={({ pressed }) => pressed && styles.pressed}>
            <View
              style={[
                styles.optionFrame,
                { borderColor: theme.backgroundElement },
                option === mood && { borderColor: theme.accent },
              ]}>
              <MoodIcon mood={option} size={36} />
            </View>
          </Pressable>
        ))}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  selectedTextGroup: {
    flex: 1,
    gap: Spacing.one,
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  optionFrame: {
    padding: Spacing.half,
    borderWidth: 2,
    borderRadius: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
});
