import AsyncStorage from '@react-native-async-storage/async-storage';

import { MOODS, type Mood } from '@/utils/mood';
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

const MOOD_LOG_STORAGE_KEY = '@ProductivityPet:moodLog';

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
  inFlightLoad = (async () => {
    try {
      const stored = await AsyncStorage.getItem(MOOD_LOG_STORAGE_KEY);
      const parsed = stored ? (JSON.parse(stored) as unknown) : [];
      cachedLog = Array.isArray(parsed) ? parsed.filter(isMoodEntry) : [];
    } catch {
      cachedLog = [];
    } finally {
      inFlightLoad = null;
    }
    return cachedLog ?? [];
  })();
  return inFlightLoad;
}

// Records one check-in "now". Called when the player picks a mood on Home.
export async function recordMoodEntry(mood: Mood, now: Date = new Date()): Promise<void> {
  const log = await getMoodLog();
  const entry: MoodEntry = {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    mood,
    at: now.toISOString(),
    dateISO: dateToISO(now),
  };
  cachedLog = [...log, entry];
  AsyncStorage.setItem(MOOD_LOG_STORAGE_KEY, JSON.stringify(cachedLog)).catch(() => {});
  listeners.forEach((listener) => listener(cachedLog ?? []));
}

// Same cross-screen reactivity pattern as subscribeToPetProfile — lets Stats
// pages that are open update the moment a check-in is recorded.
export function subscribeToMoodLog(listener: (entries: MoodEntry[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
