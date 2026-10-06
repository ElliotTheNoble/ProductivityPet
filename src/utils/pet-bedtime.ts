// Real-time bedtime-window detection for the virtual pet-care system.
// Deliberately its own file, separate from src/utils/pet-needs.ts (need
// decay math) — this is a schedule/time-of-day concern, not a need
// calculation, even though a future step will use it to decide what to
// pass as `isSleeping` into that decay math. Nothing here reads or writes
// the Pet Profile, and nothing here sets isSleeping — see the module
// requirements this was built under.

// 8:00 PM local time is when bedtime begins; 8:00 AM local time is wake-up.
// Exported so the future "connect bedtime to the profile" step (and any
// later UI) reference these same two boundaries instead of re-deriving
// them.
export const BEDTIME_START_HOUR = 20; // 8:00 PM
export const WAKE_UP_HOUR = 8; // 8:00 AM

// Whether the given moment falls inside the bedtime window (8 PM–8 AM).
// Uses the DEVICE'S LOCAL time — Date's own getHours()/getMinutes() — not
// UTC, so this reflects whatever time zone the device is actually set to.
//
// Compares minutes-since-midnight rather than just the hour, for two
// reasons: it handles the window correctly wrapping past midnight (e.g.
// 11:30 PM and 3:00 AM both count as sleeping, even though the "sleeping"
// hour range isn't a single contiguous 0-23 span), and it's precise down
// to the minute at the exact 8:00 boundaries (seconds/milliseconds aren't
// considered — minute-level precision is enough for a bedtime check).
export function isWithinBedtimeWindow(date: Date): boolean {
  const minutesSinceMidnight = date.getHours() * 60 + date.getMinutes();
  const bedtimeStartMinutes = BEDTIME_START_HOUR * 60;
  const wakeUpMinutes = WAKE_UP_HOUR * 60;

  // The window wraps past midnight: asleep from 8:00 PM through 11:59 PM,
  // AND from 12:00 AM up to (but not including) 8:00 AM.
  return minutesSinceMidnight >= bedtimeStartMinutes || minutesSinceMidnight < wakeUpMinutes;
}

// Finds the next 8:00:00.000 AM or PM local-time instant strictly after
// `after`. Used by src/utils/pet-needs.ts to walk a real elapsed interval
// (e.g. the app being closed overnight) boundary-by-boundary instead of
// treating the whole gap as uniformly asleep or awake — see that file's
// resolvePetNeedsAcrossBedtime for why that distinction matters.
//
// "Strictly after" (not "on or after") matters: if `after` already sits
// exactly on a boundary, this returns the NEXT different one, not the same
// instant back — which is what lets a boundary-walking loop always make
// forward progress and terminate.
export function getNextBedtimeBoundary(after: Date): Date {
  const year = after.getFullYear();
  const month = after.getMonth();
  const day = after.getDate();

  const todayWakeUp = new Date(year, month, day, WAKE_UP_HOUR, 0, 0, 0);
  const todayBedtime = new Date(year, month, day, BEDTIME_START_HOUR, 0, 0, 0);

  const todaysRemaining = [todayWakeUp, todayBedtime]
    .filter((candidate) => candidate.getTime() > after.getTime())
    .sort((a, b) => a.getTime() - b.getTime());

  if (todaysRemaining.length > 0) return todaysRemaining[0];

  // Both of today's boundaries are already behind `after` — the next one is
  // tomorrow's wake-up. `day + 1` is safe even at the end of a month/year;
  // JS's Date constructor normalizes the overflow automatically.
  return new Date(year, month, day + 1, WAKE_UP_HOUR, 0, 0, 0);
}
