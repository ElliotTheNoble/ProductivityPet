// Spanish strings for the parent's notification clean-up notice. Same keys as notification-cleanup.en.ts (TypeScript checks this). A
// native Spanish speaker should review them before release.
import type { notificationCleanupEn } from './notification-cleanup.en';

type Table = { [K in keyof typeof notificationCleanupEn]: string };

export const notificationCleanupEs: Table = {
  ncNoticeTitle: 'Puede que queden recordatorios en este dispositivo',
  ncNoticeBody:
    'ProductivityPet no pudo confirmar que se borraron los recordatorios de un perfil anterior. Lo sigue intentando cada vez que se muestra la lista de perfiles. Hasta que lo confirme, podría aparecer un recordatorio de un perfil anterior. Cerrar y volver a abrir la app puede ayudar.',
};
