import { tr, trList, type ListKey, type StringKey } from '@/i18n';

export type Mood = 'Happy' | 'Calm' | 'Focused' | 'Stressed' | 'Tired' | 'Sick';

export const MOODS: Mood[] = ['Happy', 'Calm', 'Focused', 'Stressed', 'Tired', 'Sick'];

// Several cute messages per mood (see lists.en.ts / lists.es.ts). One is picked at random whenever the mood
// changes, and occasionally re-rolled while idle (see src/app/index.tsx) — never the same message twice in a
// row when the pool allows it. The pick is kept as an INDEX, so the displayed text follows the language the
// moment it changes.
const MOOD_LIST_KEYS: Record<Mood, ListKey> = {
  Happy: 'moodHappy',
  Calm: 'moodCalm',
  Focused: 'moodFocused',
  Stressed: 'moodStressed',
  Tired: 'moodTired',
  Sick: 'moodSick',
};

const MOOD_NAME_KEYS: Record<Mood, StringKey> = {
  Happy: 'moodHappy',
  Calm: 'moodCalm',
  Focused: 'moodFocused',
  Stressed: 'moodStressed',
  Tired: 'moodTired',
  Sick: 'moodSick',
};

// The mood's name in the current language ("Happy" / "Feliz"). The stored mood value itself is always the
// English key.
export function moodName(mood: Mood): string {
  return tr(MOOD_NAME_KEYS[mood]);
}

export function getMoodMessage(mood: Mood, index: number): string {
  const pool = trList(MOOD_LIST_KEYS[mood]);
  return pool[((index % pool.length) + pool.length) % pool.length];
}

export function getRandomMoodMessageIndex(mood: Mood, excludeIndex?: number): number {
  const size = trList(MOOD_LIST_KEYS[mood]).length;
  const choices = Array.from({ length: size }, (_, i) => i).filter((i) => !(excludeIndex !== undefined && size > 1 && i === excludeIndex));
  return choices[Math.floor(Math.random() * choices.length)];
}
