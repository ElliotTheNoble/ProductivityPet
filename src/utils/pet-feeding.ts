import { loadPetProfileWithNeedsUpdate } from '@/utils/pet-needs';
import { clampNeedValue, savePetProfile, type PetProfile } from '@/utils/pet-profile';

// Feeding — the first Pet Care player ACTION (as opposed to the passive,
// real-elapsed-time decay in src/utils/pet-needs.ts). Deliberately its own
// file: pet-needs.ts's own header comment scopes it to time-based decay
// math specifically, and feeding is an instant, player-triggered change,
// not a function of elapsed time. Future actions (cleaning, playing, etc.)
// are expected to follow this same shape in their own small files.
//
// Pure and side-effect-free, same as every function in pet-needs.ts: takes
// a PetProfile, returns a new one (or the exact same reference back when
// nothing changed) — it doesn't load, save, or touch lastUpdatedAt itself.
// A future Feed button only needs to load the current profile, call this,
// and save the result if it differs — no UI, inventory, cost, or reward
// logic lives here yet.

// How many Hunger points one feeding restores.
export const FEED_HUNGER_AMOUNT = 20;

// Increases Hunger by FEED_HUNGER_AMOUNT, clamped so it never exceeds 100.
// Touches Hunger only — Cleanliness, Happiness, Energy, Paw Tokens,
// isSleeping, isSick, hasPoop, and adoptionDate all pass through unchanged.
export function applyFeeding(profile: PetProfile): PetProfile {
  const nextHunger = clampNeedValue(profile.hunger + FEED_HUNGER_AMOUNT);
  if (nextHunger === profile.hunger) return profile;
  return { ...profile, hunger: nextHunger };
}

// The persistent version of feeding — what a future Feed button actually
// calls. Loads the current profile through loadPetProfileWithNeedsUpdate
// (see pet-needs.ts) FIRST, so any real elapsed time — including any
// bedtime boundaries crossed — is caught up and (if changed) already saved
// before applyFeeding ever runs. That ordering matters: feeding Hunger
// before catching up decay would let a stale, pre-decay Hunger value get
// topped up instead of the real current one, and could make the elapsed
// window look like it had already been "spent" by the feed action instead
// of by actual decay.
//
// applyFeeding itself never reads or writes lastUpdatedAt, and doesn't
// depend on elapsed time at all (it's a flat +20, not a rate), so calling
// it after the needs-update load can't cause any decay to be lost or
// double-counted — it only ever changes Hunger.
//
// Only saves when Hunger actually changed (i.e. wasn't already 100) —
// mirrors loadPetProfileWithNeedsUpdate's own "same reference back = skip
// the save" convention. savePetProfile (see pet-profile.ts) stamps
// lastUpdatedAt to the current time on this save, same as every other
// save in the app; every other field, including adoptionDate, Cleanliness,
// Happiness, Energy, Paw Tokens, isSleeping, isSick, and hasPoop, is
// preserved exactly as loadPetProfileWithNeedsUpdate left it.
export async function feedPet(now: Date = new Date()): Promise<PetProfile> {
  const profile = await loadPetProfileWithNeedsUpdate(now);
  const fed = applyFeeding(profile);
  if (fed !== profile) {
    savePetProfile(fed);
  }
  return fed;
}
