import { MOODS, type Mood } from '@/utils/mood';
import type { MoodEntry } from '@/utils/mood-log';

// Pure helpers over the saved mood check-ins (see @/utils/mood-log.ts) for
// the My Mood Journey and Year in Review pages. Moods are never ranked as
// good or bad here, and a day with no check-in is simply "no entry" — it is
// never counted as a mood of any kind.

// One consistent color per mood across every chart, pie and calendar.
export const MOOD_COLORS: Record<Mood, string> = {
  Happy: '#FFD98E',
  Calm: '#A9D6E8',
  Focused: '#B9A3E6',
  Stressed: '#F4A6BB',
  Tired: '#F6C99A',
  Sick: '#9FDDBB',
};

// Color for a calendar day that has no recorded mood.
export const NO_ENTRY_COLOR = 'rgba(150, 130, 160, 0.14)';

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISO(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

export function entriesOnDate(entries: MoodEntry[], dateISO: string): MoodEntry[] {
  return entries.filter((entry) => entry.dateISO === dateISO).sort((a, b) => (a.at < b.at ? -1 : 1));
}

export function entriesInYear(entries: MoodEntry[], year: number): MoodEntry[] {
  return entries.filter((entry) => entry.dateISO.startsWith(`${year}-`));
}

export function entriesInMonth(entries: MoodEntry[], year: number, month0: number): MoodEntry[] {
  return entries.filter((entry) => entry.dateISO.startsWith(`${year}-${pad2(month0 + 1)}-`));
}

// The calendars' rule when a day has several check-ins: show the LATEST one
// recorded that day (all of them are still kept and listed in the day view).
export function latestMoodByDate(entries: MoodEntry[]): Map<string, Mood> {
  const latest = new Map<string, MoodEntry>();
  for (const entry of entries) {
    const current = latest.get(entry.dateISO);
    if (!current || entry.at > current.at) latest.set(entry.dateISO, entry);
  }
  const result = new Map<string, Mood>();
  latest.forEach((entry, date) => result.set(date, entry.mood));
  return result;
}

export function countByMood(entries: MoodEntry[]): Record<Mood, number> {
  const counts = { Happy: 0, Calm: 0, Focused: 0, Stressed: 0, Tired: 0, Sick: 0 } as Record<Mood, number>;
  for (const entry of entries) counts[entry.mood] += 1;
  return counts;
}

// Most frequently recorded mood, or null with no entries. A tie goes to the
// mood that comes first in the Home picker's order.
export function mostFrequentMood(entries: MoodEntry[]): Mood | null {
  if (entries.length === 0) return null;
  const counts = countByMood(entries);
  let best: Mood = MOODS[0];
  for (const mood of MOODS) if (counts[mood] > counts[best]) best = mood;
  return counts[best] > 0 ? best : null;
}

// Number of distinct calendar days with at least one check-in.
export function distinctDays(entries: MoodEntry[]): number {
  return new Set(entries.map((entry) => entry.dateISO)).size;
}

// Check-ins per month for a year (12 numbers, Jan..Dec).
export function monthlyCounts(entries: MoodEntry[], year: number): number[] {
  const counts = new Array<number>(12).fill(0);
  for (const entry of entriesInYear(entries, year)) {
    const month = Number(entry.dateISO.slice(5, 7)) - 1;
    if (month >= 0 && month < 12) counts[month] += 1;
  }
  return counts;
}

export const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// A short, neutral sentence about the recorded pattern — facts only, no
// judgment and no guessing about why anything was felt.
export function describeMoodPattern(entries: MoodEntry[]): string {
  if (entries.length === 0) {
    return 'No mood check-ins yet. Pick a mood on the Home page whenever you feel like checking in.';
  }
  const counts = countByMood(entries);
  const top = mostFrequentMood(entries);
  const days = distinctDays(entries);
  const parts = [
    `You've checked in ${entries.length} ${entries.length === 1 ? 'time' : 'times'} across ${days} ${days === 1 ? 'day' : 'days'}.`,
  ];
  if (top) {
    parts.push(`${top} is the mood you've recorded most (${counts[top]} of ${entries.length}).`);
  }
  const variety = MOODS.filter((mood) => counts[mood] > 0).length;
  if (variety > 1) parts.push(`You've recorded ${variety} different moods so far.`);
  return parts.join(' ');
}
