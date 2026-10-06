import { loadPetProfileWithNeedsUpdate } from '@/utils/pet-needs';
import { clampNeedValue, savePetProfile, type PetProfile } from '@/utils/pet-profile';

// Playing — the third Pet Care player ACTION, following the exact same
// shape as Feeding's and Bathing's pure calculations (see
// src/utils/pet-feeding.ts and src/utils/pet-bathing.ts): its own small
// file, pure and side-effect-free, touching only the one need it owns.
// Keeping each action in its own file is what lets Feeding, Bathing,
// Playing, and future actions be added independently without any of them
// having to be edited when another one is introduced.
//
// Pure, same as applyFeeding/applyBathing: takes a PetProfile, returns a
// new one (or the exact same reference back when nothing changed) — it
// doesn't load, save, or touch lastUpdatedAt itself. A future Play button
// only needs to load the current profile, call this, and save the result
// if it differs — no UI, inventory, cost, or reward logic lives here yet.

// How many Happiness points one play session restores.
export const PLAY_HAPPINESS_AMOUNT = 20;

// Increases Happiness by PLAY_HAPPINESS_AMOUNT, clamped so it never
// exceeds 100. Touches Happiness only — Hunger, Cleanliness, Energy, Paw
// Tokens, isSleeping, isSick, hasPoop, adoptionDate, and lastUpdatedAt all
// pass through unchanged.
export function applyPlaying(profile: PetProfile): PetProfile {
  const nextHappiness = clampNeedValue(profile.happiness + PLAY_HAPPINESS_AMOUNT);
  if (nextHappiness === profile.happiness) return profile;
  return { ...profile, happiness: nextHappiness };
}

// The persistent version of playing — what a future Play button actually
// calls. Follows the exact same shape as feedPet() and bathePet() (see
// pet-feeding.ts and pet-bathing.ts): loads the current profile through
// loadPetProfileWithNeedsUpdate (see pet-needs.ts) FIRST, so any real
// elapsed time — including bedtime boundaries crossed — is caught up and
// (if changed) already saved before applyPlaying ever runs. That ordering
// matters for the same reason it does for feeding/bathing: playing with a
// stale, pre-decay Happiness value instead of the real current one would
// effectively let the elapsed window get "spent" by the play action
// instead of by actual decay.
//
// applyPlaying itself never reads or writes lastUpdatedAt and doesn't
// depend on elapsed time (it's a flat +20, not a rate), so calling it
// after the needs-update load can't cause any decay to be lost or
// double-counted — it only ever changes Happiness.
//
// Only saves when Happiness actually changed (i.e. wasn't already 100) —
// mirrors feedPet()/bathePet()'s own "same reference back = skip the
// save" convention. savePetProfile stamps lastUpdatedAt to the current
// time on this save, same as every other save in the app; every other
// field, including adoptionDate, Hunger, Cleanliness, Energy, Paw Tokens,
// isSleeping, isSick, and hasPoop, is preserved exactly as
// loadPetProfileWithNeedsUpdate left it.
export async function playWithPet(now: Date = new Date()): Promise<PetProfile> {
  const profile = await loadPetProfileWithNeedsUpdate(now);
  const played = applyPlaying(profile);
  if (played !== profile) {
    savePetProfile(played);
  }
  return played;
}
