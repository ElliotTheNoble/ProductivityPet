// Whether the task editor holds changes that were not saved (Stage 4.2 follow-up; see @/utils/unfinished-work.ts). Pure: it compares
// what the form shows now with what it showed when it was opened, so merely opening the editor is not a change, and putting every
// field back as it was clears it again. Nothing here is stored.
export type TaskEditSnapshot = {
  kind: string;
  text: string;
  date: string;
  time: string;
  repeat: 'none' | 'daily' | 'weekly';
  // Only matters while the repeat is weekly.
  weeklyDays: readonly number[];
  reminder: string;
  // The room the form shows (the task's own, or the inferred one while it has none).
  room: string | null | undefined;
};

const sameDays = (a: readonly number[], b: readonly number[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((day) => right.has(day));
};

export function taskEditChanged(initial: TaskEditSnapshot, current: TaskEditSnapshot): boolean {
  if (current.kind !== initial.kind) return true;
  if (current.text.trim() !== initial.text.trim()) return true;
  if (current.date.trim() !== initial.date.trim()) return true;
  if (current.time.trim() !== initial.time.trim()) return true;
  if (current.repeat !== initial.repeat) return true;
  if (current.repeat === 'weekly' && !sameDays(current.weeklyDays, initial.weeklyDays)) return true;
  if (current.reminder !== initial.reminder) return true;
  return current.room !== initial.room;
}
