import type { TaskRoom } from '@/utils/rooms';
import type { Task } from '@/utils/tasks';

// Which room a task belongs to — the ONE place this logic lives, reused
// by both the Rooms hub's task-count badges (see room-hub-screen.tsx) and
// every Room detail page's own task panel (see room-detail-screen.tsx),
// so a task's room membership can never read differently in one place
// than the other.
//
// Tasks now carry an explicit Task.room field (see @/utils/tasks.ts) —
// undefined/null/TaskRoom, three distinct states. An explicit value
// (including explicit null, "Unassigned") always wins. Only when room is
// undefined (a task saved before this field existed, and never since
// touched) does this fall back to the category/keyword inference below,
// which reproduces this app's original room-assignment rules exactly, so
// every pre-existing task keeps showing up in the same room it always did
// without needing any stored data to be rewritten.
function mentionsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(text);
}

// Legacy fallback ONLY — never consulted for a task that has an explicit
// Task.room (including explicit null). Picks exactly one room per task
// (first matching rule wins), unlike the pre-Task.room system, where each
// room's own count was evaluated independently and a task could in
// principle satisfy more than one room's rule at once. Collapsing that to
// a single inferred room is intentional here: the whole point of the
// explicit field is a task having at most one room, and a legacy task
// needs exactly one deterministic answer for which room it effectively
// occupies until a user gives it an explicit one.
function inferLegacyTaskRoom(task: Task): TaskRoom | null {
  if (task.category === 'Study') return 'study-room';
  if (task.category === 'Exercise') return 'gym';
  if (mentionsWord(task.text, 'kitchen')) return 'kitchen';
  if (mentionsWord(task.text, 'bathroom')) return 'bathroom';
  if (mentionsWord(task.text, 'bedroom')) return 'bedroom';
  if (task.category === 'Personal') return 'living-room';
  return null;
}

// The room this task effectively belongs to right now — explicit
// Task.room when present (including null, "Unassigned"), otherwise the
// legacy category/keyword inference above.
export function getTaskRoom(task: Task): TaskRoom | null {
  if (task.room !== undefined) return task.room;
  return inferLegacyTaskRoom(task);
}

export function isTaskForRoom(taskRoom: TaskRoom, task: Task): boolean {
  return getTaskRoom(task) === taskRoom;
}

export function getRoomTasks(taskRoom: TaskRoom, tasks: Task[]): Task[] {
  return tasks.filter((task) => isTaskForRoom(taskRoom, task));
}
