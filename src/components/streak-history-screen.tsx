import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  CompletedBarChart,
  DetailEmptyState,
  DetailNote,
  DetailPageShell,
  DetailPanel,
  DetailTitleCard,
  SummaryCard,
  SummaryRow,
} from '@/components/detail-page-parts';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MONTH_NAMES, MONTH_SHORT_NAMES, daysInMonth, pad2, toISO } from '@/utils/mood-stats';
import { getStreakSummary } from '@/utils/streaks';
import { getCachedTasks } from '@/utils/task-storage';
import { todayISO, type Task } from '@/utils/tasks';

// Streak History — built from the real task list (see @/utils/streaks.ts for
// the exact rule). A day with no completed task is just an inactive day; the
// page never invents activity for dates without records.

const PAGE_BACKGROUND = '#E6F7EF';
const ACTIVE_COLOR = '#7FD9B6';
const INACTIVE_COLOR = 'rgba(150, 130, 160, 0.14)';
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function StreakHistoryScreen() {
  const theme = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const today = todayISO();
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month0: Number(today.slice(5, 7)) - 1 }));

  useEffect(() => {
    let cancelled = false;
    getCachedTasks()
      .then((list) => !cancelled && setTasks(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = getStreakSummary(tasks, today);
  const activeSet = new Set(summary.activeDays);

  function shiftMonth(delta: number) {
    const total = cursor.year * 12 + cursor.month0 + delta;
    setCursor({ year: Math.floor(total / 12), month0: total % 12 });
  }
  const firstWeekday = new Date(cursor.year, cursor.month0, 1).getDay();
  const monthDayCount = daysInMonth(cursor.year, cursor.month0);

  // Active days per month, last 12 months ending this month.
  const now = new Date();
  const monthBuckets = Array.from({ length: 12 }, (_, i) => {
    const total = now.getFullYear() * 12 + now.getMonth() - (11 - i);
    const year = Math.floor(total / 12);
    const month0 = total % 12;
    const prefix = `${year}-${pad2(month0 + 1)}-`;
    return {
      dateISO: `${year}-${pad2(month0 + 1)}`,
      weekdayLabel: MONTH_SHORT_NAMES[month0],
      count: summary.activeDays.filter((d) => d.startsWith(prefix)).length,
    };
  });

  const previousRuns = [...summary.runs]
    .filter((run) => run.length >= 2)
    .sort((a, b) => (a.startISO < b.startISO ? 1 : -1));
  const currentRunEnd = summary.current > 0 ? summary.runs[summary.runs.length - 1].endISO : null;

  return (
    <DetailPageShell>
      <DetailTitleCard
        icon={<ThemedText style={styles.emoji}>🔥</ThemedText>}
        title="Streak History"
        backgroundColor={PAGE_BACKGROUND}
      />

      <SummaryRow>
        <SummaryCard value={summary.current} label={summary.current === 1 ? 'day current streak' : 'days current streak'} backgroundColor={PAGE_BACKGROUND} />
        <SummaryCard value={summary.longest} label={summary.longest === 1 ? 'day longest streak' : 'days longest streak'} backgroundColor={PAGE_BACKGROUND} />
        <SummaryCard value={summary.activeDays.length} label="active days in total" backgroundColor={PAGE_BACKGROUND} />
      </SummaryRow>

      <DetailPanel title="💡 What this measures">
        <ThemedText type="small" themeColor="textSecondary">
          A day counts as active when you complete at least one task on it (finishing several still counts as
          one day). A streak is a run of consecutive active days, and a day with no completed task ends it. Your
          current streak stays alive today until the day is over, so it won&apos;t break before you&apos;ve had
          the chance to complete something.
        </ThemedText>
        {summary.undatedCount > 0 ? (
          <DetailNote>
            {summary.undatedCount} earlier {summary.undatedCount === 1 ? 'task was' : 'tasks were'} completed before
            completion dates were recorded, so {summary.undatedCount === 1 ? 'it can’t' : 'they can’t'} be placed on a day.
            Older streaks may therefore look shorter than they really were.
          </DetailNote>
        ) : null}
      </DetailPanel>

      <DetailPanel title="🗓️ Active days">
        <View style={styles.navRow}>
          <Pressable onPress={() => shiftMonth(-1)} accessibilityRole="button" accessibilityLabel="Previous month" style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
              <ThemedText type="smallBold">‹</ThemedText>
            </ThemedView>
          </Pressable>
          <ThemedText type="smallBold" style={styles.navLabel}>
            {MONTH_NAMES[cursor.month0]} {cursor.year}
          </ThemedText>
          <Pressable onPress={() => shiftMonth(1)} accessibilityRole="button" accessibilityLabel="Next month" style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
              <ThemedText type="smallBold">›</ThemedText>
            </ThemedView>
          </Pressable>
        </View>
        <View style={styles.weekdayRow}>
          {WEEKDAY_INITIALS.map((letter, i) => (
            <ThemedText key={i} type="small" themeColor="textSecondary" style={styles.weekdayCell}>
              {letter}
            </ThemedText>
          ))}
        </View>
        <View style={styles.grid}>
          {Array.from({ length: firstWeekday }, (_, i) => (
            <View key={`b${i}`} style={styles.cell} />
          ))}
          {Array.from({ length: monthDayCount }, (_, i) => {
            const dateISO = toISO(cursor.year, cursor.month0, i + 1);
            const active = activeSet.has(dateISO);
            return (
              <View key={dateISO} style={styles.cell}>
                <View
                  accessibilityLabel={`${formatDay(dateISO)}${active ? ', active' : ''}`}
                  style={[
                    styles.day,
                    { backgroundColor: active ? ACTIVE_COLOR : INACTIVE_COLOR },
                    dateISO === today && { borderColor: theme.accent, borderWidth: 2 },
                  ]}>
                  <ThemedText type="small" style={styles.dayText}>
                    {i + 1}
                  </ThemedText>
                </View>
              </View>
            );
          })}
        </View>
        <DetailNote>Green days had at least one completed task. Other days simply have no record.</DetailNote>
      </DetailPanel>

      <DetailPanel title="📊 Active days per month">
        {summary.activeDays.length === 0 ? (
          <DetailEmptyState
            icon={<ThemedText style={styles.emoji}>🌱</ThemedText>}
            title="No active days yet"
            text="Complete a task today to start your first streak!"
          />
        ) : (
          <CompletedBarChart buckets={monthBuckets} color={ACTIVE_COLOR} />
        )}
      </DetailPanel>

      <DetailPanel title="🏅 Streaks">
        {previousRuns.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Streaks of 2 or more days will be listed here as you build them.
          </ThemedText>
        ) : (
          previousRuns.map((run) => (
            <View key={run.startISO} style={styles.runRow}>
              <View style={styles.runText}>
                <ThemedText type="smallBold">
                  {run.length} days{run.endISO === currentRunEnd ? ' · current' : ''}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDay(run.startISO)} – {formatDay(run.endISO)}
                </ThemedText>
              </View>
            </View>
          ))
        )}
      </DetailPanel>
    </DetailPageShell>
  );
}

const styles = StyleSheet.create({
  emoji: { fontSize: 48, lineHeight: 56 },
  pressed: { opacity: 0.8 },
  pointer: { cursor: 'pointer' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  navButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.five },
  navLabel: { flexShrink: 1, fontSize: 16, lineHeight: 22 },
  weekdayRow: { flexDirection: 'row' },
  weekdayCell: { width: '14.2857%', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.2857%', aspectRatio: 1, padding: 2 },
  day: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 13, lineHeight: 16 },
  runRow: {
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderColor: 'rgba(150, 130, 160, 0.2)',
  },
  runText: { gap: 2 },
});
