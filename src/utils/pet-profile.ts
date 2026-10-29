import { getPetProfileForSelectedPet, savePetProfileForSelectedPet, subscribeToSelectedPetProfile } from '@/utils/pet-family';

// The Pet Profile API every screen and utility already uses. Since the app
// supports a family of pets, these three functions now work on the SELECTED
// pet (and the shared Paw Token wallet) — the data model itself lives in
// @/utils/pet-profile-model.ts and the storage in @/utils/pet-family.ts.
// Re-exporting the model here means no existing import had to change.
export * from '@/utils/pet-profile-model';

// The selected pet's profile, with pawTokens showing the player's shared
// wallet balance (tokens belong to the player, not to one pet).
export function getPetProfile() {
  return getPetProfileForSelectedPet();
}

// Saves changes to the selected pet's profile; a changed pawTokens value is
// written to the shared wallet instead. Changing only pawTokens never
// touches the pet itself. Deceased pets ignore everything except tokens.
export function savePetProfile(profile: Parameters<typeof savePetProfileForSelectedPet>[0]): void {
  savePetProfileForSelectedPet(profile);
}

// Notified whenever the selected pet, its data, or the wallet changes.
export function subscribeToPetProfile(
  listener: Parameters<typeof subscribeToSelectedPetProfile>[0]
): () => void {
  return subscribeToSelectedPetProfile(listener);
}
