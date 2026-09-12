import { categorizeTask, type TaskCategory } from '@/utils/categorize-task';

export type RepeatRule = { kind: 'daily' } | { kind: 'weekly'; days: number[] };

export type TaskKind = 'task' | 'event';

// Minutes before the item's time a reminder notification should fire; 0
// means "at the scheduled time".
export type ReminderOffsetMinutes = 0 | 10 | 30 | 60;

export const REMINDER_OFFSETS: ReminderOffsetMinutes[] = [0, 10, 30, 60];

export function reminderOffsetLabel(minutes: ReminderOffsetMinutes): string {
  switch (minutes) {
    case 0:
      return 'At time';
    case 10:
      return '10 min before';
    case 30:
      return '30 min before';
    case 60:
      return '1 hour before';
  }
}

// The full persisted shape. `date`/`kind`/`repeat` were added for the
// planner/calendar feature — see normalizeTask() for how older saved tasks
// (which have none of these fields) are given safe defaults on load.
export type Task = {
  id: string;
  text: string;
  category: TaskCategory;
  important: boolean;
  kind: TaskKind;
  date: string; // ISO 'YYYY-MM-DD'
  time?: string; // optional 'HH:MM', mainly for appointments/events
  repeat?: RepeatRule;
  // Last date (inclusive) the recurrence still applies — set by "stop
  // repeating from this date forward". Dates at or before this (including
  // completedDates) are completely unaffected; only occursOnDate() for
  // later dates is affected. Undefined means "repeats indefinitely".
  repeatUntil?: string;
  // Individual occurrence dates removed via "remove just this day", without
  // touching the rest of the series or its history.
  excludedDates?: string[];
  // Authoritative completion state for one-time tasks. Ignored for
  // repeating tasks (see completedDates) and for events (never completable).
  completed: boolean;
  // Authoritative completion state for repeating tasks only: the list of
  // dates on which that occurrence was checked off, since one repeating
  // task can be done on one date and not another. Entries here are never
  // removed by stopping or deleting an occurrence — this is what keeps pet
  // progress (getCompletedTaskCount) from ever decreasing.
  completedDates?: string[];
  // Optional local reminder — only meaningful when `time` is set. undefined
  // means "no reminder". Read only by src/utils/notifications.ts; never
  // touched by anything that computes history or pet progress.
  reminderMinutesBefore?: ReminderOffsetMinutes;
  // Scheduling bookkeeping only (managed by notifications.ts): the OS
  // notification id currently scheduled for this item, and which occurrence
  // date it targets, so a stale schedule can be recognized and replaced.
  scheduledNotificationId?: string;
  scheduledNotificationFor?: string;
};

// What list-row UI components (TaskCard, the Tasks-tab day list) render —
// always a single, already-resolved occurrence, decoupled from whether the
// underlying task is one-time or repeating.
export type DisplayTask = {
  id: string;
  text: string;
  completed: boolean;
  category: TaskCategory;
  important: boolean;
  isRepeating: boolean;
  time?: string;
};

// A read-only appointment row for a single date — appointments never have a
// completion state and never affect pet progress.
export type DisplayAppointment = {
  id: string;
  text: string;
  category: TaskCategory;
  time?: string;
  isRepeating: boolean;
};

export function dateToISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO(): string {
  return dateToISO(new Date());
}

export function addDaysISO(dateISO: string, delta: number): string {
  const date = new Date(`${dateISO}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return dateToISO(date);
}

// e.g. "Friday, September 11, 2026" — shared by Home's date-under-the-title
// and the Tasks-tab calendar's selected-day heading, so both read identically.
export function formatFullDate(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// Repairs tasks saved before dates/repeats/events existed: stamps them with
// a concrete date (today, at the moment of this upgrade) and a default
// kind, so they immediately show up under "today" instead of disappearing
// from a now date-filtered list. Every other field — `completed` especially,
// since pet progress depends on it — is carried over untouched.
export function normalizeTask(raw: any, fallbackDate: string): Task {
  return {
    id: raw.id,
    text: raw.text,
    category: raw.category,
    important: !!raw.important,
    kind: raw.kind === 'event' ? 'event' : 'task',
    date: typeof raw.date === 'string' ? raw.date : fallbackDate,
    time: typeof raw.time === 'string' ? raw.time : undefined,
    repeat: raw.repeat,
    repeatUntil: typeof raw.repeatUntil === 'string' ? raw.repeatUntil : undefined,
    excludedDates: Array.isArray(raw.excludedDates) ? raw.excludedDates : undefined,
    completed: !!raw.completed,
    completedDates: Array.isArray(raw.completedDates) ? raw.completedDates : undefined,
    reminderMinutesBefore: REMINDER_OFFSETS.includes(raw.reminderMinutesBefore)
      ? raw.reminderMinutesBefore
      : undefined,
    scheduledNotificationId:
      typeof raw.scheduledNotificationId === 'string' ? raw.scheduledNotificationId : undefined,
    scheduledNotificationFor:
      typeof raw.scheduledNotificationFor === 'string' ? raw.scheduledNotificationFor : undefined,
  };
}

// Whether a task (one-time, daily-repeating, or weekly-repeating) occurs on
// a given calendar date. ISO 'YYYY-MM-DD' strings compare correctly with
// plain string comparison, so no Date parsing is needed for the range check.
export function occursOnDate(task: Task, dateISO: string): boolean {
  if (task.excludedDates?.includes(dateISO)) return false;
  if (!task.repeat) return task.date === dateISO;
  if (dateISO < task.date) return false;
  if (task.repeatUntil && dateISO > task.repeatUntil) return false;
  if (task.repeat.kind === 'daily') return true;
  const weekday = new Date(`${dateISO}T00:00:00`).getDay();
  return task.repeat.days.includes(weekday);
}

export function isOccurrenceCompleted(task: Task, dateISO: string): boolean {
  if (!task.repeat) return task.completed;
  return (task.completedDates ?? []).includes(dateISO);
}

export function getTasksForDate(tasks: Task[], dateISO: string): Task[] {
  return tasks.filter((task) => occursOnDate(task, dateISO));
}

// Reorders a list so Important items come first, purely for display — a
// stable sort (guaranteed by the JS spec since ES2019), so items keep their
// existing relative order within each group. Doesn't touch dates, repeat
// rules, completion state, or history; safe for both Home's Today's Tasks
// and the Tasks-tab day list.
export function sortByImportantFirst<T extends { important: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.important) - Number(a.important));
}

// Lifetime completed-occurrence count that drives pet progress. Events never
// count. For pre-existing saved data (no repeat, no events) this reduces to
// exactly the old `tasks.filter(t => t.completed).length`, so progress can
// only grow, never shrink, when this feature is introduced.
export function getCompletedTaskCount(tasks: Task[]): number {
  return tasks.reduce((count, task) => {
    if (task.kind === 'event') return count;
    if (task.repeat) return count + (task.completedDates?.length ?? 0);
    return count + (task.completed ? 1 : 0);
  }, 0);
}

export function toggleTaskOccurrence(tasks: Task[], id: string, dateISO: string): Task[] {
  return tasks.map((task) => {
    if (task.id !== id) return task;
    if (!task.repeat) return { ...task, completed: !task.completed };
    const dates = task.completedDates ?? [];
    const isDone = dates.includes(dateISO);
    return {
      ...task,
      completedDates: isDone ? dates.filter((d) => d !== dateISO) : [...dates, dateISO],
    };
  });
}

// "Stop repeating from this date forward": every date before `fromDateISO`
// keeps occurring exactly as before (including past completions, which stay
// in completedDates and keep counting toward pet progress); `fromDateISO`
// and everything after it stops showing up. Calling this more than once (or
// with a later date than an existing stop) never re-extends the series.
export function stopRepeatingFrom(tasks: Task[], id: string, fromDateISO: string): Task[] {
  return tasks.map((task) => {
    if (task.id !== id || !task.repeat) return task;
    const dayBefore = addDaysISO(fromDateISO, -1);
    const repeatUntil =
      task.repeatUntil !== undefined && task.repeatUntil < dayBefore ? task.repeatUntil : dayBefore;
    return { ...task, repeatUntil };
  });
}

// "Remove just this day": hides a single occurrence of a repeating task
// without touching the rest of the series or any completion history.
export function excludeDateFromTask(tasks: Task[], id: string, dateISO: string): Task[] {
  return tasks.map((task) => {
    if (task.id !== id) return task;
    const excluded = task.excludedDates ?? [];
    if (excluded.includes(dateISO)) return task;
    return { ...task, excludedDates: [...excluded, dateISO] };
  });
}

// Updates a task's editable fields (name/date/time/repeat/reminder) in
// place. Everything else on the record — id, kind, important, completed,
// completedDates, repeatUntil, excludedDates — is spread through untouched,
// so editing can never disturb completion history, pet progress, Important
// status, or an existing Stop Repeating / Remove Just This Day state.
// scheduledNotificationId/scheduledNotificationFor are also left as-is here;
// syncTaskNotifications() reconciles them separately after this runs.
export function editTaskDetails(
  tasks: Task[],
  id: string,
  changes: {
    text: string;
    date: string;
    time?: string;
    repeat?: RepeatRule;
    reminderMinutesBefore?: ReminderOffsetMinutes;
  }
): Task[] {
  return tasks.map((task) => {
    if (task.id !== id) return task;
    return {
      ...task,
      text: changes.text,
      category: categorizeTask(changes.text),
      date: changes.date,
      time: changes.time,
      repeat: changes.repeat,
      reminderMinutesBefore: changes.reminderMinutesBefore,
    };
  });
}

// Same guarantee as editTaskDetails, for an appointment's name/date/time/reminder.
export function editAppointmentDetails(
  tasks: Task[],
  id: string,
  changes: { text: string; date: string; time?: string; reminderMinutesBefore?: ReminderOffsetMinutes }
): Task[] {
  return tasks.map((task) => {
    if (task.id !== id) return task;
    return {
      ...task,
      text: changes.text,
      category: categorizeTask(changes.text),
      date: changes.date,
      time: changes.time,
      reminderMinutesBefore: changes.reminderMinutesBefore,
    };
  });
}

export function createTask(input: {
  text: string;
  kind: TaskKind;
  date: string;
  time?: string;
  repeat?: RepeatRule;
  reminderMinutesBefore?: ReminderOffsetMinutes;
}): Task {
  return {
    id: Date.now().toString(),
    text: input.text,
    category: categorizeTask(input.text),
    important: false,
    kind: input.kind,
    date: input.date,
    time: input.time,
    repeat: input.repeat,
    reminderMinutesBefore: input.reminderMinutesBefore,
    completed: false,
    completedDates: input.repeat ? [] : undefined,
  };
}
