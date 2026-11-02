import type { listsEn } from './lists.en';

// Spanish lists (same keys as lists.en.ts).
export const listsEs: Record<keyof typeof listsEn, string[]> = {
  moodHappy: ['¡Hoy es un gran día! 🌟', '¡Me siento patástico! 🐾', '¡Lo estamos haciendo increíble! ✨', '¡Estoy muy feliz hoy! 💕'],
  moodCalm: ['Todo tranquilo y en paz. 🌿', 'Vamos con calma hoy. 🕊️', 'Todo se siente acogedor. ☁️', 'Un paso tranquilo a la vez. 🌙'],
  moodFocused: ['¡Podemos con esto! 💪', '¡Es hora de hacer cosas! ✅', '¡Estoy a tope! 🎯', '¡Vamos con la siguiente tarea! 📋'],
  moodStressed: [
    'Una tarea a la vez. 🌸',
    'No tenemos que hacerlo todo de una vez. 💛',
    'Un descansito podría ayudar. 🍵',
    'Juntos podemos con esto. 🤝',
  ],
  moodTired: [
    'Quizás necesitemos descansar un poco. 😴',
    'Me vendría bien una siesta de gato... 💤',
    'Vamos con calma. 🌙',
    '¡Descansar también es productivo! 🛌',
  ],
  moodSick: [
    'Hoy vamos con calma. 🩹',
    'Es hora de descansar un poco más. 💊',
    'Cuídate mucho hoy. 💗',
    'Las tareas pueden esperar. ¡Primero la salud! 🏥',
  ],
  completion: ['¡Yupi!', '¡Yei!', '¡Hurra!', '¡Sabía que podías!'],
  months: [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ],
  monthsShort: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  farewell: [
    '¡Gracias por cuidarme tan bien!',
    '¡Voy a hacer muchísimos amigos nuevos!',
    '¡No te preocupes! ¡Te enviaré postales!',
    '¡Voy a extrañar nuestras aventuras juntos!',
    '¡Esto no es un adiós para siempre! ¡Nos vemos pronto!',
    '¡No puedo esperar a contarte todo sobre Pawadise!',
    '¡Te escribiré pronto!',
  ],
  weekdaysNarrow: ['D', 'L', 'M', 'M', 'J', 'V', 'S'],
};
