// Tunable numbers for the pet family, health and resurrection systems, kept
// in one place so none of them is hard-coded in a screen.

// How many LIVING pets a player can have at once. Deceased pets don't count.
// Raise this to add more slots — nothing else assumes 3.
export const MAX_LIVING_PETS = 3;

// ---- Health ----
// Sick -> Critical after this long without recovering.
export const SICK_TO_CRITICAL_HOURS = 24;
// Critical -> Deceased after this much MORE time (96 hours in total from the
// moment sickness began).
export const CRITICAL_TO_DEATH_HOURS = 72;
// A sick or critical pet recovers (free) once Hunger, Cleanliness and
// Happiness are ALL at least this high.
export const RECOVERY_NEED_THRESHOLD = 50;
// A pet that fell asleep from exhaustion (Energy 0) wakes once Energy has
// recovered to this level.
export const EXHAUSTION_WAKE_ENERGY = 50;

// ---- Pet Care Supplies (Shop) ----
export const WASHCLOTH_PRICE = 10; // Paw Tokens; needed for each Gentle Wipe-Down
export const MEDICINE_PRICE = 50; // Paw Tokens
export const MEDICINE_NEED_BOOST = 25; // Hunger and Happiness each

// ---- Resurrection ----
export const RESURRECTION_COST = 500; // Paw Tokens, never changes, never expires
export const RESURRECTION_RESTORED_NEED_VALUE = 75; // Hunger/Cleanliness/Happiness/Energy
export const RESURRECTION_ANIMATION_MS = 60_000;

// ---- Growth ----
// Growth credit is stored as whole "units" so splitting a task's growth
// between pets never loses anything to rounding: one completed task is
// GROWTH_UNITS_PER_TASK units, and 27720 divides evenly by every pet count
// from 1 to 12 (it is their least common multiple).
export const GROWTH_UNITS_PER_TASK = 27720;

// ---- Paw Token rewards for completing a task ----
// Keyed by the number of LIVING pets. One combined reward per completed task
// (tokens belong to the player). Mini-game and appointment rewards are not
// affected. More living pets than listed here fall back to base x pets.
export const TASK_TOKEN_REWARDS_BY_LIVING_PETS: Record<number, { regular: number; important: number }> = {
  1: { regular: 10, important: 15 },
  2: { regular: 20, important: 30 },
  3: { regular: 30, important: 45 },
};

export function getTaskTokenReward(livingPets: number, important: boolean): number {
  // With every pet deceased the player still earns the single-pet amount.
  const pets = Math.max(1, Math.floor(livingPets));
  const tier = TASK_TOKEN_REWARDS_BY_LIVING_PETS[pets];
  if (tier) return important ? tier.important : tier.regular;
  const base = TASK_TOKEN_REWARDS_BY_LIVING_PETS[1];
  return (important ? base.important : base.regular) * pets;
}
