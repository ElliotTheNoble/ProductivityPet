import type { TaskCategory } from '@/utils/categorize-task';
import { countCompletedOccurrences, type Task } from '@/utils/tasks';

// The 5 categories categorizeTask() can ever assign — listed here only for
// iteration order on the Stats page. categorizeTask() itself is unchanged
// and remains the only place that decides a task's category.
export const ALL_CATEGORIES: TaskCategory[] = ['Study', 'Exercise', 'Clean', 'Health', 'Personal'];

// Completed-occurrence count per category, for the Stats page's "Completed
// by Category" section. Reuses the exact same per-task counting rule as
// getCompletedTaskCount (see countCompletedOccurrences in
// src/utils/tasks.ts), so summing every category's count here always equals
// getCompletedTaskCount(tasks) — these numbers can never disagree with what
// drives pet progress.
export function getCategoryCompletionCounts(tasks: Task[]): Record<TaskCategory, number> {
  const counts: Record<TaskCategory, number> = { Study: 0, Exercise: 0, Clean: 0, Health: 0, Personal: 0 };
  for (const task of tasks) {
    counts[task.category] += countCompletedOccurrences(task);
  }
  return counts;
}

// Completed-occurrence count restricted to Important-flagged tasks, for the
// Stats page's Lifetime Stats card. Same counting rule again, just filtered.
export function getImportantCompletedCount(tasks: Task[]): number {
  return tasks.reduce(
    (count, task) => (task.important ? count + countCompletedOccurrences(task) : count),
    0
  );
}
