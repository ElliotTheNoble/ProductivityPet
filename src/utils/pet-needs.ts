import { advanceSelectedPetAndGetProfile } from '@/utils/pet-family';
import type { PetProfile } from '@/utils/pet-profile-model';

// Every need/bedtime function lives (unchanged) in @/utils/pet-needs-core.ts;
// this file re-exports them so existing imports keep working, and adds
// loadPetProfileWithNeedsUpdate, which now catches up the whole pet family
// (every living pet's needs, sleep and health) and returns the SELECTED pet's
// profile — see @/utils/pet-family.ts.
export * from '@/utils/pet-needs-core';

export async function loadPetProfileWithNeedsUpdate(now: Date = new Date()): Promise<PetProfile> {
  return advanceSelectedPetAndGetProfile(now);
}
