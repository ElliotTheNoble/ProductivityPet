import AsyncStorage from '@react-native-async-storage/async-storage';

import { getPetProfile, savePetProfile } from '@/utils/pet-profile';
import type { Task } from '@/utils/tasks';

// Paw Token earning — completing a task or appointment earns the pet a
// reward based on what it was, persisted into the existing
// PetProfile.pawTokens field (see @/utils/pet-profile.ts; that file still
// owns the field itself and its storage — this file only ever adds to it,
// through the same getPetProfile/savePetProfile it already exposes).
//
// The hard part isn't the reward amount — it's never paying out twice for
// the same occurrence. Task completion itself is a plain boolean/array
// toggle (see toggleTaskOccurrence in @/utils/tasks.ts) — checking,
// unchecking, and re-checking the same task leaves no trace of "this was
// already paid out once" in the Task record itself. So that memory has to
// live somewhere else, permanently, independent of the task's current
// completed state: a separate, append-only record of every occurrence
// that has EVER been paid out, which is never pruned even when a task is
// unchecked, stopped, excluded, or deleted — only ever added to.

const AWARDED_TASK_TOKENS_STORAGE_KEY = '@ProductivityPet:awardedTaskTokens';

// The app's actual reward amounts. Birthdays are excluded entirely (same
// as everywhere else that counts completions, e.g. countCompletedOccurrences
// in tasks.ts) — there's no "completing" a birthday.
export const REGULAR_TASK_REWARD = 10;
export const IMPORTANT_TASK_REWARD = 15;
export const APPOINTMENT_REWARD = 5;

// How many Paw Tokens one completion of this task is worth. Only called
// for kind: 'task' (regular/important) or kind: 'event' (appointment) —
// see isEligibleKind below.
function getRewardAmount(task: Task): number {
  if (task.kind === 'task') return task.important ? IMPORTANT_TASK_REWARD : REGULAR_TASK_REWARD;
  return APPOINTMENT_REWARD; // kind === 'event'
}

function isEligibleKind(task: Task): boolean {
  return task.kind === 'task' || task.kind === 'event';
}

// One entry per completable occurrence currently marked done, each paired
// with the reward it's worth. `key` is a unique, stable identifier for
// that occurrence — one-time items have exactly one occurrence (keyed by
// the item's own id); repeating items have one occurrence per
// completedDates entry (keyed by id + that specific date), since the same
// repeating item can be done on one day and not another.
function getCompletedOccurrences(tasks: Task[]): { key: string; amount: number }[] {
  const occurrences: { key: string; amount: number }[] = [];
  for (const task of tasks) {
    if (!isEligibleKind(task)) continue;
    const amount = getRewardAmount(task);
    if (task.repeat) {
      for (const date of task.completedDates ?? []) {
        occurrences.push({ key: `${task.id}:${date}`, amount });
      }
    } else if (task.completed) {
      occurrences.push({ key: task.id, amount });
    }
  }
  return occurrences;
}

// In-memory cache of the awarded-keys record, loaded at most once per
// session — mirrors the cachedProfile/cachedTasks pattern used elsewhere.
// `null` means "not loaded yet this session".
let cachedAwardedKeys: Set<string> | null = null;

// Serializes the whole read-diff-award-write cycle so two overlapping
// calls (e.g. Home's hydration effect and an almost-simultaneous task
// edit) can't both read the same pre-update awarded set and double-award
// the same newly-completed occurrence between them. Each call is chained
// onto the previous one's completion rather than running concurrently.
let pendingReconcile: Promise<void> = Promise.resolve();

// Brings Paw Tokens up to date with whatever is currently completed,
// paying out exactly once per occurrence that has never been paid out
// before. Safe to call repeatedly with the same or overlapping task
// lists — unchanged/already-awarded occurrences are always a no-op.
//
// The very first time this ever runs for a device (no awarded-keys record
// exists yet in storage), every currently-completed occurrence is treated
// as pre-existing rather than newly earned: it's recorded as already
// awarded, but pays out nothing. Without this, every task a user had
// already completed before this feature shipped would suddenly earn a
// token the first time the app loads afterward.
export function reconcilePawTokenEarnings(tasks: Task[]): Promise<void> {
  pendingReconcile = pendingReconcile.then(() => runReconcile(tasks));
  return pendingReconcile;
}

async function runReconcile(tasks: Task[]): Promise<void> {
  const completedOccurrences = getCompletedOccurrences(tasks);

  if (cachedAwardedKeys === null) {
    let stored: string | null;
    try {
      stored = await AsyncStorage.getItem(AWARDED_TASK_TOKENS_STORAGE_KEY);
    } catch {
      stored = null;
    }

    if (stored === null) {
      cachedAwardedKeys = new Set(completedOccurrences.map((occurrence) => occurrence.key));
      try {
        await AsyncStorage.setItem(
          AWARDED_TASK_TOKENS_STORAGE_KEY,
          JSON.stringify(Array.from(cachedAwardedKeys))
        );
      } catch {
        // Non-fatal — still usable for this session via the in-memory
        // cache; the next successful write retries persisting it.
      }
      return;
    }

    try {
      const parsed = JSON.parse(stored) as unknown;
      cachedAwardedKeys = new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []);
    } catch {
      cachedAwardedKeys = new Set();
    }
  }

  const newlyCompleted = completedOccurrences.filter((occurrence) => !cachedAwardedKeys!.has(occurrence.key));
  if (newlyCompleted.length === 0) return;

  for (const occurrence of newlyCompleted) {
    cachedAwardedKeys.add(occurrence.key);
  }
  try {
    await AsyncStorage.setItem(AWARDED_TASK_TOKENS_STORAGE_KEY, JSON.stringify(Array.from(cachedAwardedKeys)));
  } catch {
    // Non-fatal — the in-memory cache already reflects these as awarded
    // for the rest of this session, so they won't be double-paid even if
    // this particular write failed; the next successful write catches up.
  }

  const profile = await getPetProfile();
  const earned = newlyCompleted.reduce((sum, occurrence) => sum + occurrence.amount, 0);
  savePetProfile({ ...profile, pawTokens: profile.pawTokens + earned });
}
