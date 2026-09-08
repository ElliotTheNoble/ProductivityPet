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
