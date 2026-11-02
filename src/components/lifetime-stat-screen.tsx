import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HoverPressable as Pressable } from '@/components/hover-pressable';

import { CATEGORY_BAR_COLOR } from '@/components/category-accomplishments-screen';
import {
  CompletedBarChart,
  CompletedEntryRow,
  DetailEmptyState,
  DetailNote,
  DetailPageShell,
  DetailPanel,
  DetailTitleCard,
  SummaryCard,
  SummaryRow,
} from '@/components/detail-page-parts';
import { CLIPBOARD_CROP, STAR_CROP, StatsIcon } from '@/components/stats-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT, type StringKey } from '@/i18n';
import { categoryLabel } from '@/utils/categorize-task';
import {
  countThisMonth,
  getAllCompletedEntries,
  getDailyBuckets,
  type LifetimeStat,
} from '@/utils/category-accomplishments';
import { ALL_CATEGORIES } from '@/utils/stats';
import { getCachedTasks } from '@/utils/task-storage';
import type { Task } from '@/utils/tasks';

// Per-stat copy and styling. 'tasks' is the "Tasks Completed" card on the
// Stats page, 'important' the "Important Tasks Completed" one — the only two
// Lifetime Stats cards that exist today. Pastels match each card's own number
// color on the overview (mint / blush pink).
const STAT_CONFIG: Record<
  LifetimeStat,
  {
    titleKey: StringKey;
    crop: typeof CLIPBOARD_CROP;
    background: string;
    barColor: string;
    totalKey: StringKey;
    explainKey: StringKey;
    emptyTitleKey: StringKey;
    emptyTextKey: StringKey;
  }
> = {
  tasks: {
    titleKey: 'lifeTasksTitle' as const,
    crop: CLIPBOARD_CROP,
    background: '#E6F7EF',
    barColor: '#7FD9B6',
    totalKey: 'lifeTasksTotal' as const,
    explainKey: 'lifeTasksExplain' as const,
    emptyTitleKey: 'lifeTasksEmptyTitle' as const,
    emptyTextKey: 'lifeTasksEmptyText' as const,
  },
  important: {
    titleKey: 'lifeImportantTitle' as const,
    crop: STAR_CROP,
    background: '#FCEEF1',
    barColor: '#F4A6BB',
    totalKey: 'lifeImportantTotal' as const,
    explainKey: 'lifeImportantExplain' as const,
    emptyTitleKey: 'lifeImportantEmptyTitle' as const,
    emptyTextKey: 'lifeImportantEmptyText' as const,
  },
};

const RANGES = [
  { days: 7, labelKey: 'lifeRange7' },
  { days: 30, labelKey: 'lifeRange30' },
] as const;

// Detail page for one Lifetime Stats card. Everything is derived from the
// real task list through the same collector the category pages use, which
// applies the exact counting rule behind the overview numbers — so the total
// here always equals the card you tapped. Read-only; never writes.
export function LifetimeStatScreen({ stat }: { stat: LifetimeStat }) {
  const { t, tn } = useT();
  const theme = useTheme();
  const config = STAT_CONFIG[stat];
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rangeDays, setRangeDays] = useState<number>(7);

  // Stats-area pages remount on every visit, so this mount-time read picks up
  // anything completed (or un-checked) elsewhere since the last visit.
  useEffect(() => {
    let cancelled = false;
    getCachedTasks()
      .then((cached) => {
        if (!cancelled) setTasks(cached);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = getAllCompletedEntries(tasks, stat === 'important');
  const weekCount = getDailyBuckets(entries, 7).reduce((sum, bucket) => sum + bucket.count, 0);
  const monthCount = countThisMonth(entries);
  const buckets = getDailyBuckets(entries, rangeDays);
  const undatedCount = entries.filter((entry) => entry.dateISO === null).length;
  const categoryCounts = ALL_CATEGORIES.map((category) => ({
    category,
    count: entries.filter((entry) => entry.category === category).length,
  }));
  const maxCategoryCount = Math.max(1, ...categoryCounts.map((item) => item.count));

  return (
    <DetailPageShell>
      <DetailTitleCard
        icon={<StatsIcon crop={config.crop} size={72} />}
        title={t(config.titleKey)}
        backgroundColor={config.background}
      />

      <SummaryRow>
        <SummaryCard value={entries.length} label={t(config.totalKey)} backgroundColor={config.background} />
        <SummaryCard value={weekCount} label={t('lifeWeekLabel')} backgroundColor={config.background} />
        <SummaryCard value={monthCount} label={t('lifeMonthLabel')} backgroundColor={config.background} />
      </SummaryRow>

      <DetailPanel title={t('lifeMeasures')}>
        <ThemedText type="small" themeColor="textSecondary">
          {t(config.explainKey)}
        </ThemedText>
      </DetailPanel>

      <DetailPanel title={t('lifeOverTime')}>
        <View style={styles.rangeRow}>
          {RANGES.map((range) => {
            const selected = rangeDays === range.days;
            return (
              <Pressable
                key={range.days}
                onPress={() => setRangeDays(range.days)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [pressed && styles.pressed]}>
                <ThemedView
                  type={selected ? 'purple' : 'backgroundElement'}
                  style={[styles.rangePill, styles.pointer]}>
                  <ThemedText type="smallBold" style={selected ? styles.rangePillTextActive : undefined}>
                    {t(range.labelKey)}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            );
          })}
        </View>
        <CompletedBarChart buckets={buckets} color={config.barColor} labelEvery={rangeDays > 7 ? 5 : 1} />
        {undatedCount > 0 ? (
          <DetailNote>
            {tn('lifeEarlier', undatedCount)}
          </DetailNote>
        ) : null}
      </DetailPanel>

      <DetailPanel title={t('lifeByCategory')}>
        {categoryCounts.map(({ category, count }) => (
          <View key={category} style={styles.breakdownRow}>
            <ThemedText type="smallBold" style={styles.breakdownName}>
              {categoryLabel(category)}
            </ThemedText>
            <View style={[styles.breakdownTrack, { backgroundColor: theme.backgroundSelected }]}>
              <View
                style={[
                  styles.breakdownFill,
                  { width: `${(count / maxCategoryCount) * 100}%`, backgroundColor: CATEGORY_BAR_COLOR[category] },
                ]}
              />
            </View>
            <ThemedText type="smallBold" style={styles.breakdownCount}>
              {count}
            </ThemedText>
          </View>
        ))}
      </DetailPanel>

      <DetailPanel title={t('lifeCompletedList')}>
        {entries.length === 0 ? (
          <DetailEmptyState
            icon={<StatsIcon crop={config.crop} size={64} />}
            title={t(config.emptyTitleKey)}
            text={t(config.emptyTextKey)}
          />
        ) : (
          entries.map((entry) => <CompletedEntryRow key={entry.key} entry={entry} showCategory />)
        )}
      </DetailPanel>
    </DetailPageShell>
  );
}

const styles = StyleSheet.create({
  rangeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  rangePill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  rangePillTextActive: {
    color: '#FFFFFF',
  },
  pointer: {
    cursor: 'pointer',
  },
  pressed: {
    opacity: 0.8,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  breakdownName: {
    width: 84,
  },
  breakdownTrack: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: '100%',
    borderRadius: 7,
  },
  breakdownCount: {
    width: 36,
    textAlign: 'right',
  },
});
