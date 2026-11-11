import {
  MISSED_ESTIMATE_DAYS,
  historyStartISO,
  buildActivity,
  buildAssignedSummary,
  buildMilestones,
  buildStreak,
  buildTaskStatus,
  buildTokenSummary,
  weekStartISO,
} from '@/utils/child-activity-model';
import type { HouseholdTask } from '@/utils/household';
import { getCompletedTaskCount, normalizeTask, type Task } from '@/utils/tasks';
import type { TokenEvent } from '@/utils/token-history';

// The numbers behind the Parent Dashboard's task, accomplishment and activity sections: pure rules, tested to the day.
// 2026-03-10 is a Tuesday. (Tests run in America/Chicago; daylight saving began on 2026-03-08.)

const TODAY = '2026-03-10';

let seq = 0;
function task(over: Partial<Task> = {}): Task {
  seq += 1;
  return { id: `t${seq}`, text: `Task ${seq}`, category: 'Personal', important: false, kind: 'task', date: TODAY, completed: false, ...over };
}
const repeating = (over: Partial<Task> = {}) => task({ repeat: { kind: 'daily' }, completedDates: [], ...over });
const event = (id: string, dateISO: string, amount: number, source: TokenEvent['source'] = 'task'): TokenEvent => ({
  id,
  at: `${dateISO}T15:00:00.000Z`,
  dateISO,
  amount,
  source,
});

describe('tasks today', () => {
  test('one-time tasks are sorted by their date: to do today, coming up, past its date and not done; done ones are in none of them', () => {
    const list = [
      task({ text: 'today', date: TODAY }),
      task({ text: 'tomorrow', date: '2026-03-11' }),
      task({ text: 'later', date: '2026-04-01' }),
      task({ text: 'yesterday', date: '2026-03-09' }),
      task({ text: 'last month', date: '2026-02-01' }),
      task({ text: 'done today', date: TODAY, completed: true, completedAt: '2026-03-10T14:00:00.000Z' }),
      task({ text: 'done long ago', date: '2026-01-01', completed: true, completedAt: '2026-01-01T14:00:00.000Z' }),
    ];
    const s = buildTaskStatus(list, TODAY);
    expect(s.dueToday.map((l) => l.text)).toEqual(['today']);
    expect(s.upcoming.map((l) => l.text)).toEqual(['tomorrow', 'later']);
    expect(s.pastDueNotDone.map((l) => l.text)).toEqual(['last month', 'yesterday']);
    expect(s.doneTodayCount).toBe(1);
  });

  test('appointments and birthdays are not tasks: never listed, never counted', () => {
    const list = [
      task({ kind: 'event', date: '2026-03-01' }),
      task({ kind: 'birthday', date: '2026-02-01', repeat: { kind: 'yearly' } }),
      task({ kind: 'event', date: TODAY, completed: true }),
    ];
    const s = buildTaskStatus(list, TODAY);
    expect([s.dueToday, s.upcoming, s.pastDueNotDone, s.noDueDate, s.repeatingEstimate.items].map((x) => x.length)).toEqual([0, 0, 0, 0, 0]);
    expect(s.completed).toEqual({ total: 0, important: 0, undated: 0 });
  });

  test('a task with no usable date is "no due date" and is never counted as past due', () => {
    const noDate = normalizeTask({ id: 'x', text: 'no date saved', category: 'Personal', completed: false }, '');
    expect(noDate.date).toBe('');
    const s = buildTaskStatus([noDate], TODAY);
    expect(s.noDueDate.map((l) => l.text)).toEqual(['no date saved']);
    expect(s.noDueDate[0].dateISO).toBeNull();
    expect(s.pastDueNotDone).toEqual([]);
    expect(s.upcoming).toEqual([]);
  });

  test('a repeating task that occurs today is to do until its occurrence is marked done', () => {
    const open = repeating({ text: 'brush teeth', date: '2026-03-01' });
    const done = repeating({ text: 'feed fish', date: '2026-03-01', completedDates: [TODAY] });
    const s = buildTaskStatus([open, done], TODAY);
    expect(s.dueToday.map((l) => l.text)).toEqual(['brush teeth']);
    expect(s.doneTodayCount).toBe(1);
    expect(s.activeRepeatingCount).toBe(2);
  });

  test('a repeating task that was stopped before today is not active and not due', () => {
    const stopped = repeating({ date: '2026-01-01', repeatUntil: '2026-02-01' });
    const s = buildTaskStatus([stopped], TODAY);
    expect(s.activeRepeatingCount).toBe(0);
    expect(s.dueToday).toEqual([]);
    expect(s.repeatingEstimate.total).toBe(0);
  });
});

describe('repeating tasks: the "possibly missed" ESTIMATE', () => {
  test('is limited to the last 30 days and to dates on or after the task\'s own start date', () => {
    expect(MISSED_ESTIMATE_DAYS).toBe(30);
    const old = repeating({ text: 'old daily', date: '2025-01-01' });
    const fresh = repeating({ text: 'fresh daily', date: '2026-03-07' });
    const s = buildTaskStatus([old, fresh], TODAY);
    expect(s.repeatingEstimate.windowStart).toBe('2026-02-08');
    expect(s.repeatingEstimate.windowEnd).toBe('2026-03-09'); // yesterday: today is still to do, never "missed"
    const dates = (text: string) => s.repeatingEstimate.items.find((i) => i.text === text)!.dates;
    expect(dates('old daily')).toHaveLength(30);
    expect(dates('old daily')[0]).toBe('2026-02-08');
    expect(dates('fresh daily')).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    expect(s.repeatingEstimate.total).toBe(33);
  });

  test('occurrences marked done, removed days and weekdays that do not occur are not in it', () => {
    const t = task({
      text: 'mondays',
      date: '2026-02-01',
      repeat: { kind: 'weekly', days: [1] }, // Monday
      completedDates: ['2026-03-02'],
      excludedDates: ['2026-02-16'],
    });
    const s = buildTaskStatus([t], TODAY);
    // Mondays from 2026-02-08: 02-09, 02-16 (removed), 02-23, 03-02 (done), 03-09
    expect(s.repeatingEstimate.items[0].dates).toEqual(['2026-02-09', '2026-02-23', '2026-03-09']);
  });

  test('a series stopped partway only contributes the dates before it stopped', () => {
    const t = repeating({ text: 'stopped', date: '2026-02-01', repeatUntil: '2026-02-12' });
    const s = buildTaskStatus([t], TODAY);
    expect(s.repeatingEstimate.items[0].dates).toEqual(['2026-02-08', '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12']);
  });

  test('a series with no start date is never estimated', () => {
    const t = normalizeTask({ id: 'r', text: 'undated repeater', category: 'Personal', repeat: { kind: 'daily' }, completedDates: [] }, '');
    const s = buildTaskStatus([t], TODAY);
    expect(s.repeatingEstimate.total).toBe(0);
    expect(s.noDueDate.map((l) => l.text)).toEqual(['undated repeater']);
  });

  test('a one-time task is never part of the estimate', () => {
    const s = buildTaskStatus([task({ date: '2026-03-01' })], TODAY);
    expect(s.repeatingEstimate.total).toBe(0);
    expect(s.pastDueNotDone).toHaveLength(1);
  });
});

describe('completed so far matches the app\'s own count', () => {
  test('the total is the same number the child\'s Stats page shows, undated ones and important ones counted separately', () => {
    const list = [
      task({ completed: true, completedAt: '2026-03-01T10:00:00.000Z', important: true }),
      task({ completed: true }), // completed before completion dates were recorded: undated
      repeating({ date: '2026-03-01', completedDates: ['2026-03-02', '2026-03-03'], important: true }),
      task({ kind: 'event', completed: true }),
    ];
    const s = buildTaskStatus(list, TODAY);
    expect(s.completed.total).toBe(getCompletedTaskCount(list));
    expect(s.completed).toEqual({ total: 4, important: 3, undated: 1 });
  });

  test('streaks use the same rule and are separate from counts', () => {
    const list = [repeating({ date: '2026-03-01', completedDates: ['2026-03-08', '2026-03-09', '2026-03-10'] })];
    expect(buildStreak(list, TODAY)).toEqual({ current: 3, longest: 3, undated: 0 });
  });
});

describe('tasks assigned by the parent are a separate list', () => {
  const assigned = (id: string, status: HouseholdTask['status']): HouseholdTask => ({ id, text: `Assigned ${id}`, createdBy: 'parent', status, createdAt: '2026-03-01T10:00:00.000Z' });

  test('grouped by status, counted on their own, never added to the child\'s own task numbers', () => {
    const summary = buildAssignedSummary([assigned('a', 'assigned'), assigned('b', 'pending'), assigned('c', 'approved'), assigned('d', 'completed'), assigned('e', 'assigned')]);
    expect(summary.total).toBe(5);
    expect(summary.byStatus.assigned.map((t) => t.id)).toEqual(['a', 'e']);
    const own = buildTaskStatus([task({ text: 'own task', completed: true, completedAt: '2026-03-02T10:00:00.000Z' })], TODAY);
    expect(own.completed.total).toBe(1); // the four assigned ones that are approved or done are not in it
  });

  test('nothing assigned is an empty summary', () => {
    expect(buildAssignedSummary([])).toEqual({ total: 0, byStatus: { assigned: [], pending: [], approved: [], completed: [] } });
  });
});

describe('accomplishments', () => {
  test('only real milestones are listed (not getting sick), newest first, with their local date; a bad date is skipped', () => {
    const list = buildMilestones([
      {
        id: 'p1',
        label: 'Biscuit',
        events: [
          { type: 'adopted', at: '2026-01-05T15:00:00.000Z' },
          { type: 'hatched', at: '2026-02-01T15:00:00.000Z' },
          { type: 'sick', at: '2026-02-10T15:00:00.000Z' },
          { type: 'critical', at: '2026-02-11T15:00:00.000Z' },
          { type: 'recovered', at: '2026-02-12T15:00:00.000Z' },
          { type: 'hatched', at: 'not a date' },
        ],
      },
      { id: 'p2', label: 'Luna', events: [{ type: 'retired', at: '2026-03-01T15:00:00.000Z' }] },
    ]);
    expect(list.map((m) => `${m.petLabel}:${m.kind}`)).toEqual(['Luna:retired', 'Biscuit:recovered', 'Biscuit:hatched', 'Biscuit:adopted']);
    expect(list[0].dateISO).toBe('2026-03-01');
  });

  test('Paw Tokens are summed by source, and the start of tracking is kept', () => {
    const summary = buildTokenSummary([event('a', '2026-03-01', 3), event('b', '2026-03-02', 5, 'kitty-catch'), event('c', '2026-03-03', 2, 'task')], '2026-02-20T15:00:00.000Z');
    expect(summary).toMatchObject({ total: 10, eventCount: 3, startedISO: '2026-02-20' });
    expect(summary.bySource).toEqual({ task: 5, appointment: 0, 'kitty-catch': 5, 'memory-match': 0 });
  });
});

describe('activity history', () => {
  const tasks = [
    task({ completed: true, completedAt: '2026-03-10T16:00:00.000Z' }), // Tuesday
    task({ completed: true, completedAt: '2026-03-08T16:00:00.000Z' }), // Sunday
    task({ completed: true, completedAt: '2026-03-07T16:00:00.000Z' }), // Saturday
    task({ completed: true }), // undated: never placed on a day
    repeating({ date: '2026-02-20', completedDates: ['2026-03-09', '2026-03-10', '2026-02-27'] }),
    task({ completed: true, completedAt: '2026-03-20T16:00:00.000Z' }), // in the future: ignored
  ];
  const input = { tasks, tokens: null, milestones: [] };
  const completedOn = (b: { tasksCompleted: number }[]) => b.map((x) => x.tasksCompleted);

  test('day: the last seven days, newest first, each day\'s own completions', () => {
    const days = buildActivity('day', TODAY, input);
    expect(days.map((d) => d.key)).toEqual(['2026-03-10', '2026-03-09', '2026-03-08', '2026-03-07', '2026-03-06', '2026-03-05', '2026-03-04']);
    expect(completedOn(days)).toEqual([2, 1, 1, 1, 0, 0, 0]);
  });

  test('week: Sunday to Saturday (Sunday 03-08 and Saturday 03-07 are in different weeks)', () => {
    expect(weekStartISO('2026-03-10')).toBe('2026-03-08');
    expect(weekStartISO('2026-03-08')).toBe('2026-03-08');
    expect(weekStartISO('2026-03-07')).toBe('2026-03-01');
    const weeks = buildActivity('week', TODAY, input);
    expect(weeks.map((w) => w.startISO).slice(0, 3)).toEqual(['2026-03-08', '2026-03-01', '2026-02-22']);
    expect(weeks[0]).toMatchObject({ startISO: '2026-03-08', endISO: '2026-03-14', tasksCompleted: 4 }); // 08, 09, 10 (two)
    expect(weeks[1].tasksCompleted).toBe(1); // 03-07 only
    expect(weeks[2].tasksCompleted).toBe(1); // 02-27
  });

  test('month: twelve months back, with the right last day (a leap February has 29 days)', () => {
    const months = buildActivity('month', TODAY, input);
    expect(months.map((m) => m.key)).toEqual(['2026-03', '2026-02']); // the history begins on 2026-02-27: nothing earlier is listed
    expect(months[0]).toMatchObject({ key: '2026-03', startISO: '2026-03-01', endISO: '2026-03-31', tasksCompleted: 5 });
    expect(months[1]).toMatchObject({ key: '2026-02', endISO: '2026-02-28', tasksCompleted: 1 });
    const leap = buildActivity('month', '2024-03-05', { tasks: [task({ completed: true, completedAt: '2024-02-29T16:00:00.000Z' })], tokens: null, milestones: [] });
    expect(leap[1]).toMatchObject({ key: '2024-02', endISO: '2024-02-29', tasksCompleted: 1 });
    // a longer history lists up to twelve months
    const long = buildActivity('month', TODAY, { tasks: [task({ completed: true, completedAt: '2025-01-15T16:00:00.000Z' })], tokens: null, milestones: [] });
    expect(long).toHaveLength(12);
    expect(long[11].key).toBe('2025-04');
  });

  test('year: five years, this year first', () => {
    const years = buildActivity('year', TODAY, input);
    expect(years.map((y) => y.key)).toEqual(['2026']); // nothing was recorded before 2026
    expect(years[0].tasksCompleted).toBe(6); // 5 dated in March + 1 in February; the future one and the undated one are not counted
    const older = buildActivity('year', TODAY, { tasks: [task({ completed: true, completedAt: '2023-06-01T16:00:00.000Z' })], tokens: null, milestones: [] });
    expect(older.map((y) => y.key)).toEqual(['2026', '2025', '2024', '2023']);
    expect(older.map((y) => y.tasksCompleted)).toEqual([0, 0, 0, 1]);
  });

  test('the same completion is counted once in every period that contains it, and the pieces add up to the whole', () => {
    const days = buildActivity('day', TODAY, input);
    const months = buildActivity('month', TODAY, input);
    expect(days.reduce((sum, d) => sum + d.tasksCompleted, 0)).toBe(5);
    expect(months[0].tasksCompleted).toBe(5);
  });

  test('Paw Tokens: tracked, partial, before tracking began (null, never 0) and not recorded at all', () => {
    const tokens = { events: [event('a', '2026-03-09', 4), event('b', '2026-03-10', 6)], startedISO: '2026-03-08' };
    // the child used the app (completed a task) before Paw Token tracking began, so the history starts earlier than the tokens do
    const early = [task({ completed: true, completedAt: '2026-02-10T16:00:00.000Z' })];
    const days = buildActivity('day', TODAY, { tasks: early, tokens, milestones: [] });
    const byDay = Object.fromEntries(days.map((d) => [d.key, [d.tokens, d.tokenCoverage]]));
    expect(byDay['2026-03-10']).toEqual([6, 'tracked']);
    expect(byDay['2026-03-09']).toEqual([4, 'tracked']);
    expect(byDay['2026-03-08']).toEqual([0, 'tracked']);
    expect(byDay['2026-03-07']).toEqual([null, 'before-tracking']);
    const weeks = buildActivity('week', TODAY, { tasks: early, tokens, milestones: [] });
    expect(weeks[0]).toMatchObject({ tokens: 10, tokenCoverage: 'tracked' });
    const months = buildActivity('month', TODAY, { tasks: early, tokens, milestones: [] });
    expect(months[0]).toMatchObject({ tokens: 10, tokenCoverage: 'partial' });
    expect(months[1]).toMatchObject({ tokens: null, tokenCoverage: 'before-tracking' });
    const none = buildActivity('day', TODAY, { tasks: early, tokens: null, milestones: [] });
    expect(none.every((d) => d.tokens === null && d.tokenCoverage === 'not-recorded')).toBe(true);
  });

  test('pet milestones land in the period of their local date', () => {
    const milestones = buildMilestones([{ id: 'p', label: 'Biscuit', events: [{ type: 'adopted', at: '2026-03-01T15:00:00.000Z' }, { type: 'hatched', at: '2026-03-09T15:00:00.000Z' }] }]);
    const days = buildActivity('day', TODAY, { tasks: [], tokens: null, milestones });
    expect(days.find((d) => d.key === '2026-03-09')!.milestones.map((m) => m.kind)).toEqual(['hatched']);
    expect(days.find((d) => d.key === '2026-03-10')!.milestones).toEqual([]);
  });

  test('days stay consecutive across the daylight saving change (2026-03-08)', () => {
    const days = buildActivity('day', '2026-03-10', { tasks: [task({ completed: true, completedAt: '2026-03-01T16:00:00.000Z' })], tokens: null, milestones: [] }).map((d) => d.key);
    expect(new Set(days).size).toBe(7);
    expect(days).toContain('2026-03-08');
    expect(days).toContain('2026-03-07');
  });

  test('nothing saved means no periods at all: nothing is listed and nothing is invented', () => {
    for (const period of ['day', 'week', 'month', 'year'] as const) {
      expect(buildActivity(period, TODAY, { tasks: [], tokens: null, milestones: [] })).toEqual([]);
    }
  });
});

describe('when the history begins', () => {
  const input = (over: Record<string, unknown> = {}) => ({ tasks: [] as Task[], tokens: null, milestones: [], firstPetISO: null, ...over });

  test('it is the EARLIEST date that something was really recorded (first pet, token history, a milestone, a completion), never the day a parent added the child', () => {
    expect(historyStartISO(input(), TODAY)).toBeNull();
    expect(historyStartISO(input({ firstPetISO: '2026-02-20' }), TODAY)).toBe('2026-02-20');
    expect(historyStartISO(input({ firstPetISO: '2026-02-20', tokens: { events: [], startedISO: '2026-02-18' } }), TODAY)).toBe('2026-02-18');
    const milestones = buildMilestones([{ id: 'p', label: 'B', events: [{ type: 'adopted', at: '2026-01-05T15:00:00.000Z' }] }]);
    expect(historyStartISO(input({ firstPetISO: '2026-02-20', milestones }), TODAY)).toBe('2026-01-05');
    const completed = [task({ completed: true, completedAt: '2025-12-24T16:00:00.000Z' })];
    expect(historyStartISO(input({ tasks: completed, milestones }), TODAY)).toBe('2025-12-24');
  });

  test('future dates and undated completions never set it', () => {
    const tasks = [task({ completed: true }), task({ completed: true, completedAt: '2026-04-01T16:00:00.000Z' })];
    expect(historyStartISO(input({ tasks }), TODAY)).toBeNull();
  });

  test('periods that ended before it are not listed; the period it falls in is; later empty periods are listed as empty', () => {
    const data = input({ firstPetISO: '2026-03-06' });
    const days = buildActivity('day', TODAY, data);
    expect(days.map((d) => d.key)).toEqual(['2026-03-10', '2026-03-09', '2026-03-08', '2026-03-07', '2026-03-06']);
    expect(days.every((d) => d.tasksCompleted === 0)).toBe(true); // after the start, nothing recorded: listed, empty
    const weeks = buildActivity('week', TODAY, data);
    expect(weeks.map((w) => w.startISO)).toEqual(['2026-03-08', '2026-03-01']); // the week containing 03-06 starts on 03-01
    expect(buildActivity('month', TODAY, data).map((m) => m.key)).toEqual(['2026-03']);
    expect(buildActivity('year', TODAY, data).map((y) => y.key)).toEqual(['2026']);
  });
});
