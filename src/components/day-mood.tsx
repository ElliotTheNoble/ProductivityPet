import { StyleSheet, View } from 'react-native';

import { HoverPressable as Pressable } from '@/components/hover-pressable';
import { MoodIcon } from '@/components/mood-icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { MOODS, moodName } from '@/utils/mood';
import { toggleMoodForDate, useMoodForDate } from '@/utils/mood-log';
import { todayISO } from '@/utils/tasks';

// The Tasks calendar's compact mood selector for the selected day: an empty (unchecked) square while nothing is recorded, the six moods to pick
// from, the chosen one outlined. Tapping the chosen mood again clears the day. Works for today and for past days (to fill in a missed one); a
// future day has nothing to record, so nothing is shown. It reads and writes the same one-mood-per-day record Home's "Today's Mood" uses, so
// the two always agree; it never touches the pet.
export function DayMood({ dateISO }: { dateISO: string }) {
  const { t } = useT();
  const theme = useTheme();
  const mood = useMoodForDate(dateISO);
  if (dateISO > todayISO()) return null;
  return (
    <View style={styles.row} testID="day-mood">
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('dayMoodLabel')}
      </ThemedText>
      <View
        testID="day-mood-state"
        accessible
        accessibilityLabel={mood ? t('dayMoodSelected', { name: moodName(mood) }) : t('dayMoodNone')}
        style={[styles.box, { borderColor: theme.backgroundSelected }, mood === null && styles.boxEmpty]}
      />
      <View style={styles.options}>
        {MOODS.map((option) => (
          <Pressable
            key={option}
            onPress={() => void toggleMoodForDate(dateISO, option)}
            accessibilityRole="button"
            accessibilityLabel={moodName(option)}
            accessibilityState={{ selected: option === mood }}
            style={({ pressed }) => pressed && styles.pressed}>
            <View style={[styles.optionFrame, { borderColor: option === mood ? theme.accent : 'transparent' }]}>
              <MoodIcon mood={option} size={30} />
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2 },
  boxEmpty: { borderStyle: 'dashed' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  optionFrame: { padding: 2, borderWidth: 2, borderRadius: Spacing.two },
  pressed: { opacity: 0.7 },
});
