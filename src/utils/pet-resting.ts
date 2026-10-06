import { loadPetProfileWithNeedsUpdate } from '@/utils/pet-needs';
import { clampNeedValue, savePetProfile, type PetProfile } from '@/utils/pet-profile';

// Resting — the fourth Pet Care player ACTION, following the exact same
// shape as Feeding's, Bathing's, and Playing's pure calculations (see
// src/utils/pet-feeding.ts, src/utils/pet-bathing.ts, and
// src/utils/pet-playing.ts): its own small file, pure and side-effect-
// free, touching only the one need it owns. Keeping each action in its
// own file is what lets Feeding, Bathing, Playing, Resting, and future
// actions be added independently without any of them having to be edited
// when another one is introduced.
//
// Rest is a deliberately separate, manual way to restore Energy — it is
// NOT the automatic 8 PM-8 AM bedtime system (see src/utils/pet-bedtime.ts
// and resolvePetNeedsAcrossBedtime in src/utils/pet-needs.ts), which is
// untouched by this file and keeps working exactly as it did before. That
// system already recovers Energy automatically while isSleeping is true
// overnight; Rest is an additional, player-triggered top-up on top of
// that, not a replacement for it.
//
// Pure, same as applyFeeding/applyBathing/applyPlaying: takes a
// PetProfile, returns a new one (or the exact same reference back when
// nothing changed) — it doesn't load, save, or touch lastUpdatedAt or
// isSleeping itself. A future Rest button only needs to load the current
// profile, call this, and save the result if it differs — no UI,
// inventory, cost, or reward logic lives here yet.

// How many Energy points one rest restores.
export const REST_ENERGY_AMOUNT = 20;

// Increases Energy by REST_ENERGY_AMOUNT, clamped so it never exceeds 100.
// Touches Energy only — Hunger, Cleanliness, Happiness, Paw Tokens,
// isSleeping, isSick, hasPoop, adoptionDate, and lastUpdatedAt all pass
// through unchanged.
export function applyResting(profile: PetProfile): PetProfile {
  const nextEnergy = clampNeedValue(profile.energy + REST_ENERGY_AMOUNT);
  if (nextEnergy === profile.energy) return profile;
  return { ...profile, energy: nextEnergy };
}

// The persistent version of resting — what a future Rest button actually
// calls. Follows the exact same shape as feedPet()/bathePet()/
// playWithPet() (see pet-feeding.ts, pet-bathing.ts, and pet-playing.ts):
// loads the current profile through loadPetProfileWithNeedsUpdate (see
// pet-needs.ts) FIRST, so any real elapsed time — including the automatic
// bedtime system's own boundary handling and whatever Energy change that
// produces — is caught up and (if changed) already saved before
// applyResting ever runs. That ordering matters for the same reason it
// does for the other three actions: resting a stale, pre-decay Energy
// value instead of the real current one would effectively let the
// elapsed window get "spent" by the rest action instead of by actual
// decay/recovery.
//
// applyResting itself never reads or writes lastUpdatedAt or isSleeping
// and doesn't depend on elapsed time (it's a flat +20, not a rate), so
// calling it after the needs-update load can't cause any decay/recovery
// to be lost or double-counted, and it can't interfere with the automatic
// bedtime system — it only ever changes Energy.
//
// Only saves when Energy actually changed (i.e. wasn't already 100) —
// mirrors the other three actions' own "same reference back = skip the
// save" convention. savePetProfile stamps lastUpdatedAt to the current
// time on this save, same as every other save in the app; every other
// field, including adoptionDate, Hunger, Cleanliness, Happiness, Paw
// Tokens, isSleeping, isSick, and hasPoop, is preserved exactly as
// loadPetProfileWithNeedsUpdate left it.
export async function restPet(now: Date = new Date()): Promise<PetProfile> {
  const profile = await loadPetProfileWithNeedsUpdate(now);
  const rested = applyResting(profile);
  if (rested !== profile) {
    savePetProfile(rested);
  }
  return rested;
}
