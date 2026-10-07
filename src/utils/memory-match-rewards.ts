import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadPetProfileWithNeedsUpdate } from '@/utils/pet-needs';
import { clampNeedValue, savePetProfile, type PetProfile } from '@/utils/pet-profile';
import { todayISO } from '@/utils/tasks';
import { MEMORY_MATCH_DIFFICULTIES, type MemoryMatchDifficulty } from '@/utils/memory-match';

// Persistent per-difficulty Best Moves + reward-granting for a completed
// Kitty Memory Match round — kept separate from memory-match.ts (pure
// game mechanics, no storage) the same way kitty-catch-rewards.ts is kept
// separate from kitty-catch.ts. This is the ONLY place that reads/writes
// the saved Best Moves records or Memory Match's own daily reward
// counters, and the only place that ever awards Happiness/Paw Tokens for
// playing this game — the game component just calls
// completeMemoryMatchRound(difficulty, moves) once per finished round and
// renders whatever comes back. Entirely independent storage keys from
// Kitty Catch's, so neither game's counters can interfere with the
// other's.

const BEST_MOVES_STORAGE_KEY = '@ProductivityPet:memoryMatchBestMoves';
const DAILY_REWARDS_STORAGE_KEY = '@ProductivityPet:memoryMatchDailyRewards';

// The app's actual reward amounts/limits for this game.
export const MEMORY_MATCH_HAPPINESS_REWARD = 10;
export const MEMORY_MATCH_COMPLETION_REWARD_BY_DIFFICULTY: Record<MemoryMatchDifficulty, number> = {
  easy: 5,
  medium: 7,
  hard: 10,
  expert: 15,
};
export const MEMORY_MATCH_NEW_BEST_BONUS = 10;
export const MEMORY_MATCH_DAILY_COMPLETION_REWARD_LIMIT = 3;
export const MEMORY_MATCH_DAILY_NEW_BEST_BONUS_LIMIT = 3;

// One independent Best Moves record per difficulty — absent key = no
// record yet for that difficulty. Completing Easy never touches Medium's
// entry (or any other's), since every write below only ever spreads the
// existing record and overwrites the one key being updated.
type BestMovesRecord = Partial<Record<MemoryMatchDifficulty, number>>;

type DailyRewardRecord = {
  date: string; // YYYY-MM-DD, local calendar date (see todayISO in tasks.ts)
  completionRewardsGiven: number;
  newBestBonusGiven: number;
};

function createDefaultDailyRecord(date: string): DailyRewardRecord {
  return { date, completionRewardsGiven: 0, newBestBonusGiven: 0 };
}

// In-memory caches, same "undefined = not loaded yet this session"
// convention used throughout this app (cachedEquippedId in
// pet-equipment.ts, cachedHighScore in kitty-catch-rewards.ts, etc.).
let cachedBestMoves: BestMovesRecord | undefined = undefined;
let cachedDailyRecord: DailyRewardRecord | undefined = undefined;

async function loadBestMoves(): Promise<BestMovesRecord> {
  if (cachedBestMoves !== undefined) return cachedBestMoves;
  try {
    const stored = await AsyncStorage.getItem(BEST_MOVES_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (parsed && typeof parsed === 'object') {
        const record: BestMovesRecord = {};
        for (const difficulty of MEMORY_MATCH_DIFFICULTIES) {
          const value = (parsed as Record<string, unknown>)[difficulty];
          if (typeof value === 'number' && value > 0) record[difficulty] = value;
        }
        cachedBestMoves = record;
        return cachedBestMoves;
      }
    }
  } catch {
    // fall through to default below
  }
  cachedBestMoves = {};
  return cachedBestMoves;
}

function saveBestMoves(record: BestMovesRecord): void {
  cachedBestMoves = record;
  AsyncStorage.setItem(BEST_MOVES_STORAGE_KEY, JSON.stringify(record)).catch(() => {});
}

// Read-only: lets the difficulty-select screen show "Best: N moves" for
// every difficulty that already has a record, before any round starts.
export async function getMemoryMatchBestMoves(): Promise<BestMovesRecord> {
  return loadBestMoves();
}

async function loadDailyRecord(): Promise<DailyRewardRecord> {
  const today = todayISO();
  if (cachedDailyRecord !== undefined && cachedDailyRecord.date === today) {
    return cachedDailyRecord;
  }

  try {
    const stored = await AsyncStorage.getItem(DAILY_REWARDS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as DailyRewardRecord).date === 'string' &&
        typeof (parsed as DailyRewardRecord).completionRewardsGiven === 'number' &&
        typeof (parsed as DailyRewardRecord).newBestBonusGiven === 'number'
      ) {
        const record = parsed as DailyRewardRecord;
        // The local calendar date has changed since this was last saved
        // (or this is the very first record) — the daily counters reset,
        // never carried over from a previous day.
        cachedDailyRecord = record.date === today ? record : createDefaultDailyRecord(today);
        return cachedDailyRecord;
      }
    }
  } catch {
    // fall through to default below
  }

  cachedDailyRecord = createDefaultDailyRecord(today);
  return cachedDailyRecord;
}

function saveDailyRecord(record: DailyRewardRecord): void {
  cachedDailyRecord = record;
  AsyncStorage.setItem(DAILY_REWARDS_STORAGE_KEY, JSON.stringify(record)).catch(() => {});
}

export type MemoryMatchRewardOutcome = {
  eligible: boolean;
  awarded: boolean;
  amount: number;
  reason?: 'daily-limit-reached';
};

export type MemoryMatchRoundResult = {
  difficulty: MemoryMatchDifficulty;
  moves: number;
  previousBest: number | null;
  bestMoves: number; // this difficulty's saved best AFTER this round
  isNewBest: boolean;
  // The actual Happiness delta applied (can be less than
  // MEMORY_MATCH_HAPPINESS_REWARD, including 0, if Happiness was already
  // near/at the 100 cap) — playing still counts and Paw Token rewards
  // below are completely unaffected by this. Same convention as Kitty
  // Catch's kitty-catch-rewards.ts.
  happinessAwarded: number;
  completionReward: MemoryMatchRewardOutcome;
  newBestBonus: MemoryMatchRewardOutcome;
  totalPawTokensAwarded: number;
  profile: PetProfile;
};

// Serializes the whole read-check-award-write cycle so two completed
// rounds reported close together can't both read the same pre-reward
// profile/best-moves/daily-record and double-award — same technique as
// completeKittyCatchRound in kitty-catch-rewards.ts.
let pendingRound: Promise<MemoryMatchRoundResult> | null = null;

export function completeMemoryMatchRound(
  difficulty: MemoryMatchDifficulty,
  moves: number
): Promise<MemoryMatchRoundResult> {
  const previous = pendingRound ?? Promise.resolve();
  const next = previous.then(
    () => runCompleteRound(difficulty, moves),
    () => runCompleteRound(difficulty, moves)
  );
  pendingRound = next;
  return next;
}

async function runCompleteRound(
  difficulty: MemoryMatchDifficulty,
  moves: number
): Promise<MemoryMatchRoundResult> {
  const profileBeforeReward = await loadPetProfileWithNeedsUpdate();
  const bestMovesRecord = await loadBestMoves();
  const dailyRecord = await loadDailyRecord();

  const previousBest = bestMovesRecord[difficulty] ?? null;
  // The FIRST completion of a difficulty only ESTABLISHES its baseline —
  // there's nothing yet to beat, so it never counts as a New Best (per
  // the game's own rule). This is this game's version of Kitty Catch's
  // "score must be >= 5" anti-farming rule: it closes the same loophole
  // (deliberately playing badly once to set an easy-to-beat baseline,
  // then "improving" on it repeatedly for free bonuses) without an
  // arbitrary numeric threshold, since moves — unlike a score — aren't
  // something a player can just freely pick a small number for.
  const isNewBest = previousBest !== null && moves < previousBest;
  const bestMoves = previousBest === null ? moves : Math.min(previousBest, moves);

  const nextHappiness = clampNeedValue(profileBeforeReward.happiness + MEMORY_MATCH_HAPPINESS_REWARD);
  const happinessAwarded = nextHappiness - profileBeforeReward.happiness;

  // Every finished round is eligible for the normal completion reward,
  // subject only to the daily limit — scores/Best Moves/Happiness all
  // still update even once this limit is reached, only the Paw Token
  // reward itself is withheld.
  const completionAmount = MEMORY_MATCH_COMPLETION_REWARD_BY_DIFFICULTY[difficulty];
  const completionWithinLimit = dailyRecord.completionRewardsGiven < MEMORY_MATCH_DAILY_COMPLETION_REWARD_LIMIT;
  const completionReward: MemoryMatchRewardOutcome = {
    eligible: true,
    awarded: completionWithinLimit,
    amount: completionWithinLimit ? completionAmount : 0,
    reason: completionWithinLimit ? undefined : 'daily-limit-reached',
  };

  const newBestBonusWithinLimit =
    isNewBest && dailyRecord.newBestBonusGiven < MEMORY_MATCH_DAILY_NEW_BEST_BONUS_LIMIT;
  const newBestBonus: MemoryMatchRewardOutcome = {
    eligible: isNewBest,
    awarded: newBestBonusWithinLimit,
    amount: newBestBonusWithinLimit ? MEMORY_MATCH_NEW_BEST_BONUS : 0,
    reason: isNewBest && !newBestBonusWithinLimit ? 'daily-limit-reached' : undefined,
  };

  const totalPawTokensAwarded = completionReward.amount + newBestBonus.amount;

  // Tokens are only ever deducted/added here, together with Happiness and
  // the Best Moves record, in this one pass — never as separate steps
  // that could leave one updated without the others.
  const updatedProfile: PetProfile = {
    ...profileBeforeReward,
    happiness: nextHappiness,
    pawTokens: profileBeforeReward.pawTokens + totalPawTokensAwarded,
  };
  savePetProfile(updatedProfile);

  if (previousBest === null || moves < previousBest) {
    saveBestMoves({ ...bestMovesRecord, [difficulty]: bestMoves });
  }

  saveDailyRecord({
    date: dailyRecord.date,
    completionRewardsGiven: dailyRecord.completionRewardsGiven + (completionReward.awarded ? 1 : 0),
    newBestBonusGiven: dailyRecord.newBestBonusGiven + (newBestBonus.awarded ? 1 : 0),
  });

  return {
    difficulty,
    moves,
    previousBest,
    bestMoves,
    isNewBest,
    happinessAwarded,
    completionReward,
    newBestBonus,
    totalPawTokensAwarded,
    profile: updatedProfile,
  };
}
