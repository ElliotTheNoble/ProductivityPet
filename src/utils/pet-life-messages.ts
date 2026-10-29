import type { PetProfile } from '@/utils/pet-profile-model';

// Gentle, non-graphic wording for a pet's health, shared by Home's speech
// bubble and the pet family bar so they always agree.

export const MEMORIAL_MESSAGE =
  "Your pet's journey has come to an end. Their memories will always be in your Pet Album.";

export const RESURRECTION_HAPPY_MESSAGE = "I'm back! Thank you for bringing me home. I missed you! 💗";

// What the sick/critical pet needs, in plain words, from its current needs.
export function describeNeededCare(profile: Pick<PetProfile, 'hunger' | 'cleanliness' | 'happiness'>): string {
  const asks: string[] = [];
  if (profile.hunger < 50) asks.push('Feed her');
  if (profile.cleanliness < 50) asks.push('give her a gentle wipe-down in the Bathroom');
  if (profile.happiness < 50) asks.push('play with her');
  if (asks.length === 0) return 'Keep caring for her a little longer.';
  const last = asks.pop() as string;
  const joined = asks.length > 0 ? `${asks.join(', ')} and ${last}` : last;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)} until Hunger, Cleanliness and Happiness are all at 50 or more.`;
}

// The speech-bubble line for a sick, critical or deceased pet, or null for a
// healthy one (Home then keeps its usual mood message).
export function getPetLifeMessage(profile: PetProfile | null): string | null {
  if (!profile || !profile.lifeState || profile.lifeState === 'healthy') return null;
  if (profile.lifeState === 'deceased') return MEMORIAL_MESSAGE;

  if (profile.lifeState === 'critical') {
    if (profile.hunger <= 0) return "I'm so weak... I really need something to eat. Please help! 💔";
    if (profile.cleanliness <= 0) return "I feel awful... I really need a gentle wipe-down in the Bathroom. Please help! 💔";
    if (profile.happiness <= 0) return "I'm so sad and lonely... please play with me. 💔";
    return "I'm still not well... please keep taking care of me. 💔";
  }

  if (profile.hunger <= 0) return 'My tummy is so empty... could you feed me? 🍽️';
  if (profile.cleanliness <= 0) return "I don't feel clean at all... could I have a gentle wipe-down in the Bathroom? 🧽";
  if (profile.happiness <= 0) return 'I feel so lonely... could we play together? 🧸';
  return "I'm not feeling very well... could you take care of me? 🤒";
}
