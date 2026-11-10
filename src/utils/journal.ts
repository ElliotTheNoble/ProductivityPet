import AsyncStorage from '@react-native-async-storage/async-storage';

import { ensureProfilesReady, registerProfileStore, scopedKey, trackOperation, writeScoped } from '@/utils/profiles';

// Short personal daily reflections ("What's something you'd like to remember
// about today?"). Stored ONLY on this device, in the same local AsyncStorage
// the rest of the app uses — never sent to any server or AI service.
//
// Privacy (family mode): every reflection is PRIVATE unless its owner has explicitly shared it with a parent. The setting is the
// optional `visibility` field: only the exact value 'shared' means shared; a missing field (every entry written before this existed),
// a typo or any other value is private, so nothing is ever shared by accident or by damage. Reading never rewrites anything: an old
// entry stays exactly as stored until its owner saves or changes it. A parent can only ever see shared entries, and only through
// @/utils/journal-sharing.ts (the one module that reads another profile's journal and filters before it returns anything).
//
// At most one reflection per calendar day (keyed by its local date), which
// keeps edit/delete simple. Linked to mood check-ins purely by date
// (see @/utils/mood-log.ts) — neither requires the other.

export const JOURNAL_KEY_NAME = 'journal'; // belongs to the active profile (see @/utils/profiles.ts)

// Keep reflections "short" — plenty for a few sentences.
export const MAX_REFLECTION_LENGTH = 500;

export type JournalVisibility = 'private' | 'shared';

export type Reflection = {
  id: string;
  dateISO: string; // local 'YYYY-MM-DD' the reflection is about
  text: string;
  createdAt: string;
  updatedAt: string;
  // Absent means private (see above). Only the exact value 'shared' is shared.
  visibility?: JournalVisibility;
};

// The one place that decides whether an entry is shared: exactly 'shared', nothing else.
export function isShared(entry: { visibility?: unknown }): boolean {
  return entry.visibility === 'shared';
}

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
  inFlightLoad = trackOperation((async () => {
    try {
      await ensureProfilesReady();
      const stored = await AsyncStorage.getItem(scopedKey(JOURNAL_KEY_NAME));
      const parsed = stored ? (JSON.parse(stored) as unknown) : [];
      cachedJournal = Array.isArray(parsed) ? parsed.filter(isReflection) : [];
    } catch {
      cachedJournal = [];
    } finally {
      inFlightLoad = null;
    }
    return cachedJournal ?? [];
  })());
  return inFlightLoad;
}

// Changes to the journal run one after another, so a privacy change and a text save can never overwrite each other.
let changeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = changeChain.then(run, run);
  changeChain = next.catch(() => {});
  return next;
}

// Writes the journal and reads it back; only a change that is really stored is shown (memory and listeners change after the check,
// never before). Used when an entry goes from shared to private: a failed save must never LOOK private while still being shared.
async function commitVerified(next: Reflection[], dateISO: string, expected: JournalVisibility): Promise<boolean> {
  const key = scopedKey(JOURNAL_KEY_NAME);
  const written = await writeScoped(key, JSON.stringify(next));
  if (!written) return false;
  try {
    const stored = await AsyncStorage.getItem(key);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    const entry = Array.isArray(parsed) ? parsed.filter(isReflection).find((r) => r.dateISO === dateISO) : undefined;
    const holds = expected === 'shared' ? !!entry && isShared(entry) : !entry || !isShared(entry);
    if (!holds) return false;
  } catch {
    return false;
  }
  cachedJournal = next;
  listeners.forEach((listener) => listener(next));
  return true;
}

// Updates the in-memory journal and live listeners right away, then writes to
// storage. Resolves true only if the write actually succeeded.
async function commit(next: Reflection[]): Promise<boolean> {
  cachedJournal = next;
  listeners.forEach((listener) => listener(next));
  return writeScoped(scopedKey(JOURNAL_KEY_NAME), JSON.stringify(next));
}

// Creates or edits the reflection for `dateISO`. Saving empty text simply
// removes that day's reflection (so nothing is ever required). Resolves true
// when the change was stored, false if the device storage write failed.
//
// `visibility`: left out, an existing entry keeps the setting it has and a new entry is private. 'shared' shares the entry once this
// save has been stored; 'private' makes it private (and, for an entry that was shared, is confirmed by reading the journal back).
export function saveReflection(dateISO: string, rawText: string, visibility?: JournalVisibility): Promise<boolean> {
  return trackOperation(serialized(() => doSaveReflection(dateISO, rawText, visibility)));
}

async function doSaveReflection(dateISO: string, rawText: string, visibility?: JournalVisibility): Promise<boolean> {
  const text = rawText.trim().slice(0, MAX_REFLECTION_LENGTH);
  const all = await getReflections();
  const existing = all.find((r) => r.dateISO === dateISO);
  if (text.length === 0) {
    return existing ? commit(all.filter((r) => r.dateISO !== dateISO)) : true;
  }
  const now = new Date().toISOString();
  if (existing) {
    const chosen: JournalVisibility = visibility ?? (isShared(existing) ? 'shared' : 'private');
    const next = all.map((r) => (r.dateISO === dateISO ? { ...r, text, updatedAt: now, visibility: chosen } : r));
    // Taking a shared entry back to private is confirmed against what is stored; everything else keeps the quick update.
    return isShared(existing) && chosen === 'private' ? commitVerified(next, dateISO, 'private') : commit(next);
  } else {
    return commit([
      ...all,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dateISO,
        text,
        createdAt: now,
        updatedAt: now,
        visibility: visibility === 'shared' ? 'shared' : 'private',
      },
    ]);
  }
}

// Changes ONLY the privacy setting of one day's entry: the text, its dates and any unsaved draft on screen are not touched. Resolves
// true only when the new setting is really stored (the journal is read back); on false nothing changed, in memory or on screen.
export function setReflectionVisibility(dateISO: string, visibility: JournalVisibility): Promise<boolean> {
  return trackOperation(serialized(() => doSetVisibility(dateISO, visibility)));
}

async function doSetVisibility(dateISO: string, visibility: JournalVisibility): Promise<boolean> {
  const all = await getReflections();
  const existing = all.find((r) => r.dateISO === dateISO);
  if (!existing) return false;
  if (visibility === 'private' && !isShared(existing)) return true; // already private (a missing field counts); nothing to write
  if (visibility === 'shared' && isShared(existing)) return true;
  return commitVerified(
    all.map((r) => (r.dateISO === dateISO ? { ...r, visibility } : r)),
    dateISO,
    visibility
  );
}

export function deleteReflection(dateISO: string): Promise<boolean> {
  return trackOperation(serialized(() => doDeleteReflection(dateISO)));
}

async function doDeleteReflection(dateISO: string): Promise<boolean> {
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

// Profile switching: forget this profile's journal.
registerProfileStore({
  name: 'journal',
  reset: () => {
    cachedJournal = null;
    inFlightLoad = null;
  },
});
