import AsyncStorage from '@react-native-async-storage/async-storage';

import { addToWallet, awardGrowthForTasks, ensureFamilyLoaded, getLivingPetCount } from '@/utils/pet-family';
import { getTaskTokenReward } from '@/utils/pet-family-config';
import { recordTokenEarning, type TokenSource } from '@/utils/token-history';
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

function isEligibleKind(task: Task): boolean {
  return task.kind === 'task' || task.kind === 'event';
}

// One entry per completable occurrence currently marked done, each paired
// with the reward it's worth. `key` is a unique, stable identifier for
// that occurrence — one-time items have exactly one occurrence (keyed by
// the item's own id); repeating items have one occurrence per
// completedDates entry (keyed by id + that specific date), since the same
// repeating item can be done on one day and not another.
function getCompletedOccurrences(
  tasks: Task[]
): { key: string; important: boolean; source: TokenSource; taskId: string }[] {
  const occurrences: { key: string; important: boolean; source: TokenSource; taskId: string }[] = [];
  for (const task of tasks) {
    if (!isEligibleKind(task)) continue;
    const source: TokenSource = task.kind === 'task' ? 'task' : 'appointment';
    if (task.repeat) {
      for (const date of task.completedDates ?? []) {
        occurrences.push({ key: `${task.id}:${date}`, important: task.important, source, taskId: task.id });
      }
    } else if (task.completed) {
      occurrences.push({ key: task.id, important: task.important, source, taskId: task.id });
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

  // Rewards for these NEW occurrences only (history is never re-priced).
  // Paw Tokens belong to the player: one combined reward per completed task,
  // bigger with more living pets (see TASK_TOKEN_REWARDS_BY_LIVING_PETS in
  // @/utils/pet-family-config.ts); appointments keep their flat amount.
  // Growth is separate: each completed TASK is shared between the living
  // pets (@/utils/pet-family.ts awardGrowthForTasks).
  await ensureFamilyLoaded();
  const livingPets = getLivingPetCount();
  const payouts = newlyCompleted.map((occurrence) => ({
    ...occurrence,
    amount:
      occurrence.source === 'task'
        ? getTaskTokenReward(livingPets, occurrence.important)
        : APPOINTMENT_REWARD,
  }));
  const earned = payouts.reduce((sum, payout) => sum + payout.amount, 0);
  addToWallet(earned);
  awardGrowthForTasks(newlyCompleted.filter((occurrence) => occurrence.source === 'task').length);

  // Log each payout in the earnings history (@/utils/token-history.ts). The
  // event id is derived from the occurrence key, so it can never be logged
  // twice. Logging never changes what was paid or the balance above.
  for (const occurrence of payouts) {
    await recordTokenEarning({
      id: `earn:${occurrence.key}`,
      amount: occurrence.amount,
      source: occurrence.source,
      refId: occurrence.taskId,
    }).catch(() => {});
  }
}
