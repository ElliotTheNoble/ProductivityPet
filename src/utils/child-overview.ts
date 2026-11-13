import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSelectableChildren } from '@/utils/family-profiles';
import { FAMILY_KEY_NAME, getPetLabel, parseSavedFamily } from '@/utils/pet-family';
import { RECOVERY_NEED_THRESHOLD } from '@/utils/pet-family-config';
import { advancePet, isEggStage } from '@/utils/pet-lifecycle-core';
import { safetyRulesForProfile } from '@/utils/pet-safety';
import { checkParentAction } from '@/utils/parent-session';
import { ensureProfilesReady, scopedKeyFor } from '@/utils/profiles';

// What the Parent Dashboard may show about a child: who the active children are, and a read-only summary of each child's pets. Rules:
//  - a verified parent session has to be open right now (the same check every parent-only action makes);
//  - only ACTIVE children are offered: not archived, a valid unique profile id, and a registered profile (getSelectableChildren);
//  - it reads one stored record per child (the pet family) and works the current care state out on a COPY: nothing is written, nothing
//    is cached, no profile is switched and no store is loaded, so looking at a child can never change them;
//  - it never reads a journal, a task list, a purchase or anything else of a child: only who they are and how their pets are doing;
//  - a record that cannot be read or understood is reported as such, never guessed at.

export type DashboardChild = { id: string; nickname: string };

export type DashboardChildren = { status: 'ok'; children: DashboardChild[] } | { status: 'not-allowed' } | { status: 'unreadable' };

export async function readDashboardChildren(): Promise<DashboardChildren> {
  const check = await checkParentAction('children');
  if (!check.ok) return { status: 'not-allowed' };
  try {
    const children = await getSelectableChildren();
    return { status: 'ok', children: children.map((c) => ({ id: c.id, nickname: c.nickname })) };
  } catch {
    return { status: 'unreadable' };
  }
}

// healthy: doing well. needs-care: not sick yet, but hungry, dirty or unhappy. sick / critical / deceased: as the pet lifecycle says.
// pawadise: retired to Pet Pawadise (frozen, never sick).
export type OverviewPetState = 'healthy' | 'needs-care' | 'sick' | 'critical' | 'deceased' | 'pawadise';

export type OverviewPet = { id: string; label: string; state: OverviewPetState };

export type ChildOverview =
  | { status: 'ok'; childId: string; nickname: string; pets: OverviewPet[]; asOf: string }
  // The child has not opened the app yet: no saved pets (the starter egg is created the first time they do).
  | { status: 'not-started'; childId: string; nickname: string }
  | { status: 'not-allowed' }
  | { status: 'not-a-child' }
  | { status: 'unreadable' };

export async function readChildOverview(childId: string, now: Date = new Date()): Promise<ChildOverview> {
  const check = await checkParentAction('children');
  if (!check.ok) return { status: 'not-allowed' };
  try {
    await ensureProfilesReady();
    const child = (await getSelectableChildren()).find((c) => c.id === childId);
    if (!child) return { status: 'not-a-child' };
    const raw = await AsyncStorage.getItem(scopedKeyFor(childId, FAMILY_KEY_NAME));
    if (raw === null) return { status: 'not-started', childId, nickname: child.nickname };
    const family = parseSavedFamily(JSON.parse(raw));
    if (!family) return { status: 'unreadable' };
    const pets: OverviewPet[] = family.pets.map((saved) => {
      const label = getPetLabel(saved, family.pets);
      if (saved.retired) return { id: saved.id, label, state: 'pawadise' };
      const pet = advancePet(saved, now, false, safetyRulesForProfile(childId));
      switch (pet.lifecycle.state) {
        case 'deceased':
          return { id: saved.id, label, state: 'deceased' };
        case 'critical':
          return { id: saved.id, label, state: 'critical' };
        case 'sick':
          return { id: saved.id, label, state: 'sick' };
        default: {
          const low =
            !isEggStage(pet.growthUnits) &&
            (pet.profile.hunger < RECOVERY_NEED_THRESHOLD || pet.profile.cleanliness < RECOVERY_NEED_THRESHOLD || pet.profile.happiness < RECOVERY_NEED_THRESHOLD);
          return { id: saved.id, label, state: low ? 'needs-care' : 'healthy' };
        }
      }
    });
    return { status: 'ok', childId, nickname: child.nickname, pets, asOf: now.toISOString() };
  } catch {
    return { status: 'unreadable' };
  }
}
