import { StyleSheet, View } from 'react-native';

import { HoverPressable as Pressable } from '@/components/hover-pressable';

import { MoodIcon } from '@/components/mood-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { MOODS, moodName, type Mood } from '@/utils/mood';

type TodayMoodProps = {
  // null = nothing recorded for today: an empty (unchecked) square is shown and nothing is selected
  mood: Mood | null;
  message: string;
  onSelectMood: (mood: Mood) => void;
};

export function TodayMood({ mood, message, onSelectMood }: TodayMoodProps) {
  const { t } = useT();
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElementOverlay" style={styles.card}>
      <ThemedText style={styles.title}>{t('todaysMood')}</ThemedText>

      <View style={styles.selectedRow}>
        {mood ? (
          <MoodIcon mood={mood} size={72} />
        ) : (
          <View
            testID="today-mood-empty"
            accessible
            accessibilityLabel={t('moodNoneLabel')}
            style={[styles.emptyBox, { borderColor: theme.backgroundSelected }]}
          />
        )}
        <View style={styles.selectedTextGroup}>
          {mood ? (
            <>
              <ThemedText type="smallBold">{t('moodExclaim', { name: moodName(mood) })}</ThemedText>
              <ThemedView type="background" style={styles.bubble}>
                <ThemedText type="small">{message}</ThemedText>
              </ThemedView>
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {t('moodNotRecorded')}
            </ThemedText>
          )}
        </View>
      </View>

      <View style={styles.optionsRow}>
        {MOODS.map((option) => (
          <Pressable
            key={option}
            onPress={() => onSelectMood(option)}
            accessibilityRole="button"
            accessibilityLabel={moodName(option)}
            accessibilityState={{ selected: option === mood }}
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
  // Nothing recorded for today: an empty, dashed square the size of the mood picture.
  emptyBox: {
    width: 72,
    height: 72,
    borderRadius: Spacing.three,
    borderWidth: 2,
    borderStyle: 'dashed',
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
