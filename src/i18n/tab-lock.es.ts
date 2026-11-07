// Spanish strings for the single-tab screens and the hand-over question. Same keys as tab-lock.en.ts (TypeScript checks this). A native
// Spanish speaker should review them before release.
import type { tabLockEn } from './tab-lock.en';

type Table = { [K in keyof typeof tabLockEn]: string };

export const tabLockEs: Table = {
  tlChecking: 'Comprobando…',
  tlCheckingBody: 'Comprobando que solo una pestaña use ProductivityPet.',

  tlBlockedTitle: 'ProductivityPet está abierto en otra pestaña',
  tlBlockedBody: 'Para cuidar las mascotas de todos, solo una pestaña puede usar ProductivityPet a la vez. Vuelve a la otra pestaña o ciérrala.',
  tlAsk: 'Pedir a la otra pestaña que ceda el paso',
  tlWaitingTitle: 'Esperando a que se cierre la otra pestaña',
  tlWaitingBody: 'Este navegador no puede preguntar a la otra pestaña. ProductivityPet estará listo aquí en cuanto se cierre la otra pestaña.',

  tlAskingTitle: 'Esperando a la otra pestaña',
  tlAskingBody: 'Ve a la otra pestaña y responde su pregunta. Esta pestaña cambia sola cuando la otra pestaña suelte el control.',

  tlUnansweredTitle: 'La otra pestaña no respondió',
  tlUnansweredBody: 'Puede estar ocupada, en segundo plano o bloqueada. Vuelve a la otra pestaña o ciérrala. Esta pestaña nunca toma el control a la fuerza.',
  tlAskAgain: 'Intentar preguntar de nuevo',

  tlDeclinedTitle: 'La otra pestaña dijo que no',
  tlDeclinedBody: 'Alguien la está usando ahora mismo, así que mantuvo el control. No se cambió nada.',
  tlSaveFailedTitle: 'La otra pestaña no pudo guardar con seguridad',
  tlSaveFailedBody: 'Mantuvo el control, así que no se perdió nada. Inténtalo de nuevo en un momento.',
  tlNotReadyTitle: 'La otra pestaña no está lista',
  tlNotReadyBody: 'Espera un momento y vuelve a preguntar.',

  tlFreeTitle: 'ProductivityPet está libre',
  tlFreeBody: 'La otra pestaña se cerró o soltó el control. Ya puedes usar esta pestaña.',
  tlUseThisTab: 'Usar esta pestaña',

  tlSwitchingTitle: 'Cambiando a esta pestaña…',
  tlSwitchingBody: 'Un momento. ProductivityPet se está abriendo aquí.',

  tlReleasedTitle: 'Esta pestaña cedió ProductivityPet a otra pestaña',
  tlReleasedBody: 'Antes se guardó todo. Puedes seguir usando la otra pestaña.',
  tlLostTitle: 'Esta pestaña perdió el control',
  tlLostBody: 'Otra cosa tomó el control del almacenamiento, así que desde esta pestaña ya no se guardará nada. Cierra esta pestaña o usa la otra.',

  tlUnsupportedInsecureTitle: 'Esta dirección no es segura',
  tlUnsupportedInsecureBody: 'ProductivityPet necesita una dirección segura para asegurarse de que solo una pestaña lo use. Ábrelo desde https:// o desde http://localhost.',
  tlUnsupportedNoLocksTitle: 'Este navegador no puede limitarse a una pestaña',
  tlUnsupportedNoLocksBody: 'Este navegador no admite lo que ProductivityPet necesita para asegurarse de que solo una pestaña lo use. Prueba con un navegador actualizado.',
  tlUnsupportedNoStorageTitle: 'Este navegador no deja que ProductivityPet guarde',
  tlUnsupportedNoStorageBody: 'Guardar está bloqueado (una ventana privada o un ajuste del navegador). Permítelo para este sitio y vuelve a cargar la página.',

  tlHandoffTitle: 'Otra pestaña quiere usar ProductivityPet',
  tlHandoffBody: 'Si la dejas, esta pestaña guarda todo y vuelve a la lista de jugadores. Después la otra pestaña toma el control.',
  tlHandoffUnfinished: 'Esto todavía no está guardado y se perderá:',
  tlHandoffLet: 'Dejar que la otra pestaña tome el control',
  tlHandoffKeep: 'Seguir usando esta pestaña',
  tlHandoffSaving: 'Guardando todo…',
  tlHandoffFailedTitle: 'No se pudo guardar con seguridad',
  tlHandoffFailedBody: 'Algunos cambios no se pudieron guardar, así que esta pestaña mantiene el control y no se perdió nada.',
};
