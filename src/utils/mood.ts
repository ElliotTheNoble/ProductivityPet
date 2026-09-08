export type Mood = 'Happy' | 'Calm' | 'Focused' | 'Stressed' | 'Tired' | 'Sick';

export const MOODS: Mood[] = ['Happy', 'Calm', 'Focused', 'Stressed', 'Tired', 'Sick'];

// Several cute messages per mood. One is picked at random whenever the mood
// changes, and occasionally re-rolled while idle (see src/app/index.tsx) —
// never the same message twice in a row when the pool allows it.
export const MOOD_MESSAGES: Record<Mood, string[]> = {
  Happy: [
    'Today is a great day! 🌟',
    "I'm feeling pawsome! 🐾",
    "We're doing amazing! ✨",
    "I'm so happy today! 💕",
  ],
  Calm: [
    'Nice and peaceful. 🌿',
    "Let's take our time today. 🕊️",
    'Everything feels cozy. ☁️',
    'One peaceful step at a time. 🌙',
  ],
  Focused: [
    "We've got this! 💪",
    'Time to get things done! ✅',
    "I'm in the zone! 🎯",
    "Let's tackle our next task! 📋",
  ],
  Stressed: [
    'One task at a time. 🌸',
    "We don't have to do everything at once. 💛",
    'A little break might help. 🍵',
    'We can handle this together. 🤝',
  ],
  Tired: [
    'Maybe we need a little rest. 😴',
    'I could use a cat nap... 💤',
    "Let's take it easy. 🌙",
    'Rest is productive too! 🛌',
  ],
  Sick: [
    "Let's take it easy today. 🩹",
    'Time for some extra rest. 💊',
    'Take care of yourself today. 💗',
    'Tasks can wait. Health comes first! 🏥',
  ],
};

export function getRandomMoodMessage(mood: Mood, exclude?: string): string {
  const pool = MOOD_MESSAGES[mood];
  const choices = exclude && pool.length > 1 ? pool.filter((message) => message !== exclude) : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}
