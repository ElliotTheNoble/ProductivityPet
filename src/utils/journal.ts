import AsyncStorage from '@react-native-async-storage/async-storage';

// Short personal daily reflections ("What's something you'd like to remember
// about today?"). Stored ONLY on this device, in the same local AsyncStorage
// the rest of the app uses — never sent to any server or AI service.
//
// At most one reflection per calendar day (keyed by its local date), which
// keeps edit/delete simple. Linked to mood check-ins purely by date
// (see @/utils/mood-log.ts) — neither requires the other.

const JOURNAL_STORAGE_KEY = '@ProductivityPet:journal';

// Keep reflections "short" — plenty for a few sentences.
export const MAX_REFLECTION_LENGTH = 500;

export type Reflection = {
  id: string;
  dateISO: string; // local 'YYYY-MM-DD' the reflection is about
  text: string;
  createdAt: string;
  updatedAt: string;
};

let cachedJournal: Reflection[] | null = null;
let inFlightLoad: Promise<Reflection[]> | null = null;
const listeners = new Set<(entries: Reflection[]) => void>();

function isReflection(value: unknown): value is Reflection {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<Reflection>;
  return (
    typeof r.id === 'string' &&
    typeof r.dateISO === 'string' &&
    typeof r.text === 'string' &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string'
  );
}

export async function getReflections(): Promise<Reflection[]> {
  if (cachedJournal) return cachedJournal;
  if (inFlightLoad) return inFlightLoad;
  inFlightLoad = (async () => {
    try {
      const stored = await AsyncStorage.getItem(JOURNAL_STORAGE_KEY);
      const parsed = stored ? (JSON.parse(stored) as unknown) : [];
      cachedJournal = Array.isArray(parsed) ? parsed.filter(isReflection) : [];
    } catch {
      cachedJournal = [];
    } finally {
      inFlightLoad = null;
    }
    return cachedJournal ?? [];
  })();
  return inFlightLoad;
}

// Updates the in-memory journal and live listeners right away, then writes to
// storage. Resolves true only if the write actually succeeded.
async function commit(next: Reflection[]): Promise<boolean> {
  cachedJournal = next;
  listeners.forEach((listener) => listener(next));
  try {
    await AsyncStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

// Creates or edits the reflection for `dateISO`. Saving empty text simply
// removes that day's reflection (so nothing is ever required). Resolves true
// when the change was stored, false if the device storage write failed.
export async function saveReflection(dateISO: string, rawText: string): Promise<boolean> {
  const text = rawText.trim().slice(0, MAX_REFLECTION_LENGTH);
  const all = await getReflections();
  const existing = all.find((r) => r.dateISO === dateISO);
  if (text.length === 0) {
    return existing ? commit(all.filter((r) => r.dateISO !== dateISO)) : true;
  }
  const now = new Date().toISOString();
  if (existing) {
    return commit(all.map((r) => (r.dateISO === dateISO ? { ...r, text, updatedAt: now } : r)));
  } else {
    return commit([
      ...all,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, dateISO, text, createdAt: now, updatedAt: now },
    ]);
  }
}

export async function deleteReflection(dateISO: string): Promise<boolean> {
  const all = await getReflections();
  if (!all.some((r) => r.dateISO === dateISO)) return true;
  return commit(all.filter((r) => r.dateISO !== dateISO));
}

export function subscribeToJournal(listener: (entries: Reflection[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
