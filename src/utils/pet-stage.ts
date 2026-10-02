export type PetStage = 'Egg' | 'Hatchling' | 'Baby' | 'Young' | 'Adult';

export const PET_STAGES: PetStage[] = ['Egg', 'Hatchling', 'Baby', 'Young', 'Adult'];

// How many completed tasks it takes to advance one stage. Both Pet Progress
// and the living-room pet derive their stage from this same formula, so the
// pet shown in the room always matches the Pet Progress card.
export const TASKS_PER_STAGE = 10;

const MAX_STAGE_INDEX = PET_STAGES.length - 1;

export function getPetStageIndex(completedTaskCount: number): number {
  return Math.min(Math.floor(completedTaskCount / TASKS_PER_STAGE), MAX_STAGE_INDEX);
}

export function getPetStage(completedTaskCount: number): PetStage {
  return PET_STAGES[getPetStageIndex(completedTaskCount)];
}

export type StageProgress = {
  stage: PetStage;
  stageIndex: number;
  level: number;
  isMaxStage: boolean;
  tasksIntoStage: number;
  tasksUntilNextStage: number;
  progressPercent: number;
  nextStage: PetStage | null;
};

// Same "how far into this stage" formulas PetProgress already computes
// inline (see src/components/pet-progress.tsx) — exported here as a
// reusable pure function purely so other screens (the Stats page's own
// custom layout) can derive the identical picture without duplicating the
// arithmetic. PetProgress itself is left exactly as-is and does not use
// this — this is purely additive, so nothing that already depends on
// getPetStage/getPetStageIndex is affected.
export function getStageProgress(completedTaskCount: number): StageProgress {
  const stageIndex = getPetStageIndex(completedTaskCount);
  const isMaxStage = stageIndex === MAX_STAGE_INDEX;
  const tasksIntoStage = isMaxStage
    ? TASKS_PER_STAGE
    : completedTaskCount - stageIndex * TASKS_PER_STAGE;

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
