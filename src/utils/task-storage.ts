import AsyncStorage from '@react-native-async-storage/async-storage';

import { reconcilePawTokenEarnings } from '@/utils/paw-tokens';
import { ensureProfilesReady, registerProfileStore, scopedKey, trackOperation, writeScoped } from '@/utils/profiles';
import { withoutDisallowedAdditions } from '@/utils/task-creation-policy';
import { normalizeTask, todayISO, type Task } from '@/utils/tasks';

// Single source of truth for the storage key — Home, Tasks, birthday
// detection, and the Rooms hub's task-count badges all read the same data.
// The list belongs to the active profile (see @/utils/profiles.ts).
const TASKS_KEY_NAME = 'tasks';

// In-memory cache of the parsed/normalized task list, shared by every screen
// and hook that reads this key. Without this, navigating between Home,
// Tasks, Rooms, and individual rooms triggered a fresh AsyncStorage read +
// JSON.parse + normalizeTask pass per screen per visit, even when the
// underlying data hadn't changed since the last read. `null` means "not
// loaded yet this session" (distinct from `[]`, a legitimately empty list).
let cachedTasks: Task[] | null = null;
// De-dupes concurrent first-reads (e.g. two screens/hooks mounting at
// nearly the same time before anything has populated the cache yet) into a
// single AsyncStorage call instead of one per caller.
let inFlightRead: Promise<Task[]> | null = null;

// Returns the current tasks, reading + parsing + normalizing from
// AsyncStorage only the first time it's called (or after resetCachedTasks);
// every subsequent call — from any screen or hook — resolves from memory.
export async function getCachedTasks(): Promise<Task[]> {
  if (cachedTasks !== null) return cachedTasks;
  if (inFlightRead) return inFlightRead;

  inFlightRead = trackOperation((async () => {
    try {
      await ensureProfilesReady();
      const stored = await AsyncStorage.getItem(scopedKey(TASKS_KEY_NAME));
      if (!stored) {
        cachedTasks = [];
        return cachedTasks;
      }
      const parsed = JSON.parse(stored) as unknown[];
      const today = todayISO();
      cachedTasks = parsed.map((raw) => normalizeTask(raw, today));
      return cachedTasks;
    } catch {
      cachedTasks = [];
      return cachedTasks;
    } finally {
      inFlightRead = null;
    }
  })());

  return inFlightRead;
}

// Called by Home/Tasks (the only two screens that actually edit the task
// list) whenever they persist a change — writes through to AsyncStorage
// exactly as before, and updates the shared in-memory cache in the same
// step so every other reader immediately sees the latest data without a
// storage round-trip of their own. Also reconciles Paw Token earning (see
// @/utils/paw-tokens.ts) against the same tasks — this is a read-only,
// additive side effect from Paw Tokens' own perspective; it never changes
// what gets written here or what callers receive back.
//
// A profile that may not create tasks of its own (a child, by default; see @/utils/task-creation-policy.ts) cannot save a NEW one by any
// route: whatever new task a screen hands in here is dropped, while every existing task, edit, completion and deletion is saved as before.
export function persistCachedTasks(tasks: Task[]): void {
  const allowed = withoutDisallowedAdditions(cachedTasks, tasks);
  cachedTasks = allowed;
  void writeScoped(scopedKey(TASKS_KEY_NAME), JSON.stringify(allowed));
  reconcilePawTokenEarnings(allowed).catch(() => {});
}

// Profile switching: forget this profile's list. Its phone reminders are cancelled by the pet-alerts store, which
// cancels everything scheduled (see @/utils/pet-alerts.ts); the next profile schedules its own when its tasks load.
registerProfileStore({
  name: 'tasks',
  reset: () => {
    cachedTasks = null;
    inFlightRead = null;
  },
});
