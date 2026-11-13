import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { MAIN_PROFILE_ID, getActiveProfileId, isProfileReleased } from '@/utils/profiles';

// Pet Safety: which survival rules a pet lives by.
//
//  Classic: the original rules (sick, then critical, then the pet passes away, and the paid resurrection exists). This is what every user has
//           today, what Main has, and what family mode OFF always means.
//  Gentle:  the pet can still get hungry, tired, dirty and sick, and its needs fall exactly as before, but it can never pass away. It stays in
//           the low-needs state (sick, then critical) until it is cared for. Nothing is refilled, nothing is reset, no growth rule changes.
//
// The mode is a parent's setting per child (see ChildSettings.petSafety in @/utils/household.ts). Each child's pets are already their own: a
// profile's pets, needs, growth and wallet live in that profile's own record (@/utils/pet-family.ts), so the mode only has to be asked WHEN a
// pet is evaluated. It never writes to a pet.
//
//  - `classicSince` is when the parent last switched the child to Classic. A pet that has been sick for days while Gentle must not die the moment
//    the parent switches to Classic, so under Classic it cannot pass away until CRITICAL_TO_DEATH_HOURS after that switch.
//  - Anything unknown fails SAFE: a child whose setting cannot be read (the household is still loading or unreadable, the child is missing)
//    is treated as Gentle for that moment, so a failed read can never kill a pet.
export type SafetyRules = { gentle: boolean; classicSince: number | null };

export const CLASSIC_RULES: SafetyRules = { gentle: false, classicSince: null };
const UNKNOWN_RULES: SafetyRules = { gentle: true, classicSince: null };

type SettingsLike = { petSafety?: string; petSafetyChangedAt?: string };

export function rulesForSettings(settings: SettingsLike): SafetyRules {
  if (settings.petSafety === 'classic') {
    const since = settings.petSafetyChangedAt ? new Date(settings.petSafetyChangedAt).getTime() : Number.NaN;
    return { gentle: false, classicSince: Number.isFinite(since) ? since : null };
  }
  return { gentle: true, classicSince: null };
}

// The rules for ONE profile's pets (a parent-side reader works on a child's saved pets while another profile is open, so it asks by id).
export function safetyRulesForProfile(profileId: string): SafetyRules {
  if (!FAMILY_MODE_ENABLED) return CLASSIC_RULES; // family mode off: nothing changes for anyone
  if (profileId === MAIN_PROFILE_ID) return CLASSIC_RULES; // Main (an adult's own pets) keeps the original rules
  try {
    const household = require('@/utils/household') as typeof import('@/utils/household');
    const current = household.peekHousehold();
    const info = household.getHouseholdIntegrity();
    if (!current || info.loadFailed || info.duplicateChildIds.includes(profileId)) return UNKNOWN_RULES;
    const child = current.children.find((c) => c.id === profileId);
    return child ? rulesForSettings(child.settings) : UNKNOWN_RULES;
  } catch {
    return UNKNOWN_RULES;
  }
}

// The rules for the profile that is open right now (the one whose pets are being played).
export function currentSafetyRules(): SafetyRules {
  if (!FAMILY_MODE_ENABLED) return CLASSIC_RULES;
  if (isProfileReleased()) return CLASSIC_RULES; // nobody is open: nothing is evaluated for anyone
  return safetyRulesForProfile(getActiveProfileId());
}
