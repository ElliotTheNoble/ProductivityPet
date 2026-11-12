import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { MOODS, type Mood } from '@/utils/mood';
import { ensureProfilesReady, registerProfileStore, scopedKey, trackOperation, writeScoped } from '@/utils/profiles';
import { dateToISO } from '@/utils/tasks';

// The player's own mood check-ins, with real timestamps — the history behind
// the Home "Today's Mood" picker (src/components/today-mood.tsx) and the
// Stats "My Mood Journey" / "Year in Review" pages.
//
// The player's feelings, not the kitty's: this has nothing to do with the
// Pet Profile's Hunger/Happiness/Energy/Cleanliness meters and never reads or
// writes them. It is append-only: a new check-in never overwrites an older
// one, and the Home picker's own saved "current mood" value
// (@ProductivityPet:mood) is untouched and keeps working exactly as before.
// Older selections made before this log existed have no timestamp, so they
// are NOT back-filled — history starts from the first check-in made after
// this shipped.

const MOOD_LOG_KEY_NAME = 'moodLog'; // belongs to the active profile (see @/utils/profiles.ts)

export type MoodEntry = {
  id: string;
  mood: Mood;
  // Full ISO timestamp of the check-in.
  at: string;
  // The player's LOCAL calendar date for that moment ('YYYY-MM-DD'), stored
  // so day/month/year grouping never depends on re-deriving a time zone later.
  dateISO: string;
};

let cachedLog: MoodEntry[] | null = null;
let inFlightLoad: Promise<MoodEntry[]> | null = null;
const listeners = new Set<(entries: MoodEntry[]) => void>();

function isMoodEntry(value: unknown): value is MoodEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<MoodEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.at === 'string' &&
    typeof entry.dateISO === 'string' &&
    typeof entry.mood === 'string' &&
    MOODS.includes(entry.mood as Mood)
  );
}

export async function getMoodLog(): Promise<MoodEntry[]> {
  if (cachedLog) return cachedLog;
  if (inFlightLoad) return inFlightLoad;
  inFlightLoad = trackOperation((async () => {
    try {
      await ensureProfilesReady();
      const stored = await AsyncStorage.getItem(scopedKey(MOOD_LOG_KEY_NAME));
      const parsed = stored ? (JSON.parse(stored) as unknown) : [];
      cachedLog = Array.isArray(parsed) ? parsed.filter(isMoodEntry) : [];
    } catch {
      cachedLog = [];
    } finally {
      inFlightLoad = null;
    }
    return cachedLog ?? [];
  })());
  return inFlightLoad;
}

// Records one check-in "now". Called when the player picks a mood on Home.
export function recordMoodEntry(mood: Mood, now: Date = new Date()): Promise<void> {
  return trackOperation(doRecordMoodEntry(mood, now));
}

async function doRecordMoodEntry(mood: Mood, now: Date): Promise<void> {
  const log = await getMoodLog();
  const entry: MoodEntry = {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    mood,
    at: now.toISOString(),
    dateISO: dateToISO(now),
  };
  cachedLog = [...log, entry];
  void writeScoped(scopedKey(MOOD_LOG_KEY_NAME), JSON.stringify(cachedLog));
  listeners.forEach((listener) => listener(cachedLog ?? []));
}

// ONE mood per calendar day, chosen by the player (Home's "Today's Mood" and the Tasks calendar's mood selector, for today and past days).
//  - Picking a mood for a day REPLACES what that day had (never a second record for the same day); picking the mood the day already has clears
//    the day. Only the day the player is editing is ever touched: every other day's check-ins stay exactly as they are.
//  - A future day is refused (nothing is written).
//  - Nothing here reads or writes the pet's own needs, happiness or growth.
export type MoodChange = 'set' | 'cleared' | 'future' | 'unchanged';

export function moodOnDate(log: readonly MoodEntry[], dateISO: string): Mood | null {
  let latest: MoodEntry | null = null;
  for (const entry of log) if (entry.dateISO === dateISO && (!latest || entry.at > latest.at)) latest = entry;
  return latest ? latest.mood : null;
}

export function toggleMoodForDate(dateISO: string, mood: Mood, now: Date = new Date()): Promise<MoodChange> {
  return trackOperation(doToggleMoodForDate(dateISO, mood, now));
}

async function doToggleMoodForDate(dateISO: string, mood: Mood, now: Date): Promise<MoodChange> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || dateISO > dateToISO(now)) return 'future';
  if (!MOODS.includes(mood)) return 'unchanged';
  const log = await getMoodLog();
  const rest = log.filter((entry) => entry.dateISO !== dateISO);
  const clearing = moodOnDate(log, dateISO) === mood;
  const entry: MoodEntry = { id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`, mood, at: now.toISOString(), dateISO };
  cachedLog = clearing ? rest : [...rest, entry];
  void writeScoped(scopedKey(MOOD_LOG_KEY_NAME), JSON.stringify(cachedLog));
  listeners.forEach((listener) => listener(cachedLog ?? []));
  return clearing ? 'cleared' : 'set';
}

// A screen's view of one day's mood, kept live (null = nothing recorded for that day yet).
export function useMoodForDate(dateISO: string): Mood | null {
  const [log, setLog] = useState<MoodEntry[]>(() => cachedLog ?? []);
  useEffect(() => {
    let cancelled = false;
    getMoodLog().then((list) => !cancelled && setLog(list)).catch(() => {});
    const off = subscribeToMoodLog((list) => !cancelled && setLog(list));
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return moodOnDate(log, dateISO);
}

// Same cross-screen reactivity pattern as subscribeToPetProfile — lets Stats
// pages that are open update the moment a check-in is recorded.
export function subscribeToMoodLog(listener: (entries: MoodEntry[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Profile switching: forget this profile's mood history.
registerProfileStore({
  name: 'mood-log',
  reset: () => {
    cachedLog = null;
    inFlightLoad = null;
  },
});
