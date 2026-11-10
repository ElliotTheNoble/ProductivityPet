// Spanish strings for the family profile picker. Same keys as family-picker.en.ts (TypeScript checks this). A native Spanish
// speaker should review them before release.
import type { familyPickerEn } from './family-picker.en';

type Table = { [K in keyof typeof familyPickerEn]: string };

export const familyPickerEs: Table = {
  fpTitle: '¿Quién juega hoy?',
  fpSubtitle: 'Toca tu nombre para jugar con tus mascotas.',
  fpLoading: 'Preparando todo…',
  fpLeaving: 'Guardando todo…',
  fpLeavingHint: 'Tus mascotas y tu progreso se están guardando. Espera un momento.',

  fpMain: 'Principal',
  fpMainSubProtected: 'Las mascotas de los padres. Pide el PIN de los padres.',
  fpMainMissingShort: 'Falta el PIN de los padres. Los niños pueden seguir jugando.',
  fpMainNoPin: 'Principal sigue bloqueado hasta que un adulto cree el PIN de los padres. Los niños pueden seguir jugando.',
  fpMainUnconfirmed: 'La creación del PIN de los padres aún no está terminada, así que Principal sigue bloqueado. Los niños pueden seguir jugando.',
  fpMainUnavailable: 'El PIN de los padres no se puede usar en este dispositivo ahora, así que Principal sigue bloqueado. Los niños pueden seguir jugando.',

  fpAddChild: 'Añadir un niño',
  fpAddChildSub: 'Un adulto añade a un niño con el PIN de los padres.',
  fpAddChildNeedsPin: 'Primero un adulto tiene que crear el PIN de los padres.',
  fpAddChildBlocked: 'No disponible hasta que el PIN de los padres esté creado y funcione.',
  fpAddChildMissing: 'No disponible: no se encuentra el PIN de los padres en este dispositivo.',

  fpBadgeChecking: 'Comprobando…',
  fpBadgeHealthy: 'Todo feliz',
  fpBadgeNeedsCare: 'Necesita cuidados',
  fpBadgeSick: 'Enferma',
  fpBadgeCritical: 'Necesita ayuda ya',
  fpBadgeDeceased: 'Una mascota ha fallecido',
  fpBadgeNew: 'Nuevo: hay un huevo esperando',
  fpBadgeUnreadable: 'No se puede comprobar ahora',

  fpCardLabel: '{name}. {status}. Toca dos veces para jugar.',
  fpMainCardLabel: 'Perfil Principal de los padres. {status}. {hint}',
  fpAddChildLabel: 'Añadir un niño. {hint}',

  fpSwitching: 'Preparando las mascotas de {name}…',
  fpSwitchingMain: 'Abriendo Principal…',
  fpErrorTitle: 'No ha funcionado',
  fpErrTimeout: 'Esto tarda demasiado, así que se detuvo. No se cambió nada.',
  fpErrStorage: 'No se pudo abrir este perfil porque ahora no se puede guardar. No se cambió nada.',
  fpErrUnsaved: 'Algunos cambios aún no se pudieron guardar, así que se detuvo la apertura de este perfil para que todo esté seguro. No se perdió nada.',
  fpErrBusy: 'Algo todavía se está terminando. Inténtalo de nuevo en un momento.',
  fpErrConflict: 'La lista de la familia se cambió en otro lugar. Inténtalo de nuevo.',
  fpErrUnknown: 'Ya no se encuentra ese perfil.',
  fpErrUnavailable: 'Los perfiles de la familia no están disponibles ahora porque no se pudo comprobar el almacenamiento de forma segura. No se pierde nada.',
  fpRetry: 'Intentar de nuevo',
  fpCancel: 'Atrás',

  fpSafeModeTitle: 'Los perfiles de la familia están en pausa',
  fpSafeModeBody: 'No se pudo comprobar el almacenamiento de forma segura, así que ahora no se pueden abrir los jugadores. No se pierde nada. Puedes intentarlo de nuevo.',
  fpHouseholdUnreadableTitle: 'No se puede leer la lista de la familia',
  fpHouseholdUnreadableBody: 'No se pudo leer la lista de jugadores, así que no se cambió nada. Puedes intentarlo de nuevo.',

  fpChildrenNotReadyTitle: 'Algunos jugadores aún no están listos',
  fpChildrenNotReadyBody: 'Algunos jugadores no se pudieron preparar ahora, así que están ocultos. No se pierde nada. Puedes intentarlo de nuevo.',
  fpErrMainLocked: 'Principal necesita el PIN de los padres, así que no se abrió.',

  fpPinTitle: 'PIN de los padres',
  fpPinBodyMain: 'Escribe el PIN de los padres para abrir Principal.',
  fpPinBodyAdd: 'Escribe el PIN de los padres para añadir a un niño.',
};
