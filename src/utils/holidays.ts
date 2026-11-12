import { tr, type StringKey } from '@/i18n';
import { dateToISO } from '@/utils/tasks';

export type Holiday = {
  date: string; // ISO 'YYYY-MM-DD'
  name: string;
};

// Read-only system calendar events — entirely separate from the user's
// saved Task[] (never persisted to AsyncStorage, never created/edited/
// deleted through the task editor). Dates are computed fresh from the
// calendar year requested, not hard-coded, so they land on the correct day
// every year, including "floating" holidays like Thanksgiving.

// The nth (1-based) occurrence of `weekday` (0=Sun..6=Sat) in a given month.
// e.g. nthWeekdayOfMonth(2026, 0, 1, 3) = 3rd Monday of January 2026 (MLK Day).
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
  const firstOfMonth = new Date(year, month, 1);
  const offset = (weekday - firstOfMonth.getDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return dateToISO(new Date(year, month, day));
}

// The last occurrence of `weekday` in a given month.
// e.g. lastWeekdayOfMonth(2026, 4, 1) = last Monday of May 2026 (Memorial Day).
function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const lastOfMonth = new Date(year, month + 1, 0);
  const offset = (lastOfMonth.getDay() - weekday + 7) % 7;
  return dateToISO(new Date(year, month, lastOfMonth.getDate() - offset));
}

function fixedDate(year: number, month: number, day: number): string {
  return dateToISO(new Date(year, month, day));
}

function computeHolidaysForYear(year: number): Holiday[] {
  return [
    { date: fixedDate(year, 0, 1), name: "New Year's Day" },
    { date: nthWeekdayOfMonth(year, 0, 1, 3), name: 'Martin Luther King Jr. Day' },
    { date: fixedDate(year, 1, 14), name: "Valentine's Day" },
    { date: nthWeekdayOfMonth(year, 1, 1, 3), name: "Presidents' Day" },
    { date: lastWeekdayOfMonth(year, 4, 1), name: 'Memorial Day' },
    { date: fixedDate(year, 5, 19), name: 'Juneteenth' },
    { date: fixedDate(year, 6, 4), name: 'Independence Day' },
    { date: nthWeekdayOfMonth(year, 8, 1, 1), name: 'Labor Day' },
    { date: fixedDate(year, 9, 31), name: 'Halloween' },
    { date: fixedDate(year, 10, 11), name: 'Veterans Day' },
    { date: nthWeekdayOfMonth(year, 10, 4, 4), name: 'Thanksgiving' },
    { date: fixedDate(year, 11, 24), name: 'Christmas Eve' },
    { date: fixedDate(year, 11, 25), name: 'Christmas Day' },
    { date: fixedDate(year, 11, 31), name: "New Year's Eve" },
  ];
}

// Computed once per year and cached — the calendar grid looks this up for
// every visible day cell, and the math is the same every time for a given
// year, so there's no reason to recompute it repeatedly.
const holidaysByYear = new Map<number, Holiday[]>();

function getHolidaysForYear(year: number): Holiday[] {
  let holidays = holidaysByYear.get(year);
  if (!holidays) {
    holidays = computeHolidaysForYear(year);
    holidaysByYear.set(year, holidays);
  }
  return holidays;
}

// The one holiday (if any) that falls on a given date — this list has at
// most one match per date, so a single result is all that's ever needed.
export function getHolidayForDate(dateISO: string): Holiday | undefined {
  const year = Number(dateISO.slice(0, 4));
  const found = getHolidaysForYear(year).find((holiday) => holiday.date === dateISO);
  // The holiday list is stored with English names; the name shown follows the current language.
  return found ? { ...found, name: holidayDisplayName(found.name) } : undefined;
}

const HOLIDAY_NAME_KEYS: Record<string, StringKey> = {
  "New Year's Day": 'holidayNewYearsDay',
  "Martin Luther King Jr. Day": 'holidayMlkDay',
  "Valentine's Day": 'holidayValentines',
  "Presidents' Day": 'holidayPresidentsDay',
  "Memorial Day": 'holidayMemorialDay',
  "Juneteenth": 'holidayJuneteenth',
  "Independence Day": 'holidayIndependenceDay',
  "Labor Day": 'holidayLaborDay',
  "Halloween": 'holidayHalloween',
  "Veterans Day": 'holidayVeteransDay',
  "Thanksgiving": 'holidayThanksgiving',
  "Christmas Eve": 'holidayChristmasEve',
  "Christmas Day": 'holidayChristmasDay',
  "New Year's Eve": 'holidayNewYearsEve'
};

// A simple vector icon for each holiday (MaterialCommunityIcons, the icon set the app already ships), instead of one emoji for all of them.
// Vector icons draw the same on every Android device; emoji depend on the phone's font. Keyed by the English name, like the names above.
export type HolidayIcon =
  | 'party-popper'
  | 'ribbon'
  | 'heart'
  | 'bank'
  | 'flower'
  | 'star-circle'
  | 'firework'
  | 'hammer-wrench'
  | 'ghost'
  | 'medal'
  | 'turkey'
  | 'star-four-points'
  | 'pine-tree'
  | 'glass-cocktail';

const HOLIDAY_ICONS: Record<string, HolidayIcon> = {
  "New Year's Day": 'party-popper',
  'Martin Luther King Jr. Day': 'ribbon',
  "Valentine's Day": 'heart',
  "Presidents' Day": 'bank',
  'Memorial Day': 'flower',
  Juneteenth: 'star-circle',
  'Independence Day': 'firework',
  'Labor Day': 'hammer-wrench',
  Halloween: 'ghost',
  'Veterans Day': 'medal',
  Thanksgiving: 'turkey',
  'Christmas Eve': 'star-four-points',
  'Christmas Day': 'pine-tree',
  "New Year's Eve": 'glass-cocktail',
};

// The icon for the holiday on a date (none when it is not a holiday). Names, dates and the calendar logic are untouched.
export function getHolidayIconForDate(dateISO: string): HolidayIcon | undefined {
  const year = Number(dateISO.slice(0, 4));
  const found = getHolidaysForYear(year).find((holiday) => holiday.date === dateISO);
  return found ? HOLIDAY_ICONS[found.name] : undefined;
}

export function holidayDisplayName(englishName: string): string {
  const key = HOLIDAY_NAME_KEYS[englishName];
  return key ? tr(key) : englishName;
}
