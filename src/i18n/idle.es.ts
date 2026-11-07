// Spanish strings for the "Still playing?" warning. Same keys as idle.en.ts (TypeScript checks this). A native Spanish speaker should
// review them before release.
import type { idleEn } from './idle.en';

type Table = { [K in keyof typeof idleEn]: string };

export const idleEs: Table = {
  idleTitle: '¿Sigues jugando?',
  idleBody: 'Lleva un rato sin pasar nada. Para cuidar las mascotas de todos, la aplicación vuelve a la lista de jugadores en aproximadamente un minuto si no sigues jugando.',
  idleUnfinishedIntro: 'Esto todavía no está guardado y se perderá si eso ocurre:',
  idleSaved: 'Todo lo demás ya está guardado.',
  idleContinue: 'Seguir jugando',
};
