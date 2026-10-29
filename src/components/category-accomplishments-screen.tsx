import { useEffect, useState } from 'react';

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
import { CATEGORY_CARD_BACKGROUND, CATEGORY_ICON_CROP, StatsIcon } from '@/components/stats-screen';
import type { TaskCategory } from '@/utils/categorize-task';
import { getCompletedEntries, getDailyBuckets } from '@/utils/category-accomplishments';
import { getCachedTasks } from '@/utils/task-storage';
import type { Task } from '@/utils/tasks';

const CHART_DAYS = 7;

// Saturated-enough pastel for the bars, one per category — each paired with
// that category's existing card tint and accent-mark color on the Stats page.
// (Exported so the Lifetime Stats pages can reuse the same palette.)
export const CATEGORY_BAR_COLOR: Record<TaskCategory, string> = {
  Study: '#8EC9E8',
  Exercise: '#7FD9B6',
  Clean: '#F3D77A',
  Health: '#F4A6BB',
  Personal: '#B9A3E6',
};

// "<Category> Accomplishments" — everything shown is computed from the real
// task list (see @/utils/category-accomplishments.ts), read through the same
// shared in-memory task cache every other screen uses. This page never writes.
export function CategoryAccomplishmentsScreen({ category }: { category: TaskCategory }) {
  const [tasks, setTasks] = useState<Task[]>([]);

  // Stats-area pages remount on every visit, so a mount-time read always
  // picks up tasks completed (or un-checked) elsewhere since the last visit.
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

  const entries = getCompletedEntries(tasks, category);
  const buckets = getDailyBuckets(entries, CHART_DAYS);
  const weekCount = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const undatedCount = entries.filter((entry) => entry.dateISO === null).length;
  const background = CATEGORY_CARD_BACKGROUND[category];

  return (
    <DetailPageShell>
      <DetailTitleCard
        icon={<StatsIcon crop={CATEGORY_ICON_CROP[category]} size={72} />}
        title={`${category} Accomplishments`}
        backgroundColor={background}
      />

      <SummaryRow>
        <SummaryCard value={entries.length} label="completed in total" backgroundColor={background} />
        <SummaryCard value={weekCount} label={`this week (last ${CHART_DAYS} days)`} backgroundColor={background} />
      </SummaryRow>

      <DetailPanel title="📊 Completed per day">
        <CompletedBarChart buckets={buckets} color={CATEGORY_BAR_COLOR[category]} />
        {undatedCount > 0 ? (
          <DetailNote>
            {undatedCount} earlier {undatedCount === 1 ? 'task was' : 'tasks were'} completed before completion
            dates were recorded, so {undatedCount === 1 ? 'it isn’t' : 'they aren’t'} shown on the chart.
          </DetailNote>
        ) : null}
      </DetailPanel>

      <DetailPanel title="✅ Completed tasks">
        {entries.length === 0 ? (
          <DetailEmptyState
            icon={<StatsIcon crop={CATEGORY_ICON_CROP[category]} size={64} />}
            title="Nothing completed here yet"
            text={`Finish a ${category.toLowerCase()} task on Home or the Tasks page and it will show up here!`}
          />
        ) : (
          entries.map((entry) => <CompletedEntryRow key={entry.key} entry={entry} />)
        )}
      </DetailPanel>
    </DetailPageShell>
  );
}
