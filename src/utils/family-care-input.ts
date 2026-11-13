import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSelectableChildren } from '@/utils/family-profiles';
import { safetyRulesForProfile } from '@/utils/pet-safety';
import { alertsEnabledFromSaved, careEventsFromPets, type ProfileCareInput } from '@/utils/family-care-plan';
import { FAMILY_KEY_NAME, parseSavedFamily } from '@/utils/pet-family';
import { MAIN_PROFILE_ID, ensureProfilesReady, getProfilesStatus, scopedKeyFor } from '@/utils/profiles';

// The READ-ONLY input side of the family-care notification plan (Stage 4.5d). For a profile it reads two saved records, the pets and the
// pet-alert setting, with `getItem` only, and works out the profile's upcoming care events on a copy. It never writes, never loads a
// profile into the app's stores, never changes the active profile and never touches a notification. Nothing uses it yet.
//
// Who is read: the Main profile and the children the family picker would offer (not archived, valid, registered). An archived child is
// never even READ; its pets keep aging on their own saved timestamps, and nothing about them is changed here.

// The same key name the detailed alerts use for the setting (a test keeps the two in step); a profile's key is built the usual way.
export const ALERT_SETTINGS_KEY_NAME = 'petAlertSettings';

export async function readProfileCareInput(profileId: string, kind: 'main' | 'child', now: Date = new Date()): Promise<ProfileCareInput> {
  const base = { profileId, kind, archived: false };
  await ensureProfilesReady();
  if (!getProfilesStatus().profiles.some((profile) => profile.id === profileId)) {
    return { ...base, alertsEnabled: false, readable: false, events: [] };
  }

  let settingsRaw: string | null = null;
  try {
    settingsRaw = await AsyncStorage.getItem(scopedKeyFor(profileId, ALERT_SETTINGS_KEY_NAME));
  } catch {
    // The setting cannot be read: it counts as off (nothing is scheduled for a profile whose choice is unknown).
  }
  const alertsEnabled = alertsEnabledFromSaved(settingsRaw);
  // No point reading pets nobody asked alerts for.
  if (!alertsEnabled) return { ...base, alertsEnabled: false, readable: true, events: [] };

  let familyRaw: string | null;
  try {
    familyRaw = await AsyncStorage.getItem(scopedKeyFor(profileId, FAMILY_KEY_NAME));
  } catch {
    return { ...base, alertsEnabled, readable: false, events: [] };
  }
  if (familyRaw === null) return { ...base, alertsEnabled, readable: true, events: [] }; // never opened: no pets yet
  let parsed: unknown;
  try {
    parsed = JSON.parse(familyRaw);
  } catch {
    return { ...base, alertsEnabled, readable: false, events: [] };
  }
  const family = parseSavedFamily(parsed);
  if (!family) return { ...base, alertsEnabled, readable: false, events: [] };
  return { ...base, alertsEnabled, readable: true, events: careEventsFromPets(family.pets, now, safetyRulesForProfile(profileId)) };
}

// Main plus every selectable child, read in parallel. A child that cannot be read is reported as unreadable, never as healthy.
export async function readFamilyCareInputs(now: Date = new Date()): Promise<ProfileCareInput[]> {
  await ensureProfilesReady();
  const children = await getSelectableChildren();
  return Promise.all([
    readProfileCareInput(MAIN_PROFILE_ID, 'main', now),
    ...children.map((child) => readProfileCareInput(child.id, 'child', now)),
  ]);
}
