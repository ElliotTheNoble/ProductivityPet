import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ensureHouseholdLoaded,
  getHouseholdIntegrity,
  isChildArchived,
  type ChildProfile,
  type Household,
} from '@/utils/household';
import { FAMILY_KEY_NAME, parseSavedFamily } from '@/utils/pet-family';
import { RECOVERY_NEED_THRESHOLD } from '@/utils/pet-family-config';
import { advancePet, isEggStage } from '@/utils/pet-lifecycle-core';
import { safetyRulesForProfile } from '@/utils/pet-safety';
import {
  MAIN_PROFILE_ID,
  ensureProfilesReady,
  getProfilesStatus,
  registerChildProfile,
  reloadProfileRegistry,
  scopedKeyFor,
  type ProfileRecord,
} from '@/utils/profiles';

// The bridge between the household (the parent's list of children) and the profile registry (where each child's saved data
// lives), for the family picker that comes later. Nothing here changes any child's data, and nothing here deletes anything.
//
//  - reconcileFamilyProfiles(): makes sure every household child has a registry profile (the SAME id). It only ever ADDS missing
//    registry records; it reports what it cannot resolve (duplicate ids, ids that cannot be profile ids, registry profiles with no
//    household record) and leaves those exactly as they are. Safe to run again and again, also after a crash half way.
//  - selectableChildren(): who a picker may offer. A child is selectable only when it is not archived, its id is a valid profile id
//    shared by no other record, and its profile exists in the registry. So a half-created child is never selectable.
//  - peekProfileCare(): a READ-ONLY summary of a profile's pets (for a "needs care" badge). It reads the saved record with one
//    storage read, works out the current health on a COPY, and writes nothing, loads nothing into the stores and starts nothing.

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type ReconcileReport = {
  // 'unavailable': profile storage is in safe mode. 'unreadable': the household or the registry could not be read, so nothing
  // was changed (without the household, a profile cannot be told apart from a leftover).
  status: 'ok' | 'unavailable' | 'unreadable';
  // Household children whose registry profile was created now.
  registered: string[];
  alreadyLinked: string[];
  // Household children whose id can never be a profile id: not selectable, nothing changed.
  invalidIds: string[];
  // Ids used by more than one household record: not selectable, nothing changed, the household is read-only meanwhile.
  duplicateChildIds: string[];
  // Registry child profiles with no household record (a creation that stopped half way, or a restore). Hidden, never deleted,
  // their data (if any) is untouched.
  orphanProfiles: string[];
  // Children whose registry record could not be written (nothing changed for them; run again later).
  failed: { id: string; reason: string }[];
};

function emptyReport(status: ReconcileReport['status']): ReconcileReport {
  return { status, registered: [], alreadyLinked: [], invalidIds: [], duplicateChildIds: [], orphanProfiles: [], failed: [] };
}

let inFlight: Promise<ReconcileReport> | null = null;

export function reconcileFamilyProfiles(): Promise<ReconcileReport> {
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(): Promise<ReconcileReport> {
  await ensureProfilesReady();
  if (getProfilesStatus().state !== 'ready') return emptyReport('unavailable');
  // Another tab may have added profiles since this one started: look at what is stored now.
  if (!(await reloadProfileRegistry())) return emptyReport('unreadable');
  const household = await ensureHouseholdLoaded();
  const integrity = getHouseholdIntegrity();
  if (integrity.loadFailed) return emptyReport('unreadable');

  const report = emptyReport('ok');
  report.duplicateChildIds = [...integrity.duplicateChildIds];
  const known = new Set(
    getProfilesStatus()
      .profiles.filter((p) => p.kind === 'child')
      .map((p) => p.id)
  );
  const householdIds = new Set(household.children.map((c) => c.id));
  for (const id of integrity.duplicateChildIds) householdIds.add(id);

  for (const child of household.children) {
    if (integrity.duplicateChildIds.includes(child.id)) continue;
    if (!ID_PATTERN.test(child.id) || child.id === MAIN_PROFILE_ID) {
      report.invalidIds.push(child.id);
      continue;
    }
    if (known.has(child.id)) {
      report.alreadyLinked.push(child.id);
      continue;
    }
    const result = await registerChildProfile(child.id);
    if (!result.ok) report.failed.push({ id: child.id, reason: result.reason });
    else if (result.created) report.registered.push(child.id);
    else report.alreadyLinked.push(child.id);
  }
  report.orphanProfiles = getProfilesStatus()
    .profiles.filter((p) => p.kind === 'child' && !householdIds.has(p.id))
    .map((p) => p.id);
  return report;
}

// ---------------------------------------------------------------------------------------------------------
// who the picker may offer

export function selectableChildren(
  household: Household,
  profiles: readonly ProfileRecord[],
  duplicateChildIds: readonly string[]
): ChildProfile[] {
  const registered = new Set(profiles.filter((p) => p.kind === 'child' && p.storage === 'scoped').map((p) => p.id));
  return household.children.filter(
    (c) => !isChildArchived(c) && ID_PATTERN.test(c.id) && c.id !== MAIN_PROFILE_ID && !duplicateChildIds.includes(c.id) && registered.has(c.id)
  );
}

// The same, from the current household and registry (waits for both to be read).
export async function getSelectableChildren(): Promise<ChildProfile[]> {
  await ensureProfilesReady();
  const household = await ensureHouseholdLoaded();
  const integrity = getHouseholdIntegrity();
  if (integrity.loadFailed || getProfilesStatus().state !== 'ready') return [];
  return selectableChildren(household, getProfilesStatus().profiles, integrity.duplicateChildIds);
}

// ---------------------------------------------------------------------------------------------------------
// read-only care summary

export type CareSeverity = 'none' | 'healthy' | 'needs-care' | 'deceased' | 'sick' | 'critical';

export type CareSummary =
  // No saved pets yet (a child who has not opened the app): the starter egg is created the first time they do.
  | { status: 'not-started' }
  // The record could not be read or understood (or the profile is unknown). Nothing is claimed about the pets.
  | { status: 'unreadable' }
  | {
      status: 'ok';
      // Pets at home (not passed away, not in Pet Pawadise).
      living: number;
      healthy: number;
      // Healthy pets that are hungry, dirty or unhappy (a need below the recovery level, the same line the pet bar uses): they
      // are not sick yet, but would be soon if nobody looks after them. Counted inside `healthy`.
      lowNeeds: number;
      sick: number;
      critical: number;
      // Pets that have passed away and can still be brought back.
      deceased: number;
      // critical > sick > deceased > needs-care > healthy. 'none' = no pets at home and none passed away.
      worst: CareSeverity;
      // True when a pet is sick or critical, has passed away, or has a need below the recovery level: the picker shows a mark.
      needsAttention: boolean;
      // The moment the summary was worked out for (the pets were advanced to this instant on a copy).
      asOf: string;
    };

// Reads ONE saved record and advances a copy to `now` with the same pure rules the app uses when the profile is opened
// (so the badge never says "healthy" for a pet that has already fallen sick or died while nobody was looking). Never writes.
export async function peekProfileCare(profileId: string, now: Date = new Date()): Promise<CareSummary> {
  await ensureProfilesReady();
  if (!getProfilesStatus().profiles.some((p) => p.id === profileId)) return { status: 'unreadable' };
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(scopedKeyFor(profileId, FAMILY_KEY_NAME));
  } catch {
    return { status: 'unreadable' };
  }
  if (raw === null) return { status: 'not-started' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'unreadable' };
  }
  const family = parseSavedFamily(parsed);
  if (!family) return { status: 'unreadable' };

  let living = 0;
  let healthy = 0;
  let lowNeeds = 0;
  let sick = 0;
  let critical = 0;
  let deceased = 0;
  for (const saved of family.pets) {
    if (saved.retired) continue; // in Pet Pawadise: frozen, never sick
    const pet = advancePet(saved, now, false, safetyRulesForProfile(profileId));
    switch (pet.lifecycle.state) {
      case 'deceased':
        deceased += 1;
        break;
      case 'critical':
        living += 1;
        critical += 1;
        break;
      case 'sick':
        living += 1;
        sick += 1;
        break;
      default:
        living += 1;
        healthy += 1;
        if (
          !isEggStage(pet.growthUnits) &&
          (pet.profile.hunger < RECOVERY_NEED_THRESHOLD ||
            pet.profile.cleanliness < RECOVERY_NEED_THRESHOLD ||
            pet.profile.happiness < RECOVERY_NEED_THRESHOLD)
        ) {
          lowNeeds += 1;
        }
    }
  }
  const worst: CareSeverity =
    critical > 0 ? 'critical' : sick > 0 ? 'sick' : deceased > 0 ? 'deceased' : lowNeeds > 0 ? 'needs-care' : healthy > 0 ? 'healthy' : 'none';
  return {
    status: 'ok',
    living,
    healthy,
    lowNeeds,
    sick,
    critical,
    deceased,
    worst,
    needsAttention: sick + critical + deceased + lowNeeds > 0,
    asOf: now.toISOString(),
  };
}
