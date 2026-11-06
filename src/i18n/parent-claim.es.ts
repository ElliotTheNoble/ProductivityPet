// Spanish strings for the protected first-time Parent PIN setup. Same keys as parent-claim.en.ts (TypeScript checks this). A native
// Spanish speaker should review them before release.
import type { parentClaimEn } from './parent-claim.en';

type Table = { [K in keyof typeof parentClaimEn]: string };

export const parentClaimEs: Table = {
  pkTitle: 'Terminar la configuración de los padres',
  pkWhy: 'Esta familia tiene niños pero todavía no tiene PIN de los padres. Antes de crear un PIN hace falta la comprobación de seguridad del propio dispositivo.',
  pkHonest:
    'La comprobación solo confirma que alguien puede desbloquear este dispositivo. No demuestra quién eres ni que seas madre, padre o tutor, así que mantén en secreto la clave del dispositivo.',
  pkCheck: 'Comprobar la seguridad del dispositivo',
  pkChecking: 'Esperando la comprobación de seguridad del dispositivo…',
  pkPrompt: 'Confirma para crear el PIN de los padres',
  pkCancelLabel: 'Cancelar',
  pkNotSecured:
    'Este dispositivo aún no tiene bloqueo de pantalla. Activa una clave, un patrón, la huella o el reconocimiento facial en los ajustes del dispositivo y vuelve a intentarlo. No se cambió nada.',
  pkCancelled: 'Se canceló la comprobación. No se cambió nada.',
  pkFailed: 'La comprobación de seguridad del dispositivo no tuvo éxito. No se cambió nada. Puedes intentarlo de nuevo.',
  pkLockout: 'Demasiados intentos. Espera un momento, o desbloquea el dispositivo con normalidad, y vuelve a intentarlo. No se cambió nada.',
  pkUnavailable: 'Ahora no se puede comprobar la seguridad del dispositivo. No se cambió nada.',
  pkUnsupported: 'Esto solo se puede hacer en la aplicación del teléfono o la tableta, no en un navegador web. No se cambió nada.',
  pkClaimRequired: 'Primero hay que hacer la comprobación de seguridad del dispositivo.',
  pkBack: 'Atrás',
  pkPickerButton: 'Terminar la configuración de los padres',
  pkPickerHint: 'Un adulto tiene que terminar la configuración antes de poder abrir Principal.',
  pkCardText: 'Primero un adulto tiene que terminar de crear el PIN de los padres.',
};
