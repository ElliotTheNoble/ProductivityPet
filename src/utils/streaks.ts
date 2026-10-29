import { getAllCompletedEntries } from '@/utils/category-accomplishments';
import { addDaysISO, todayISO, type Task } from '@/utils/tasks';

// Task-completion streaks, derived entirely from the real task list — no
// separate counter exists to drift out of sync. The app had no streak rule
// before this, so this one is used:
//
//  - A day is ACTIVE if at least one task was completed on that local
//    calendar day (several tasks on one day still make just one active day).
//  - A streak is a run of consecutive active days; a day with no completed
//    task ends it.
//  - The CURRENT streak isn't broken until a day has fully passed: if today
//    has no completed task yet but yesterday does, the streak is still alive
//    (it just hasn't been extended today).
//
// Which day a completion belongs to: repeating tasks use the occurrence date
// that was checked off; one-time tasks use the date they were checked off
// (completedAt). One-time tasks completed before completion dates were
// recorded can't be placed on a day, so they're left out (never guessed) —
// which can make older streaks look shorter than they really were.
// Un-checking or deleting a task removes its day automatically, since days
// are recomputed from the tasks each time.

export type StreakRun = { startISO: string; endISO: string; length: number };

export type StreakSummary = {
  activeDays: string[]; // sorted ascending, no future dates
  runs: StreakRun[]; // oldest first
  current: number;
  longest: number;
  undatedCount: number; // completions that couldn't be placed on a day
};

export function getActiveDays(tasks: Task[], today: string = todayISO()): { days: string[]; undatedCount: number } {
  const entries = getAllCompletedEntries(tasks);
  const days = new Set<string>();
  let undatedCount = 0;
  for (const entry of entries) {
    if (entry.dateISO === null) undatedCount += 1;
    else if (entry.dateISO <= today) days.add(entry.dateISO);
  }
  return { days: Array.from(days).sort(), undatedCount };
}

export function computeRuns(sortedDays: string[]): StreakRun[] {
  const runs: StreakRun[] = [];
  for (const day of sortedDays) {
    const last = runs[runs.length - 1];
    if (last && addDaysISO(last.endISO, 1) === day) {
      last.endISO = day;
      last.length += 1;
    } else {
      runs.push({ startISO: day, endISO: day, length: 1 });
    }
  }
  return runs;
}

export function getStreakSummary(tasks: Task[], today: string = todayISO()): StreakSummary {
  const { days, undatedCount } = getActiveDays(tasks, today);
  const runs = computeRuns(days);
  const last = runs[runs.length - 1];
  const yesterday = addDaysISO(today, -1);
  const current = last && (last.endISO === today || last.endISO === yesterday) ? last.length : 0;
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return { activeDays: days, runs, current, longest, undatedCount };
}

// Streak facts for one calendar year, from only that year's active days (a
// streak crossing New Year is counted separately on each side).
export function getYearStreakFacts(
  activeDays: string[],
  year: number
): { activeDayCount: number; longest: number; milestones: number[] } {
  const inYear = activeDays.filter((day) => day.startsWith(`${year}-`));
  const longest = computeRuns(inYear).reduce((max, run) => Math.max(max, run.length), 0);
  const milestones = [3, 7, 14, 30, 60, 100].filter((threshold) => longest >= threshold);
  return { activeDayCount: inYear.length, longest, milestones };
}
