import { tr } from '@/i18n';
import type { PetProfile } from '@/utils/pet-profile-model';

// Gentle, non-graphic wording for a pet's health, shared by Home's speech
// bubble and the pet family bar so they always agree.

// The wording lives in the translation catalog (home.en.ts / home.es.ts) and is read at call time, so it
// follows the current language. MEMORIAL_MESSAGE / RESURRECTION_HAPPY_MESSAGE are functions for that reason.
export function getMemorialMessage(): string {
  return tr('memorialMessage');
}

export function getResurrectionHappyMessage(): string {
  return tr('resurrectionHappy');
}

// What the sick/critical pet needs, in plain words, from its current needs.
export function describeNeededCare(profile: Pick<PetProfile, 'hunger' | 'cleanliness' | 'happiness'>): string {
  const asks: string[] = [];
  if (profile.hunger < 50) asks.push(tr('askFeed'));
  if (profile.cleanliness < 50) asks.push(tr('askWipe'));
  if (profile.happiness < 50) asks.push(tr('askPlay'));
  if (asks.length === 0) return tr('askNone');
  const last = asks.pop() as string;
  const joined =
    asks.length === 0 ? last : tr('askJoinMore', { rest: asks.join(', '), last });
  return tr('askUntil', { asks: `${joined.charAt(0).toUpperCase()}${joined.slice(1)}` });
}

// The speech-bubble line for a sick, critical or deceased pet, or null for a
// healthy one (Home then keeps its usual mood message).
export function getPetLifeMessage(profile: PetProfile | null): string | null {
  if (!profile || !profile.lifeState || profile.lifeState === 'healthy') return null;
  if (profile.lifeState === 'deceased') return getMemorialMessage();

  if (profile.lifeState === 'critical') {
    if (profile.hunger <= 0) return tr('lifeCriticalHunger');
    if (profile.cleanliness <= 0) return tr('lifeCriticalClean');
    if (profile.happiness <= 0) return tr('lifeCriticalHappy');
    return tr('lifeCriticalOther');
  }

  if (profile.hunger <= 0) return tr('lifeSickHunger');
  if (profile.cleanliness <= 0) return tr('lifeSickClean');
  if (profile.happiness <= 0) return tr('lifeSickHappy');
  return tr('lifeSickOther');
}
