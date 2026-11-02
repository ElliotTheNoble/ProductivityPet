import type { shellEn } from './shell.en';

// Spanish strings for the app shell (same keys as shell.en.ts; TypeScript reports any that are missing).
export const shellEs: Record<keyof typeof shellEn, string> = {
  navHome: 'Inicio',
  navTasks: 'Tareas',
  navRooms: 'Cuartos',
  navShop: 'Tienda',
  navStats: 'Estadísticas',
  navAlerts: 'Cuidado y alertas',
  brandTagline: 'Pequeños pasos. Un tú más feliz.',

  pleaseWait: 'Espera un momento…',
  backToStats: '← Volver a Estadísticas',

  petLabelKitty: 'Gatito {n}',
  stateHealthy: 'sano',
  stateSick: 'enfermo',
  stateCritical: 'grave',
  stateDeceased: 'fallecido',
  petChipLabel: '{name}, {state}',

  adoptEgg: '＋ Adoptar un huevo',
  adoptEggLabel: 'Adoptar un huevo nuevo',
  adoptTitle: '¿Adoptar un huevo nuevo?',
  adoptConfirm: 'Adoptar',
  adoptBody:
    'Un huevo nuevo se unirá a tu familia. Tus otras mascotas, tareas, fichas e historial se quedan exactamente como están. Puedes cuidar hasta {max} mascotas vivas a la vez ({count} ahora).',
  adoptLimit: 'Ya tienes {max} mascotas vivas.',
  adoptBusy: 'La adopción ya está en curso.',
  adoptFail: 'No se pudo guardar el huevo nuevo en este dispositivo. No se cambió nada; inténtalo de nuevo.',

  languagePickerHelp: 'Elige el idioma de la app. Cambia al instante y se recuerda.',
};
