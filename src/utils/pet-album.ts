import { tr } from '@/i18n';
import {
  getPetLabel,
  getPetSpecies,
  isLiving,
  type FamilyState,
  type LifeState,
  type PetEvent,
  type PetRecord,
} from '@/utils/pet-family';
import { GROWTH_UNITS_PER_TASK } from '@/utils/pet-family-config';
import { PET_STAGES, type PetStage } from '@/utils/pet-stage';

// The Pet Album: a look back at every kitty the player has raised — living
// and passed away. It is built straight from the pet family store
// (@/utils/pet-family.ts), which never deletes a pet and keeps each one's
// history, so there is no second copy that could drift out of sync:
//  - a living pet's entry always reflects its current state,
//  - a pet that has passed away keeps its final stage, level, birthday and
//    accessories exactly as they were,
//  - deaths and resurrections are events on the same pet record (same id), so
//    a resurrected pet is the SAME album entry, not a duplicate,
//  - one pet's accessories are never shown on another.

export type PetAlbumEntry = {
  id: string;
  label: string;
  // The pet's name if it has one (the app has no naming feature yet).
  name: string | null;
  // Living (healthy, sick or critical) vs. passed away.
  isActive: boolean;
  lifeState: LifeState;
  isSelected: boolean;
  // Retired in Pet Pawadise (alive and kept safe, but frozen and off the active slots).
  isRetired: boolean;
  retiredAt: string | null;
  // 'cat' for every pet so far (see PetRecord.species).
  species: string;
  // Highest stage / level it has reached.
  stage: PetStage;
  highestLevel: number;
  createdAt: string | null;
  // Born On: when the egg hatched (null = never recorded / not hatched yet).
  hatchedAt: string | null;
  isEgg: boolean;
  // When it passed away, if it is currently passed away.
  diedAt: string | null;
  deathCount: number;
  resurrectionCount: number;
  tasksCounted: number;
  equippedAccessoryIds: string[];
  events: PetEvent[];
};

export function buildAlbumEntries(family: FamilyState): PetAlbumEntry[] {
  const toEntry = (pet: PetRecord): PetAlbumEntry => {
    const peakIndex = Math.max(pet.peak.stageIndex, 0);
    return {
      id: pet.id,
      label: getPetLabel(pet, family.pets),
      name: pet.name,
      isActive: isLiving(pet),
      lifeState: pet.lifecycle.state,
      isSelected: pet.id === family.selectedPetId,
      isRetired: !!pet.retired,
      retiredAt: pet.retired?.since ?? null,
      species: getPetSpecies(pet),
      stage: PET_STAGES[Math.min(peakIndex, PET_STAGES.length - 1)],
      highestLevel: pet.peak.level,
      createdAt: pet.createdAt || null,
      hatchedAt: pet.profile.hatchedAt || null,
      isEgg: Math.floor(pet.growthUnits / GROWTH_UNITS_PER_TASK) < 10 && !pet.profile.hatchedAt,
      diedAt: pet.lifecycle.state === 'deceased' ? (pet.lifecycle.diedAt ?? null) : null,
      deathCount: pet.events.filter((e) => e.type === 'died').length,
      resurrectionCount: pet.events.filter((e) => e.type === 'resurrected').length,
      tasksCounted: pet.tasksCounted,
      equippedAccessoryIds: [pet.equipped.bow, pet.equipped.hat].filter((id): id is string => !!id),
      events: [...pet.events].sort((a, b) => (a.at < b.at ? 1 : -1)),
    };
  };

  const entries = family.pets.map(toEntry);
  const living = entries
    .filter((e) => e.isActive)
    .sort((a, b) => (a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1);
  const retired = entries
    .filter((e) => e.isRetired)
    .sort((a, b) => ((a.retiredAt ?? '') < (b.retiredAt ?? '') ? 1 : -1));
  const passed = entries
    .filter((e) => !e.isActive && !e.isRetired)
    .sort((a, b) => ((a.diedAt ?? '') < (b.diedAt ?? '') ? 1 : -1));
  return [...living, ...retired, ...passed];
}

// Getters, so the label is read in the language that is current when it is shown.
export const EVENT_LABELS: Record<PetEvent['type'], string> = {
  get adopted() {
    return tr('evAdopted');
  },
  get hatched() {
    return tr('evHatched');
  },
  get sick() {
    return tr('evSick');
  },
  get critical() {
    return tr('evCritical');
  },
  get recovered() {
    return tr('evRecovered');
  },
  get died() {
    return tr('evDied');
  },
  get resurrected() {
    return tr('evResurrected');
  },
  get retired() {
    return tr('evRetired');
  },
  get returned() {
    return tr('evReturned');
  },
};
