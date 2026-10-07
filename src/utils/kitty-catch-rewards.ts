import AsyncStorage from '@react-native-async-storage/async-storage';

import { KITTY_CATCH_MIN_SCORE_FOR_BONUS } from '@/utils/kitty-catch';
import { loadPetProfileWithNeedsUpdate } from '@/utils/pet-needs';
import { clampNeedValue, savePetProfile, type PetProfile } from '@/utils/pet-profile';
import { todayISO } from '@/utils/tasks';

// Persistent high score + reward-granting for a completed Kitty Catch
// round — kept separate from kitty-catch.ts (pure game mechanics, no
// storage) the same way paw-tokens.ts is kept separate from tasks.ts
// elsewhere in this app. This is the ONLY place that reads/writes the
// saved high score or the daily reward counters, and the only place that
// ever awards Happiness/Paw Tokens for playing this game — the game
// component itself just calls completeKittyCatchRound(score) once per
// finished round and renders whatever comes back.

const HIGH_SCORE_STORAGE_KEY = '@ProductivityPet:kittyCatchHighScore';
const DAILY_REWARDS_STORAGE_KEY = '@ProductivityPet:kittyCatchDailyRewards';

// The app's actual reward amounts/limits for this game.
export const KITTY_CATCH_HAPPINESS_REWARD = 10;
export const KITTY_CATCH_PLAY_REWARD = 5;
export const KITTY_CATCH_HIGH_SCORE_BONUS = 10;
export const KITTY_CATCH_DAILY_PLAY_REWARD_LIMIT = 3;
export const KITTY_CATCH_DAILY_HIGH_SCORE_BONUS_LIMIT = 3;

type DailyRewardRecord = {
  date: string; // YYYY-MM-DD, local calendar date (see todayISO in tasks.ts)
  playRewardsGiven: number;
  highScoreBonusGiven: number;
};

function createDefaultDailyRecord(date: string): DailyRewardRecord {
  return { date, playRewardsGiven: 0, highScoreBonusGiven: 0 };
}

// In-memory caches, same "undefined = not loaded yet this session" /
// "loaded value, possibly a fresh default" convention used by
// cachedEquippedId in pet-equipment.ts and cachedOwnedIds in
// shop-inventory.ts.
let cachedHighScore: number | undefined = undefined;
let cachedDailyRecord: DailyRewardRecord | undefined = undefined;

async function loadHighScore(): Promise<number> {
  if (cachedHighScore !== undefined) return cachedHighScore;
  try {
    const stored = await AsyncStorage.getItem(HIGH_SCORE_STORAGE_KEY);
    const parsed = stored !== null ? Number(stored) : 0;
    cachedHighScore = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    cachedHighScore = 0;
  }
  return cachedHighScore;
}

function saveHighScore(score: number): void {
  cachedHighScore = score;
  AsyncStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(score)).catch(() => {});
}

// Read-only: lets the hub/game screen show "Best: N" before a round even
// starts, without needing to play one first.
export async function getKittyCatchHighScore(): Promise<number> {
  return loadHighScore();
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
        typeof (parsed as DailyRewardRecord).playRewardsGiven === 'number' &&
        typeof (parsed as DailyRewardRecord).highScoreBonusGiven === 'number'
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

export type KittyCatchRewardOutcome = {
  eligible: boolean;
  awarded: boolean;
  amount: number;
  // Why `awarded` is false despite being `eligible` — undefined when
  // awarded is true, or when the round was never eligible in the first
  // place (e.g. not a new high score).
  reason?: 'daily-limit-reached';
};

export type KittyCatchRoundResult = {
  score: number;
  previousHighScore: number;
  highScore: number; // the saved high score AFTER this round (same as previousHighScore if not beaten)
  isNewHighScore: boolean;
  // The actual Happiness delta applied (can be less than
  // KITTY_CATCH_HAPPINESS_REWARD, including 0, if Happiness was already
  // near/at the 100 cap) — playing still counts and Paw Token rewards
  // below are completely unaffected by this.
  happinessAwarded: number;
  playReward: KittyCatchRewardOutcome;
  highScoreBonus: KittyCatchRewardOutcome;
  totalPawTokensAwarded: number;
  profile: PetProfile;
};

// Serializes the whole read-check-award-write cycle so two completed
// rounds reported close together can't both read the same pre-reward
// profile/daily-record and double-award — same technique as
// purchaseShopItem (shop-inventory.ts), equipAccessory (pet-equipment.ts),
// and growPet (pet-growth.ts). The game screen itself also only ever calls
// this once per finished round (guarded by a ref), but this is the real
// data-integrity backstop.
let pendingRound: Promise<KittyCatchRoundResult> | null = null;

export function completeKittyCatchRound(score: number): Promise<KittyCatchRoundResult> {
  const previous = pendingRound ?? Promise.resolve();
  const next = previous.then(() => runCompleteRound(score), () => runCompleteRound(score));
  pendingRound = next;
  return next;
}

async function runCompleteRound(score: number): Promise<KittyCatchRoundResult> {
  // Happiness is a decaying need (unlike Paw Tokens), so this round's +10
  // should apply on top of whatever Happiness is RIGHT NOW — catching up
  // any elapsed-time decay (and bedtime boundaries) first, same ordering
  // feedPet/bathePet/playWithPet already use, before adding this round's
  // reward on top of that current value.
  const profileBeforeReward = await loadPetProfileWithNeedsUpdate();
  const previousHighScore = await loadHighScore();
  const dailyRecord = await loadDailyRecord();

  const isNewHighScore = score > previousHighScore;
  const nextHighScore = isNewHighScore ? score : previousHighScore;

  const nextHappiness = clampNeedValue(profileBeforeReward.happiness + KITTY_CATCH_HAPPINESS_REWARD);
  const happinessAwarded = nextHappiness - profileBeforeReward.happiness;

  // Every finished round is eligible for the normal play reward, subject
  // only to the daily limit.
  const playRewardEligible = true;
  const playRewardWithinLimit = dailyRecord.playRewardsGiven < KITTY_CATCH_DAILY_PLAY_REWARD_LIMIT;
  const playReward: KittyCatchRewardOutcome = {
    eligible: playRewardEligible,
    awarded: playRewardWithinLimit,
    amount: playRewardWithinLimit ? KITTY_CATCH_PLAY_REWARD : 0,
    reason: playRewardWithinLimit ? undefined : 'daily-limit-reached',
  };

  // The high-score bonus requires BOTH a genuinely new saved high score
  // AND that score being at least KITTY_CATCH_MIN_SCORE_FOR_BONUS — this
  // is what stops someone from farming the bonus by deliberately scoring
  // 1, then 2, then 3, etc.
  const highScoreBonusEligible = isNewHighScore && score >= KITTY_CATCH_MIN_SCORE_FOR_BONUS;
  const highScoreBonusWithinLimit =
    highScoreBonusEligible && dailyRecord.highScoreBonusGiven < KITTY_CATCH_DAILY_HIGH_SCORE_BONUS_LIMIT;
  const highScoreBonus: KittyCatchRewardOutcome = {
    eligible: highScoreBonusEligible,
    awarded: highScoreBonusWithinLimit,
    amount: highScoreBonusWithinLimit ? KITTY_CATCH_HIGH_SCORE_BONUS : 0,
    reason:
      highScoreBonusEligible && !highScoreBonusWithinLimit ? 'daily-limit-reached' : undefined,
  };

  const totalPawTokensAwarded = playReward.amount + highScoreBonus.amount;

  const updatedProfile: PetProfile = {
    ...profileBeforeReward,
    happiness: nextHappiness,
    pawTokens: profileBeforeReward.pawTokens + totalPawTokensAwarded,
  };
  savePetProfile(updatedProfile);

  if (isNewHighScore) {
    saveHighScore(nextHighScore);
  }

  saveDailyRecord({
    date: dailyRecord.date,
    playRewardsGiven: dailyRecord.playRewardsGiven + (playReward.awarded ? 1 : 0),
    highScoreBonusGiven: dailyRecord.highScoreBonusGiven + (highScoreBonus.awarded ? 1 : 0),
  });

  return {
    score,
    previousHighScore,
    highScore: nextHighScore,
    isNewHighScore,
    happinessAwarded,
    playReward,
    highScoreBonus,
    totalPawTokensAwarded,
    profile: updatedProfile,
  };
}
