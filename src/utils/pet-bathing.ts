import { loadPetProfileWithNeedsUpdate } from '@/utils/pet-needs';
import { clampNeedValue, savePetProfile, type PetProfile } from '@/utils/pet-profile';

// Bathing — the second Pet Care player ACTION, following the exact same
// shape as Feeding's pure calculation (see src/utils/pet-feeding.ts): its
// own small file, pure and side-effect-free, touching only the one need it
// owns. Keeping each action in its own file is what lets Feeding, Bathing,
// and future actions (playing, etc.) be added independently without any
// of them having to be edited when another one is introduced.
//
// Pure, same as applyFeeding: takes a PetProfile, returns a new one (or
// the exact same reference back when nothing changed) — it doesn't load,
// save, or touch lastUpdatedAt itself. A future Bath button only needs to
// load the current profile, call this, and save the result if it differs
// — no UI, inventory, cost, or reward logic lives here yet.

// How many Cleanliness points one bath restores.
export const BATHE_CLEANLINESS_AMOUNT = 25;

// Increases Cleanliness by BATHE_CLEANLINESS_AMOUNT, clamped so it never
// exceeds 100. Touches Cleanliness only — Hunger, Happiness, Energy, Paw
// Tokens, isSleeping, isSick, hasPoop, adoptionDate, and lastUpdatedAt all
// pass through unchanged.
export function applyBathing(profile: PetProfile): PetProfile {
  const nextCleanliness = clampNeedValue(profile.cleanliness + BATHE_CLEANLINESS_AMOUNT);
  if (nextCleanliness === profile.cleanliness) return profile;
  return { ...profile, cleanliness: nextCleanliness };
}

// The persistent version of bathing — what a future Bath button actually
// calls. Follows the exact same shape as feedPet() (see pet-feeding.ts):
// loads the current profile through loadPetProfileWithNeedsUpdate (see
// pet-needs.ts) FIRST, so any real elapsed time — including bedtime
// boundaries crossed — is caught up and (if changed) already saved before
// applyBathing ever runs. That ordering matters for the same reason it
// does for feeding: bathing a stale, pre-decay Cleanliness value instead
// of the real current one would effectively let the elapsed window get
// "spent" by the bathe action instead of by actual decay.
//
// applyBathing itself never reads or writes lastUpdatedAt and doesn't
// depend on elapsed time (it's a flat +25, not a rate), so calling it
// after the needs-update load can't cause any decay to be lost or
// double-counted — it only ever changes Cleanliness.
//
// Only saves when Cleanliness actually changed (i.e. wasn't already 100)
// — mirrors feedPet()'s own "same reference back = skip the save"
// convention. savePetProfile stamps lastUpdatedAt to the current time on
// this save, same as every other save in the app; every other field,
// including adoptionDate, Hunger, Happiness, Energy, Paw Tokens,
// isSleeping, isSick, and hasPoop, is preserved exactly as
// loadPetProfileWithNeedsUpdate left it.
export async function bathePet(now: Date = new Date()): Promise<PetProfile> {
  const profile = await loadPetProfileWithNeedsUpdate(now);
  const bathed = applyBathing(profile);
  if (bathed !== profile) {
    savePetProfile(bathed);
  }
  return bathed;
}
