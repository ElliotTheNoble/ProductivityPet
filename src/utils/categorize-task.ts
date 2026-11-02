import { tr } from '@/i18n';
export type TaskCategory = 'Study' | 'Exercise' | 'Clean' | 'Health' | 'Personal';

const KNOWN_CATEGORIES: readonly string[] = ['Study', 'Exercise', 'Clean', 'Health', 'Personal'];

export function isTaskCategory(value: unknown): value is TaskCategory {
  return typeof value === 'string' && KNOWN_CATEGORIES.includes(value);
}

// The category to SHOW (icon, label, stats) for a saved value. A saved task can carry a category this version does
// not know (an older or damaged save): it is displayed as "Personal", the app's own fallback. This is display only
// - the task itself, including its saved category, is never changed.
export function displayCategory(value: unknown): TaskCategory {
  return isTaskCategory(value) ? value : 'Personal';
}

// The category's name in the current language (the stored value is always the English key).
export function categoryLabel(category: string): string {
  return tr(`cat${displayCategory(category)}` as 'catStudy' | 'catExercise' | 'catClean' | 'catHealth' | 'catPersonal');
}

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


// Spanish keywords (compared without accents and in lower case, so "Música", "musica" and "MÚSICA" are alike).
// They are checked IN ADDITION to the English lists above, in the same category order, so English titles are
// categorised exactly as before and a title in either language (or both) works. Only the category that is
// assigned when a task is created or its text is edited is affected; saved tasks keep the category they have.
const STUDY_KEYWORDS_ES = [
  'tarea escolar', 'tareas escolares', 'deberes', 'estudiar', 'estudio', 'estudiando', 'repasar', 'leer', 'lectura', 'leyendo',
  'escuela', 'colegio', 'clase', 'clases', 'examen', 'prueba', 'quiz', 'proyecto', 'ensayo', 'investigacion', 'investigar',
  'apuntes', 'conferencia', 'capitulo', 'presentacion', 'guia de estudio', 'laboratorio', 'trabajo escolar',
];

const EXERCISE_KEYWORDS_ES = [
  'caminar', 'caminata', 'pasear', 'paseo', 'correr', 'corriendo', 'trotar', 'ejercicio', 'ejercicios', 'entrenar', 'entrenamiento',
  'gimnasio', 'gym', 'pesas', 'levantar pesas', 'cardio', 'yoga', 'pilates', 'senderismo', 'bicicleta', 'ciclismo', 'andar en bici',
  'nadar', 'natacion', 'deporte', 'deportes', 'estirar', 'estiramientos', 'estiramiento', 'fitness', 'rutina de ejercicio',
];

const CLEAN_KEYWORDS_ES = [
  'limpiar', 'limpieza', 'limpiando', 'lavar la ropa', 'lavar ropa', 'ropa sucia', 'lavanderia', 'lavar los platos', 'lavar platos',
  'platos', 'trastes', 'aspirar', 'aspiradora', 'trapear', 'barrer', 'ordenar', 'organizar', 'recoger', 'tender la cama', 'hacer la cama',
  'basura', 'reciclar', 'reciclaje', 'desempolvar', 'sacudir', 'quitar el polvo', 'cocina', 'bano', 'banos', 'habitacion', 'dormitorio',
  'lavar', 'doblar', 'guardar la ropa', 'desorden',
];

const HEALTH_KEYWORDS_ES = [
  'agua', 'tomar agua', 'beber agua', 'hidratarse', 'hidratacion', 'medicina', 'medicinas', 'medicamento', 'medicamentos', 'pastilla',
  'vitamina', 'vitaminas', 'dormir', 'sueno', 'siesta', 'hora de dormir', 'doctor', 'doctora', 'medico', 'medica', 'cita medica',
  'cita con el doctor', 'dentista', 'cita con el dentista', 'quiropractico', 'terapia', 'fisioterapia', 'chequeo', 'revision medica',
  'meditar', 'meditacion', 'respirar', 'respiracion', 'cuidado personal', 'cuidado de la piel', 'cepillar los dientes', 'cepillarme los dientes',
  'lavarme los dientes', 'hilo dental', 'comida saludable', 'preparar comidas', 'nutricion',
];

// Lower case, no accents (ñ becomes n), so keywords match however the player typed the accents.
function normalizeSpanish(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Whole-word match on the normalised text (JavaScript's  does not treat accented letters as letters).
function matchesAnyKeywordEs(text: string, keywords: string[]): boolean {
  const normalized = normalizeSpanish(text);
  return keywords.some((keyword) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}($|[^a-z0-9])`).test(normalized));
}

export function categorizeTask(text: string): TaskCategory {
  if (matchesAnyKeyword(text, STUDY_KEYWORDS) || matchesAnyKeywordEs(text, STUDY_KEYWORDS_ES)) return 'Study';
  if (matchesAnyKeyword(text, EXERCISE_KEYWORDS) || matchesAnyKeywordEs(text, EXERCISE_KEYWORDS_ES)) return 'Exercise';
  if (matchesAnyKeyword(text, CLEAN_KEYWORDS) || matchesAnyKeywordEs(text, CLEAN_KEYWORDS_ES)) return 'Clean';
  if (matchesAnyKeyword(text, HEALTH_KEYWORDS) || matchesAnyKeywordEs(text, HEALTH_KEYWORDS_ES)) return 'Health';
  return 'Personal';
}
