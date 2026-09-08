export type TaskCategory = 'Study' | 'Exercise' | 'Clean' | 'Health' | 'Personal';

// Keyword lists are checked in this order (Study, then Exercise, then Clean,
// then Health); a task that doesn't match any of them falls back to "Personal".
const STUDY_KEYWORDS = [
  'homework',
  'study',
  'studying',
  'assignment',
  'read',
  'reading',
  'school',
  'class',
  'exam',
  'test',
  'quiz',
  'project',
  'essay',
  'research',
  'paper',
  'notes',
  'lecture',
  'chapter',
  'presentation',
  'study guide',
  'lab',
];

const EXERCISE_KEYWORDS = [
  'walk',
  'walking',
  'run',
  'running',
  'workout',
  'exercise',
  'gym',
  'weights',
  'lift',
  'lifting',
  'cardio',
  'yoga',
  'pilates',
  'hike',
  'hiking',
  'bike',
  'biking',
  'cycling',
  'swim',
  'swimming',
  'sport',
  'training',
  'stretch',
  'fitness',
];

const CLEAN_KEYWORDS = [
  'clean',
  'cleaning',
  'laundry',
  'dishes',
  'vacuum',
  'vacuuming',
  'mop',
  'mopping',
  'sweep',
  'sweeping',
  'tidy',
  'organize',
  'organizing',
  'declutter',
  'trash',
  'recycle',
  'dust',
  'wipe',
  'kitchen',
  'bathroom',
  'bedroom',
  'wash',
  'fold',
  'put away',
];

// Deliberately no bare "app" entry — it should only count as part of a
// specific health phrase (e.g. "doctor app", "chiro app"), never on its own,
// so tasks like "work on my app" don't get miscategorized as Health.
const HEALTH_KEYWORDS = [
  'water',
  'drink water',
  'hydrate',
  'hydration',
  'medicine',
  'medication',
  'vitamin',
  'vitamins',
  'sleep',
  'bedtime',
  'nap',
  'doctor',
  "doctor's appointment",
  'doctors appointment',
  'doctor appointment',
  'doctor app',
  'doctors app',
  'doc appointment',
  'doc app',
  'dentist',
  'dentist appointment',
  'dentist app',
  'dental appointment',
  'chiropractor',
  'chiropractor appointment',
  'chiropractor app',
  'chiro',
  'chiro appointment',
  'chiro app',
  'therapy',
  'therapy appointment',
  'physical therapy',
  'PT appointment',
  'checkup',
  'check-up',
  'annual checkup',
  'physical',
  'meditate',
  'meditation',
  'breathing',
  'self-care',
  'skincare',
  'brush teeth',
  'floss',
  'healthy meal',
  'meal prep',
  'nutrition',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(text));
}

export function categorizeTask(text: string): TaskCategory {
  if (matchesAnyKeyword(text, STUDY_KEYWORDS)) return 'Study';
  if (matchesAnyKeyword(text, EXERCISE_KEYWORDS)) return 'Exercise';
  if (matchesAnyKeyword(text, CLEAN_KEYWORDS)) return 'Clean';
  if (matchesAnyKeyword(text, HEALTH_KEYWORDS)) return 'Health';
  return 'Personal';
}
