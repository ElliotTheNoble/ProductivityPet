import type { TaskCategory } from '@/utils/categorize-task';
import { ALL_CATEGORIES } from '@/utils/stats';
import { addDaysISO, dateToISO, todayISO, type Task } from '@/utils/tasks';

// Pure helpers behind the Stats page's per-category "Accomplishments" pages
// (src/app/stats/[category].tsx). Everything here is derived on the fly from
// the real Task[] the rest of the app already owns (see
// @/utils/task-storage.ts) — no second store, nothing cached or copied, so
// the numbers can never drift from the Stats overview or from pet progress.

// URL slug for a category, e.g. 'Study' -> 'study'.
export function categoryToSlug(category: TaskCategory): string {
  return category.toLowerCase();
}

export function slugToCategory(slug: string | undefined): TaskCategory | null {
  if (!slug) return null;
  return ALL_CATEGORIES.find((category) => categoryToSlug(category) === slug.toLowerCase()) ?? null;
}

// One completed occurrence of a task.
export type CompletedEntry = {
  // Unique per occurrence (a repeating task can contribute many entries).
  key: string;
  text: string;
  important: boolean;
  category: TaskCategory;
  // Local 'YYYY-MM-DD' the item was completed on, or null when that isn't
  // recorded — i.e. a one-time task completed before completion timestamps
  // existed. Never guessed or back-filled from the scheduled date.
  dateISO: string | null;
};

function dateFromTimestamp(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : dateToISO(parsed);
}

// Every completed occurrence in `category`, newest first (undated ones
// last). Uses exactly the same counting rule as countCompletedOccurrences
// (@/utils/tasks.ts) — only kind: 'task', one entry per entry of
// completedDates for repeating tasks, one for a completed one-time task —
// so entries.length always equals that category's number on the Stats
// overview. Un-checking a task removes its entry because completion state
// is read straight from the task, never remembered separately.
export function getCompletedEntries(tasks: Task[], category: TaskCategory): CompletedEntry[] {
  return collectCompletedEntries(tasks, (task) => task.category === category);
}

// Every completed occurrence across ALL categories (the Lifetime Stats
// "Tasks Completed" total), or only Important-flagged ones. Same counting
// rule again, so these lengths always equal getCompletedTaskCount /
// getImportantCompletedCount (@/utils/tasks.ts, @/utils/stats.ts).
export function getAllCompletedEntries(tasks: Task[], importantOnly = false): CompletedEntry[] {
  return collectCompletedEntries(tasks, (task) => !importantOnly || task.important);
}

function collectCompletedEntries(tasks: Task[], include: (task: Task) => boolean): CompletedEntry[] {
  const entries: CompletedEntry[] = [];
  for (const task of tasks) {
    if (task.kind !== 'task' || !include(task)) continue;
    if (task.repeat) {
      // completedDates holds the occurrence dates that were checked off.
      for (const date of task.completedDates ?? []) {
        entries.push({
          key: `${task.id}:${date}`,
          text: task.text,
          important: task.important,
          category: task.category,
          dateISO: date,
        });
      }
    } else if (task.completed) {
      entries.push({
        key: task.id,
        text: task.text,
        important: task.important,
        category: task.category,
        dateISO: dateFromTimestamp(task.completedAt),
      });
    }
  }
  return entries.sort((a, b) => {
    if (a.dateISO === b.dateISO) return 0;
    if (a.dateISO === null) return 1;
    if (b.dateISO === null) return -1;
    return a.dateISO < b.dateISO ? 1 : -1;
  });
}

export type DayBucket = { dateISO: string; weekdayLabel: string; count: number };

// How many entries were completed in the current calendar month (entries
// without a recorded date can't be placed, so they're not counted here).
export function countThisMonth(entries: CompletedEntry[]): number {
  const monthPrefix = todayISO().slice(0, 7);
  return entries.filter((entry) => entry.dateISO !== null && entry.dateISO.startsWith(monthPrefix)).length;
}

// The last `days` calendar days ending today (oldest first), each with how
// many entries were completed that day — zero-completion days included.
// Entries without a known completion date can't be placed on a day, so they
// are left out of the buckets (they still count in the all-time total).
export function getDailyBuckets(entries: CompletedEntry[], days = 7): DayBucket[] {
  const today = todayISO();
  const buckets: DayBucket[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const dateISO = addDaysISO(today, -offset);
    buckets.push({
      dateISO,
      // Weekday names for a week; short month/day for longer ranges.
      weekdayLabel:
        days <= 7
          ? new Date(`${dateISO}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })
          : new Date(`${dateISO}T00:00:00`).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
      count: 0,
    });
  }
  for (const entry of entries) {
    const bucket = buckets.find((b) => b.dateISO === entry.dateISO);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

// The Lifetime Stats cards on the Stats page that open a detail page
// (/stats/lifetime/<slug>). 'tasks' = Tasks Completed, 'important' =
// Important Tasks Completed — the same two numbers as the overview cards.
export type LifetimeStat = 'tasks' | 'important';

export function slugToLifetimeStat(slug: string | undefined): LifetimeStat | null {
  return slug === 'tasks' || slug === 'important' ? slug : null;
}
