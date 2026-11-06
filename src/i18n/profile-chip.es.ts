// Spanish strings for the profile switch chip in the app header and its dialogs. Same keys as profile-chip.en.ts (TypeScript
// checks this). A native Spanish speaker should review them before release.
import type { profileChipEn } from './profile-chip.en';

type Table = { [K in keyof typeof profileChipEn]: string };

export const profileChipEs: Table = {
  pcSwitch: 'Cambiar',
  pcLabel: 'Cambiar de jugador. Jugando como {name}.',
  pcHint: 'Vuelve a la lista de jugadores. Antes se guardan tus mascotas y tu progreso.',

  pcConfirmTitle: '¿Cambiar de jugador?',
  pcConfirmIntro: 'Esto todavía no está guardado y se perderá si cambias ahora:',
  pcConfirmSaved: 'Todo lo demás ya está guardado.',
  pcConfirmSwitch: 'Cambiar de jugador',
  pcCancel: 'Cancelar',
  pcKindKitty: 'Tu ronda de Kitty Catch',
  pcKindMemory: 'Tu ronda de Memory Match',
  pcKindBathing: 'El baño que empezaste',
  pcKindTaskDraft: 'La tarea que estás escribiendo',
  pcKindTaskEdit: 'Los cambios de la tarea que estás editando',
  pcKindJournal: 'La reflexión que estás escribiendo',

  pcFailTitle: 'No se pudo cambiar de jugador',
  pcFailSave: 'Algunos cambios todavía no se pudieron guardar, así que sigues en el perfil de {name}. No se perdió nada. Inténtalo de nuevo en un momento.',
  pcFailSlow: 'Guardar está tardando más de lo normal, así que sigues en el perfil de {name}. No se perdió nada. Inténtalo de nuevo en un momento.',
  pcFailBusy: 'Todavía se está guardando algo, así que sigues en el perfil de {name}. No se perdió nada. Inténtalo de nuevo en un momento.',
  pcFailOther: 'Algo salió mal, así que sigues en el perfil de {name}. No se perdió nada. Inténtalo de nuevo en un momento.',
  pcTryAgain: 'Intentar de nuevo',
  pcKeepPlaying: 'Seguir jugando',
};
