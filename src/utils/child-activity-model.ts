import { getAllCompletedEntries } from '@/utils/category-accomplishments';
import { finishedDateISO, type HouseholdTask, type HouseholdTaskStatus } from '@/utils/household';
import type { PetEventType } from '@/utils/pet-lifecycle-core';
import { getStreakSummary } from '@/utils/streaks';
import type { TokenEvent, TokenSource } from '@/utils/token-history';
import { addDaysISO, dateToISO, isOccurrenceCompleted, occursOnDate, type Task } from '@/utils/tasks';

// The numbers behind the Parent Dashboard's Tasks, Accomplishments and Activity History. PURE: everything is worked out from saved data that is
// passed in, and "today" is passed in too, so every rule can be tested to the day. Nothing here reads storage, writes anything or invents a
// value: a thing the saved data cannot establish is left out or labelled, never filled in.
//
// What the saved data can and cannot say (see features.md):
//  - CURRENT STATUS is read straight from the task list as it is today.
//  - HISTORY comes only from dated records: when a task was completed (repeating tasks: the occurrence dates; one-time tasks: completedAt,
//    which older saves lack), Paw Token earnings (tracked only since the history began), and pet milestones. Tasks that were deleted, and
//    completions that were un-checked, are gone from the list and are not counted.
//  - A MISSED task is never recorded. A one-time task that is past its date and not done is reported as exactly that. A repeating task has no
//    creation date, so its occurrences in the last 30 days that are not marked done are an ESTIMATE ("possibly missed"), never a verified fact.

export const MISSED_ESTIMATE_DAYS = 30;

// ---------------------------------------------------------------------------------------------------------
// tasks: where things stand today

export type TaskLine = { id: string; text: string; important: boolean; dateISO: string | null; repeating: boolean };

export type RepeatingGap = { id: string; text: string; important: boolean; dates: string[] };

export type TaskStatus = {
  asOf: string;
  // To do today: a one-time task dated today, or a repeating task that occurs today, and is not marked done.
  dueToday: TaskLine[];
  // How many of today's tasks are already done.
  doneTodayCount: number;
  // One-time tasks dated after today and not done.
  upcoming: TaskLine[];
  // One-time tasks dated BEFORE today and not marked done. Not called "missed": the saved list only says they are not done.
  pastDueNotDone: TaskLine[];
  // Tasks whose saved record has no usable date: never counted as past due.
  noDueDate: TaskLine[];
  // ESTIMATE: occurrences of repeating tasks in the last 30 days (before today) that are not marked done. Not verified missed history.
  repeatingEstimate: { windowStart: string; windowEnd: string; total: number; items: RepeatingGap[] };
  // Repeating tasks still running (not stopped before today).
  activeRepeatingCount: number;
  // Lifetime completions by the app's own counting rule (same number as the child's own Stats page).
  completed: { total: number; important: number; undated: number };
};

const byDateThenText = (a: TaskLine, b: TaskLine) => (a.dateISO ?? '') < (b.dateISO ?? '') ? -1 : (a.dateISO ?? '') > (b.dateISO ?? '') ? 1 : a.text.localeCompare(b.text);

function line(task: Task): TaskLine {
  return { id: task.id, text: task.text, important: task.important, dateISO: task.date === '' ? null : task.date, repeating: !!task.repeat };
}

// `tasks` as normalized by normalizeTask with an EMPTY fallback date: a task whose saved record had no date has date === '' here.
export function buildTaskStatus(tasks: Task[], today: string): TaskStatus {
  const real = tasks.filter((task) => task.kind === 'task');
  const dueToday: TaskLine[] = [];
  const upcoming: TaskLine[] = [];
  const pastDueNotDone: TaskLine[] = [];
  const noDueDate: TaskLine[] = [];
  const gaps: RepeatingGap[] = [];
  let doneTodayCount = 0;
  let activeRepeatingCount = 0;
  const windowStart = addDaysISO(today, -MISSED_ESTIMATE_DAYS);
  const windowEnd = addDaysISO(today, -1);

  for (const task of real) {
    if (task.date === '') {
      if (!(task.repeat ? false : task.completed)) noDueDate.push(line(task));
      continue;
    }
    if (task.repeat) {
      if (!task.repeatUntil || task.repeatUntil >= today) activeRepeatingCount += 1;
      if (occursOnDate(task, today)) {
        if (isOccurrenceCompleted(task, today)) doneTodayCount += 1;
        else dueToday.push(line(task));
      }
      const dates: string[] = [];
      for (let date = windowStart < task.date ? task.date : windowStart; date <= windowEnd; date = addDaysISO(date, 1)) {
        if (occursOnDate(task, date) && !isOccurrenceCompleted(task, date)) dates.push(date);
      }
      if (dates.length > 0) gaps.push({ id: task.id, text: task.text, important: task.important, dates });
      continue;
    }
    if (task.completed) {
      if (task.date === today) doneTodayCount += 1;
      continue;
    }
    if (task.date === today) dueToday.push(line(task));
    else if (task.date > today) upcoming.push(line(task));
    else pastDueNotDone.push(line(task));
  }

  const entries = getAllCompletedEntries(real);
  return {
    asOf: today,
    dueToday: dueToday.sort(byDateThenText),
    doneTodayCount,
    upcoming: upcoming.sort(byDateThenText),
    pastDueNotDone: pastDueNotDone.sort(byDateThenText),
    noDueDate: noDueDate.sort(byDateThenText),
    repeatingEstimate: { windowStart, windowEnd, total: gaps.reduce((sum, gap) => sum + gap.dates.length, 0), items: gaps.sort((a, b) => a.text.localeCompare(b.text)) },
    activeRepeatingCount,
    completed: { total: entries.length, important: entries.filter((e) => e.important).length, undated: entries.filter((e) => e.dateISO === null).length },
  };
}

// ---------------------------------------------------------------------------------------------------------
// tasks assigned by the parent (the household list): kept apart from the child's own tasks and never added to them

export type AssignedSummary = {
  total: number;
  // `finishedISO`: the LOCAL date the task was approved / completed on (see finishedDateISO in @/utils/household.ts), null for a task that is not
  // finished. The overview lists only today's finished tasks; the others stay saved and are counted in Activity History.
  byStatus: Record<HouseholdTaskStatus, { id: string; text: string; finishedISO: string | null }[]>;
};

export function buildAssignedSummary(tasks: readonly HouseholdTask[]): AssignedSummary {
  const byStatus: AssignedSummary['byStatus'] = { assigned: [], pending: [], approved: [], completed: [] };
  for (const task of tasks) byStatus[task.status].push({ id: task.id, text: task.text, finishedISO: finishedDateISO(task) });
  return { total: tasks.length, byStatus };
}

// ---------------------------------------------------------------------------------------------------------
// accomplishments: only what was really recorded

// The pet events that are milestones. (Getting sick or critical is not an accomplishment and is not listed.)
export const MILESTONE_EVENTS = ['adopted', 'hatched', 'recovered', 'resurrected', 'retired', 'returned', 'died'] as const satisfies readonly PetEventType[];
export type MilestoneKind = (typeof MILESTONE_EVENTS)[number];

export type Milestone = { petId: string; petLabel: string; kind: MilestoneKind; at: string; dateISO: string };

export function buildMilestones(pets: readonly { id: string; label: string; events: readonly { type: string; at: string }[] }[]): Milestone[] {
  const out: Milestone[] = [];
  for (const pet of pets) {
    for (const event of pet.events) {
      if (!(MILESTONE_EVENTS as readonly string[]).includes(event.type)) continue;
      const when = new Date(event.at);
      if (Number.isNaN(when.getTime())) continue;
      out.push({ petId: pet.id, petLabel: pet.label, kind: event.type as MilestoneKind, at: event.at, dateISO: dateToISO(when) });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export const TOKEN_SOURCES = ['task', 'appointment', 'kitty-catch', 'memory-match'] as const satisfies readonly TokenSource[];

export type TokenSummary = { total: number; bySource: Record<TokenSource, number>; eventCount: number; startedAt: string; startedISO: string };

export function buildTokenSummary(events: readonly TokenEvent[], startedAt: string): TokenSummary {
  const bySource: Record<TokenSource, number> = { task: 0, appointment: 0, 'kitty-catch': 0, 'memory-match': 0 };
  for (const event of events) bySource[event.source] += event.amount;
  const started = new Date(startedAt);
  return {
    total: events.reduce((sum, event) => sum + event.amount, 0),
    bySource,
    eventCount: events.length,
    startedAt,
    startedISO: Number.isNaN(started.getTime()) ? '' : dateToISO(started),
  };
}

export function buildStreak(tasks: Task[], today: string): { current: number; longest: number; undated: number } {
  const summary = getStreakSummary(tasks.filter((task) => task.kind === 'task'), today);
  return { current: summary.current, longest: summary.longest, undated: summary.undatedCount };
}

// ---------------------------------------------------------------------------------------------------------
// activity history: day, week (Sunday to Saturday), month and year, from dated records only

export type ActivityPeriod = 'day' | 'week' | 'month' | 'year';

// 'tracked': the Paw Token history covers the whole period. 'partial': it began inside the period. 'before-tracking': it began after the
// period ended, so nothing was recorded then (shown as "not tracked", never as zero). 'not-recorded': this child has no token history at all.
export type TokenCoverage = 'tracked' | 'partial' | 'before-tracking' | 'not-recorded';

export type ActivityBucket = {
  key: string;
  startISO: string;
  endISO: string;
  tasksCompleted: number;
  // Household tasks (assigned by a parent) finished in the period, by the day the parent approved them. Kept apart from `tasksCompleted`.
  householdDone: number;
  tokens: number | null; // null when tokenCoverage says nothing was recorded for the period
  tokenCoverage: TokenCoverage;
  milestones: Milestone[];
};

export const BUCKET_COUNTS: Record<ActivityPeriod, number> = { day: 7, week: 8, month: 12, year: 5 };

const pad2 = (n: number) => String(n).padStart(2, '0');
const localDate = (iso: string) => new Date(`${iso}T00:00:00`);

export function weekStartISO(iso: string): string {
  return addDaysISO(iso, -localDate(iso).getDay()); // Sunday = 0: the week starts on Sunday, like the app's calendar
}

function ranges(period: ActivityPeriod, today: string): { startISO: string; endISO: string; key: string }[] {
  const out: { startISO: string; endISO: string; key: string }[] = [];
  const count = BUCKET_COUNTS[period];
  if (period === 'day') {
    for (let i = 0; i < count; i += 1) {
      const day = addDaysISO(today, -i);
      out.push({ startISO: day, endISO: day, key: day });
    }
  } else if (period === 'week') {
    const thisWeek = weekStartISO(today);
    for (let i = 0; i < count; i += 1) {
      const start = addDaysISO(thisWeek, -7 * i);
      out.push({ startISO: start, endISO: addDaysISO(start, 6), key: start });
    }
  } else if (period === 'month') {
    const base = localDate(today);
    for (let i = 0; i < count; i += 1) {
      const first = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
      const startISO = `${first.getFullYear()}-${pad2(first.getMonth() + 1)}-01`;
      out.push({ startISO, endISO: `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`, key: startISO.slice(0, 7) });
    }
  } else {
    const year = Number(today.slice(0, 4));
    for (let i = 0; i < count; i += 1) out.push({ startISO: `${year - i}-01-01`, endISO: `${year - i}-12-31`, key: String(year - i) });
  }
  return out;
}

export type ActivityInput = {
  tasks: Task[];
  // null = this child has no Paw Token history at all
  tokens: { events: readonly TokenEvent[]; startedISO: string } | null;
  milestones: readonly Milestone[];
  // The local dates ('YYYY-MM-DD') parent-assigned household tasks were finished on (see finishedDateISO in @/utils/household.ts).
  householdDone?: readonly string[];
  // The local date the child's first saved pet was created (the app makes the first pet the first time a child opens it), or null.
  firstPetISO?: string | null;
};

// When the child's history really begins: the EARLIEST date that something was actually recorded, from the saved records only: their first
// pet, the start of their Paw Token history, a pet milestone, or the date of a task completion. It is never the day a parent added the child
// (they may not have played yet) and never an invented date; null when nothing at all has been recorded.
export function historyStartISO(input: ActivityInput, today: string): string | null {
  const dates: string[] = [];
  if (input.firstPetISO) dates.push(input.firstPetISO);
  if (input.tokens && input.tokens.startedISO) dates.push(input.tokens.startedISO);
  for (const milestone of input.milestones) dates.push(milestone.dateISO);
  for (const date of input.householdDone ?? []) dates.push(date);
  for (const entry of getAllCompletedEntries(input.tasks.filter((task) => task.kind === 'task'))) if (entry.dateISO) dates.push(entry.dateISO);
  const valid = dates.filter((date) => date <= today).sort();
  return valid.length > 0 ? valid[0] : null;
}

// The periods from the child's first recorded day on, newest first. Periods that ended before that day are not listed at all (they are not
// "tracked"); a period after it with nothing in it is still listed, so the empty state is honest. Nothing recorded at all: no periods.
export function buildActivity(period: ActivityPeriod, today: string, input: ActivityInput): ActivityBucket[] {
  const start = historyStartISO(input, today);
  if (start === null) return [];
  const completions = getAllCompletedEntries(input.tasks.filter((task) => task.kind === 'task'))
    .map((entry) => entry.dateISO)
    .filter((date): date is string => date !== null && date <= today);
  return ranges(period, today).filter((range) => range.endISO >= start).map(({ startISO, endISO, key }) => {
    const inRange = (date: string) => date >= startISO && date <= endISO;
    let tokenCoverage: TokenCoverage;
    if (!input.tokens || input.tokens.startedISO === '') tokenCoverage = 'not-recorded';
    else if (endISO < input.tokens.startedISO) tokenCoverage = 'before-tracking';
    else if (startISO < input.tokens.startedISO) tokenCoverage = 'partial';
    else tokenCoverage = 'tracked';
    const tokens =
      input.tokens && (tokenCoverage === 'tracked' || tokenCoverage === 'partial')
        ? input.tokens.events.filter((event) => inRange(event.dateISO)).reduce((sum, event) => sum + event.amount, 0)
        : null;
    return {
      key,
      startISO,
      endISO,
      tasksCompleted: completions.filter(inRange).length,
      householdDone: (input.householdDone ?? []).filter((date) => date <= today && inRange(date)).length,
      tokens,
      tokenCoverage,
      milestones: input.milestones.filter((m) => inRange(m.dateISO)),
    };
  });
}
