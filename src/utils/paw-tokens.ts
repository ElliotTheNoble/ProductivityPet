import AsyncStorage from '@react-native-async-storage/async-storage';

import { addToWallet, awardGrowthForTasks, ensureFamilyLoaded, getLivingPetCount } from '@/utils/pet-family';
import { getTaskTokenReward } from '@/utils/pet-family-config';
import { ensureProfilesReady, registerProfileStore, scopedKey, writeScoped } from '@/utils/profiles';
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

const AWARDED_KEY_NAME = 'awardedTaskTokens';
// token-history.ts owns this key; only read here to tell a returning player from a new one.
const TOKEN_HISTORY_KEY_NAME = 'tokenEarnings';

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

// ---- reward-history health ----
// What the last load of the paid-occurrences record found. 'ok' = a valid record; 'new-player' = no record and
// nothing earned yet; 'recovered-missing' = no record but the player has earned before (rebuilt, see below);
// 'recovered-corrupt' = the record was unreadable: the original is kept under `backupKey` and the record was
// rebuilt without paying anything again; 'unreadable' = storage could not be read or the original could not be
// preserved, so nothing was paid or changed and the next call tries again.
export type RewardHistoryStatus =
  | { state: 'ok' | 'new-player' | 'recovered-missing' | 'unreadable' }
  | { state: 'recovered-corrupt'; backupKey: string };

let rewardHistoryStatus: RewardHistoryStatus | null = null;
const statusListeners = new Set<(status: RewardHistoryStatus) => void>();

export function getRewardHistoryStatus(): RewardHistoryStatus | null {
  return rewardHistoryStatus;
}

export function subscribeToRewardHistoryStatus(listener: (status: RewardHistoryStatus) => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function setRewardHistoryStatus(status: RewardHistoryStatus): void {
  rewardHistoryStatus = status;
  if (status.state === 'recovered-corrupt' || status.state === 'unreadable') {
    console.warn(`[Paw Tokens] reward history: ${status.state}`);
  }
  statusListeners.forEach((listener) => listener(status));
}

// The saved keys, or null when the record is not a readable list of keys.
function parseAwardedKeys(stored: string): Set<string> | null {
  try {
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((key): key is string => typeof key === 'string')) : null;
  } catch {
    return null;
  }
}

// Whole quoted strings that can still be read from a damaged record (for example a list cut off in the
// middle). Extra keys only ever prevent a payment, so over-collecting is harmless.
function salvageAwardedKeys(stored: string): string[] {
  return Array.from(stored.matchAll(/"((?:[^"\\]|\\.)*)"/g), (match) => match[1]).filter((key) => key.length > 0);
}

async function writeAwardedKeys(key: string, keys: Set<string>): Promise<void> {
  // Non-fatal if it fails — still usable for this session via the in-memory cache; the write is remembered and
  // retried (a profile switch will not drop it silently).
  await writeScoped(key, JSON.stringify(Array.from(keys)));
}

// True when the earnings history (a separate record, see token-history.ts) already holds a task/appointment
// payout, i.e. this is not a brand-new player.
async function hasEarnedBefore(historyKey: string): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(historyKey);
    return typeof stored === 'string' && stored.includes('"id":"earn:');
  } catch {
    return false;
  }
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
  await ensureProfilesReady();
  // Both records belong to the profile that is active NOW; the keys are fixed for this whole run.
  const awardedKey = scopedKey(AWARDED_KEY_NAME);
  const historyKey = scopedKey(TOKEN_HISTORY_KEY_NAME);
  const completedOccurrences = getCompletedOccurrences(tasks);

  if (cachedAwardedKeys === null) {
    let stored: string | null;
    try {
      stored = await AsyncStorage.getItem(awardedKey);
    } catch {
      // The record could not even be READ, so nothing is known about what was paid. Pay nothing, write
      // nothing (the real record may be fine) and try again on the next call.
      setRewardHistoryStatus({ state: 'unreadable' });
      return;
    }

    if (stored === null) {
      // No record at all. A new player has nothing completed (or never earned anything); a player who has
      // earned before and lost the record is told apart by their earnings history. Either way the
      // currently-completed occurrences are recorded as already paid and nothing is paid for them.
      const existingPlayer = completedOccurrences.length > 0 || (await hasEarnedBefore(historyKey));
      cachedAwardedKeys = new Set(completedOccurrences.map((occurrence) => occurrence.key));
      await writeAwardedKeys(awardedKey, cachedAwardedKeys);
      setRewardHistoryStatus({ state: existingPlayer ? 'recovered-missing' : 'new-player' });
      return;
    }

    const keys = parseAwardedKeys(stored);
    if (keys === null) {
      // The record exists but is unreadable. It is NEVER treated as "nothing was paid" (that would pay every
      // completed task again). First keep the original text; only if that copy is safely stored, rebuild:
      // every key that can still be read from it, plus everything currently completed counts as already
      // paid. This can only skip a reward, never repeat one. Nothing is paid on this call.
      const backupKey = `${awardedKey}.corrupt-${Date.now()}`;
      try {
        await AsyncStorage.setItem(backupKey, stored);
      } catch {
        // Could not preserve the original, so leave it exactly as it is and try again next time.
        setRewardHistoryStatus({ state: 'unreadable' });
        return;
      }
      const rebuilt = new Set(salvageAwardedKeys(stored));
      for (const occurrence of completedOccurrences) rebuilt.add(occurrence.key);
      cachedAwardedKeys = rebuilt;
      await writeAwardedKeys(awardedKey, rebuilt);
      setRewardHistoryStatus({ state: 'recovered-corrupt', backupKey });
      return;
    }
    cachedAwardedKeys = keys;
    setRewardHistoryStatus({ state: 'ok' });
  }

  const newlyCompleted = completedOccurrences.filter((occurrence) => !cachedAwardedKeys!.has(occurrence.key));
  if (newlyCompleted.length === 0) return;

  for (const occurrence of newlyCompleted) {
    cachedAwardedKeys.add(occurrence.key);
  }
  // Non-fatal if it fails — the in-memory cache already reflects these as awarded for the rest of this
  // session, so they won't be double-paid even if this particular write failed; the next successful write
  // catches up.
  await writeAwardedKeys(awardedKey, cachedAwardedKeys);

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

// Profile switching: wait for queued reconciles, then forget this profile's paid-occurrence record.
registerProfileStore({
  name: 'paw-tokens',
  settle: () => pendingReconcile.catch(() => undefined),
  reset: () => {
    cachedAwardedKeys = null;
    rewardHistoryStatus = null;
  },
});
