import { DEV_BYPASS_GROWTH_TASK_REQUIREMENT } from '@/utils/dev-flags';
import { getPetProfile, savePetProfile, type PetProfile } from '@/utils/pet-profile';
import { PET_STAGES, TASKS_PER_STAGE, getPetStageIndex, type PetStage, type StageProgress } from '@/utils/pet-stage';

// Paid pet growth — Young and Adult are no longer automatic. Deliberately
// its own file, separate from pet-stage.ts (which stays exactly as it was,
// still the pure "automatic stage from completed-task count" math used by
// Egg/Hatchling/Baby) and from pet-profile.ts (which still owns the
// paidStageIndex field itself). This only ever READS the profile's
// pawTokens/paidStageIndex and, on a successful upgrade, SPENDS pawTokens
// and raises paidStageIndex by exactly one stage — same shape as
// purchaseShopItem in shop-inventory.ts.

// Highest stage index that still advances automatically and for free,
// purely from completed-task count — Baby (index 2). Young (3) and Adult
// (4) only ever advance via a successful growPet() call below.
const FREE_AUTO_MAX_STAGE_INDEX = 2;

type GrowthRequirement = { taskThreshold: number; cost: number };

// Keyed by the stage index being grown FROM. Egg/Hatchling need no entry
// (still fully automatic); Adult (index 4) has no entry since it's the max
// stage and can't grow further.
const GROWTH_REQUIREMENTS: Partial<Record<number, GrowthRequirement>> = {
  2: { taskThreshold: 30, cost: 500 }, // Baby -> Young
  3: { taskThreshold: 40, cost: 1000 }, // Young -> Adult
};

// The stage actually shown on the pet. Egg/Hatchling/Baby derive live from
// completedTaskCount exactly as pet-stage.ts always has (capped here at
// Baby); Young/Adult only ever show once paidStageIndex has been raised by
// a successful growPet() call, regardless of how many tasks are completed
// — reaching the task threshold alone never advances past Baby. Once paid,
// the stage never drops back down even if a task gets unchecked afterward
// (paidStageIndex only ever increases, via growPet).
export function getRenderedStageIndex(completedTaskCount: number, paidStageIndex: number): number {
  const freeIndex = Math.min(getPetStageIndex(completedTaskCount), FREE_AUTO_MAX_STAGE_INDEX);
  return Math.max(freeIndex, paidStageIndex);
}

export function getRenderedStage(completedTaskCount: number, paidStageIndex: number): PetStage {
  return PET_STAGES[getRenderedStageIndex(completedTaskCount, paidStageIndex)];
}

// The same "how far into this stage" picture as pet-stage.ts's
// getStageProgress, but built on getRenderedStageIndex above instead of
// raw completedTaskCount — so this can never show a stage/level BELOW the
// one actually shown on the pet (e.g. "Level 1" while the pet art is
// Adult), and can never show Young/Adult from task count alone before
// either has actually been paid for. See bugs.md (BUG-004) for the full
// writeup of why PetProgress and the Stats page needed this.
//
// tasksIntoStage is clamped to [0, TASKS_PER_STAGE] rather than computed
// as a raw difference — it would otherwise go negative (a paid stage held
// up above what current completedTaskCount alone would justify, e.g.
// after unchecking/removing tasks post-upgrade) or overshoot past
// TASKS_PER_STAGE (plenty of completed tasks but capped at Baby because
// Young/Adult haven't been paid for yet). Either way the bar simply reads
// as empty or full, which is the only sensible rendering once the shown
// stage has decoupled from a simple "completedTaskCount / 10" reading.
export function getRenderedStageProgress(completedTaskCount: number, paidStageIndex: number): StageProgress {
  const stageIndex = getRenderedStageIndex(completedTaskCount, paidStageIndex);
  const isMaxStage = stageIndex === PET_STAGES.length - 1;
  const rawTasksIntoStage = completedTaskCount - stageIndex * TASKS_PER_STAGE;
  const tasksIntoStage = isMaxStage ? TASKS_PER_STAGE : Math.min(TASKS_PER_STAGE, Math.max(0, rawTasksIntoStage));

  return {
    stage: PET_STAGES[stageIndex],
    stageIndex,
    level: stageIndex + 1,
    isMaxStage,
    tasksIntoStage,
    tasksUntilNextStage: isMaxStage ? 0 : TASKS_PER_STAGE - tasksIntoStage,
    progressPercent: Math.round((tasksIntoStage / TASKS_PER_STAGE) * 100),
    nextStage: isMaxStage ? null : PET_STAGES[stageIndex + 1],
  };
}

export type GrowthEligibility =
  | { canGrow: false; reason: 'max-stage' | 'not-eligible-yet' }
  | { canGrow: true; nextStage: PetStage; cost: number; tasksNeeded: number };

// Whether the pet currently shown at renderedStageIndex can be grown right
// now — purely informational (e.g. for a UI prompt). growPet() below
// re-derives and re-checks all of this itself against the real saved
// profile rather than trusting a value computed earlier by the caller.
export function getGrowthEligibility(renderedStageIndex: number, completedTaskCount: number): GrowthEligibility {
  const requirement = GROWTH_REQUIREMENTS[renderedStageIndex];
  if (!requirement) return { canGrow: false, reason: 'max-stage' };
  if (!DEV_BYPASS_GROWTH_TASK_REQUIREMENT && completedTaskCount < requirement.taskThreshold) {
    return { canGrow: false, reason: 'not-eligible-yet' };
  }
  return {
    canGrow: true,
    nextStage: PET_STAGES[renderedStageIndex + 1],
    cost: requirement.cost,
    tasksNeeded: requirement.taskThreshold,
  };
}

export type GrowResult =
  | { success: true; newStage: PetStage; profile: PetProfile }
  | { success: false; reason: 'not-eligible' | 'insufficient-funds' };

// Serializes the whole read-check-spend-write cycle so two grow attempts
// triggered close together can't both read the same pre-upgrade profile
// and double-spend/double-advance — same technique as purchaseShopItem in
// shop-inventory.ts and equipAccessory in pet-equipment.ts.
let pendingGrowth: Promise<GrowResult> = Promise.resolve({ success: false, reason: 'not-eligible' });

export function growPet(completedTaskCount: number): Promise<GrowResult> {
  const next = pendingGrowth.then(() => runGrowPet(completedTaskCount));
  pendingGrowth = next;
  return next;
}

async function runGrowPet(completedTaskCount: number): Promise<GrowResult> {
  const profile = await getPetProfile();
  const renderedStageIndex = getRenderedStageIndex(completedTaskCount, profile.paidStageIndex);
  const eligibility = getGrowthEligibility(renderedStageIndex, completedTaskCount);
  if (!eligibility.canGrow) {
    return { success: false, reason: 'not-eligible' };
  }
  if (profile.pawTokens < eligibility.cost) {
    return { success: false, reason: 'insufficient-funds' };
  }

  // Tokens are only ever deducted here, together with raising
  // paidStageIndex, in this one save — never before eligibility/funds are
  // confirmed, and never as a separate step that could leave the pet
  // un-advanced after tokens were already spent.
  const updated: PetProfile = {
    ...profile,
    pawTokens: profile.pawTokens - eligibility.cost,
    paidStageIndex: renderedStageIndex + 1,
  };
  savePetProfile(updated);

  return { success: true, newStage: eligibility.nextStage, profile: updated };
}
