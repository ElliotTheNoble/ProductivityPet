import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { peekProfileCare, type CareSummary } from '@/utils/family-profiles';
import {
  addChild,
  ensureHouseholdLoaded,
  getHouseholdIntegrity,
  isChildArchived,
  renameChild,
  setChildArchived,
  useHousehold,
  type ActionFailure,
  type ChildProfile,
  type Household,
} from '@/utils/household';
import { checkParentAction } from '@/utils/parent-session';
import {
  MAIN_PROFILE_ID,
  ensureProfilesReady,
  getActiveProfileId,
  getProfilesStatus,
  isProfileReleased,
  registerChildProfile,
  reloadProfileRegistry,
} from '@/utils/profiles';

// The management layer behind the Parent Dashboard's family section: add, rename, archive and restore a child, and a read-only report on
// the health of the family records. Every change goes through the household functions (@/utils/household.ts), which check for a
// verified parent session right before they write, so nothing here can save without one, and nothing here reports success before the
// save has really succeeded (the household writes and reads back first).
//
// Nothing here ever deletes, merges, re-links or repairs anything. Archiving only hides a child from the family picker: their profile and
// every saved record stay exactly as they are (and their pets keep aging by the clock, as they do for any unused profile).

export type ManageFailure = ActionFailure | 'active-profile';
export type ManageResult =
  | { ok: true; id?: string }
  // `storageMayBeFull` is set only after two storage failures in a row while adding a child: a hint, never a claim.
  | { ok: false; reason: ManageFailure; storageMayBeFull?: boolean };

// ---------------------------------------------------------------------------------------------------------
// nicknames

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

// Another child (active or archived) who already has this nickname, ignoring case and extra spaces. Two children MAY share a nickname
// (the permanent id is what tells them apart); this only feeds a friendly warning.
export function findSameNickname(h: Household, nickname: string, exceptId?: string): ChildProfile | null {
  const wanted = normalizeName(nickname);
  if (!wanted) return null;
  return h.children.find((c) => c.id !== exceptId && normalizeName(c.nickname) === wanted) ?? null;
}

// ---------------------------------------------------------------------------------------------------------
// the actions

let creationStorageFailures = 0;

// Adds a child. After TWO storage failures in a row the result says the device storage may be full; the first failure, and any other
// reason (a locked session, a conflict, safe mode...), makes no such hint. A success or any other outcome starts the count again.
export async function createChild(nickname: string): Promise<ManageResult> {
  const result = await addChild(nickname);
  if (result.ok) {
    creationStorageFailures = 0;
    return result;
  }
  if (result.reason === 'storage') {
    creationStorageFailures += 1;
    return { ok: false, reason: 'storage', storageMayBeFull: creationStorageFailures >= 2 };
  }
  creationStorageFailures = 0;
  return result;
}

export function resetCreationFailures(): void {
  creationStorageFailures = 0;
}

export async function renameChildSafe(childId: string, nickname: string): Promise<ManageResult> {
  return renameChild(childId, nickname);
}

// A child cannot be archived while their profile is the one in use (the parent is inside it, for example): they would be playing in a
// profile that has disappeared from the picker. The parent opens Main from the picker first.
export async function archiveChild(childId: string): Promise<ManageResult> {
  if (childId !== MAIN_PROFILE_ID && getActiveProfileId() === childId && !isProfileReleased()) return { ok: false, reason: 'active-profile' };
  return setChildArchived(childId, true);
}

// Restores an archived child with their original permanent id and every saved record exactly as it was. In family mode the (empty)
// registry record is made sure of first (it adds nothing but that record); if that fails the child stays archived.
export async function restoreChild(childId: string): Promise<ManageResult> {
  // Asked FIRST: a locked or expired session must not even cause the registry record to be written.
  const allowed = await checkParentAction('children');
  if (!allowed.ok) return { ok: false, reason: allowed.reason };
  if (FAMILY_MODE_ENABLED) {
    const registered = await registerChildProfile(childId);
    if (!registered.ok) {
      return { ok: false, reason: registered.reason === 'unavailable' ? 'unavailable' : registered.reason === 'conflict' ? 'conflict' : registered.reason === 'invalid-id' ? 'blocked' : 'storage' };
    }
  }
  return setChildArchived(childId, false);
}

// What the archive confirmation shows: the pets' status right now (read-only, nothing is loaded or changed).
export async function getArchiveSummary(childId: string): Promise<CareSummary> {
  return peekProfileCare(childId);
}

// ---------------------------------------------------------------------------------------------------------
// family health (read-only)

export type NeedsCare = { id: string; nickname: string; archived: boolean; summary: Extract<CareSummary, { status: 'ok' }> };

export type FamilyHealth = {
  // False with family mode off: there are no child profiles to look after, so nothing is reported.
  enabled: boolean;
  // Profile storage is in safe mode (backup could not be made): the picker and the care checks are paused.
  storagePaused: boolean;
  // The family list could not be read at all, or has entries that could not be understood (a copy was kept).
  householdUnreadable: boolean;
  unreadableEntries: number;
  // Ids used by more than one record: the list is read-only meanwhile.
  duplicateChildIds: string[];
  // Children whose id can never be a profile id.
  invalidIds: string[];
  // Children whose profile record is missing (they are linked again at the next start; they are not offered until then).
  unlinkedChildren: string[];
  // Registry profiles with no child record: empty ones (no saved data) and ones that hold saved data. Reported only; never touched.
  orphansEmpty: string[];
  orphansWithData: { id: string; keys: number }[];
  // Children (active or archived) whose pets need care now, and children whose saved pets cannot be read.
  needsCare: NeedsCare[];
  unreadablePets: { id: string; nickname: string; archived: boolean }[];
};

// A fresh report every time (new arrays: a report is never allowed to share, and so keep, findings from an earlier look).
function emptyHealth(): FamilyHealth {
  return {
    enabled: false,
    storagePaused: false,
    householdUnreadable: false,
    unreadableEntries: 0,
    duplicateChildIds: [],
    invalidIds: [],
    unlinkedChildren: [],
    orphansEmpty: [],
    orphansWithData: [],
    needsCare: [],
    unreadablePets: [],
  };
}

// What family mode off reports: nothing (never mutated).
export const EMPTY_HEALTH: FamilyHealth = Object.freeze(emptyHealth()) as FamilyHealth;

export function healthHasWarnings(h: FamilyHealth): boolean {
  return (
    h.enabled &&
    (h.storagePaused ||
      h.householdUnreadable ||
      h.unreadableEntries > 0 ||
      h.duplicateChildIds.length > 0 ||
      h.invalidIds.length > 0 ||
      h.unlinkedChildren.length > 0 ||
      h.orphansEmpty.length > 0 ||
      h.orphansWithData.length > 0 ||
      h.needsCare.length > 0 ||
      h.unreadablePets.length > 0)
  );
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SCOPED_PREFIX = '@ProductivityPet:p:';

// Looks at the family records and reports what needs a parent's attention. It only READS (the registry is re-read, the household is read,
// each child's saved pets are read once); it writes nothing, loads nothing into the game stores and repairs nothing.
export async function inspectFamilyHealth(): Promise<FamilyHealth> {
  if (!FAMILY_MODE_ENABLED) return EMPTY_HEALTH;
  const health: FamilyHealth = { ...emptyHealth(), enabled: true };
  try {
    await ensureProfilesReady();
    const household = await ensureHouseholdLoaded();
    const integrity = getHouseholdIntegrity();
    health.householdUnreadable = integrity.loadFailed;
    health.unreadableEntries = integrity.unreadableEntries;
    health.duplicateChildIds = [...integrity.duplicateChildIds];
    if (getProfilesStatus().state !== 'ready') {
      health.storagePaused = true;
      return health; // without the registry nothing can be told apart
    }
    await reloadProfileRegistry();
    if (integrity.loadFailed) return health; // without the household a profile cannot be told from a leftover
    const profiles = getProfilesStatus().profiles.filter((p) => p.kind === 'child');
    const known = new Set(profiles.map((p) => p.id));
    const householdIds = new Set(household.children.map((c) => c.id));
    for (const id of integrity.duplicateChildIds) householdIds.add(id);

    for (const child of household.children) {
      if (integrity.duplicateChildIds.includes(child.id)) continue;
      if (!ID_PATTERN.test(child.id) || child.id === MAIN_PROFILE_ID) {
        health.invalidIds.push(child.id);
        continue;
      }
      if (!known.has(child.id)) health.unlinkedChildren.push(child.id);
      const summary = await peekProfileCare(child.id);
      const archived = isChildArchived(child);
      if (summary.status === 'ok' && summary.needsAttention) health.needsCare.push({ id: child.id, nickname: child.nickname, archived, summary });
      else if (summary.status === 'unreadable' && known.has(child.id)) health.unreadablePets.push({ id: child.id, nickname: child.nickname, archived });
    }

    const keys = await AsyncStorage.getAllKeys();
    for (const profile of profiles) {
      if (householdIds.has(profile.id)) continue;
      const prefix = `${SCOPED_PREFIX}${profile.id}:`;
      const count = keys.filter((k) => k.startsWith(prefix)).length;
      if (count > 0) health.orphansWithData.push({ id: profile.id, keys: count });
      else health.orphansEmpty.push(profile.id);
    }
  } catch {
    health.householdUnreadable = true; // unknown is never reported as "all fine"
  }
  return health;
}

// The family health for a screen: read when it opens, again whenever the household changes, and on demand.
export function useFamilyHealth(): { health: FamilyHealth; refresh: () => void; checked: boolean } {
  const household = useHousehold();
  const [health, setHealth] = useState<FamilyHealth>(EMPTY_HEALTH);
  const [checked, setChecked] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void inspectFamilyHealth().then((next) => {
      if (cancelled) return;
      setHealth(next);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [household, tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { health, refresh, checked };
}
