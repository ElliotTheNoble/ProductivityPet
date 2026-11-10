import type { parentGateEn } from './parent-gate.en';

export const parentGateEs: Record<keyof typeof parentGateEn, string> = {
  pgTitle: 'Área para padres',
  pgSubtitle: 'Escribe el PIN de los padres para continuar.',
  pgPinLabel: 'PIN de los padres',
  pgPinPlaceholder: 'Tu PIN de padres',
  pgUnlock: 'Desbloquear',
  pgChecking: 'Comprobando…',
  pgWrong: 'Ese PIN no es correcto.',
  pgTriesLeft_one: 'Te queda {count} intento antes de que haga falta el bloqueo de pantalla del teléfono.',
  pgTriesLeft_other: 'Te quedan {count} intentos antes de que haga falta el bloqueo de pantalla del teléfono.',
  pgDeviceCheck: 'Son 5 PIN incorrectos seguidos. Para seguir intentando, confirma con el bloqueo de pantalla de tu teléfono.',
  pgDeviceCheckButton: 'Usar el bloqueo de pantalla del teléfono',
  pgDeviceCheckPrompt: 'Confirma que eres tú para seguir probando el PIN de los padres',
  pgDeviceCheckCancel: 'Cancelar',
  pgDeviceCheckCancelled: 'Se canceló la comprobación del bloqueo de pantalla, así que todavía no hay más intentos.',
  pgDeviceCheckFailed: 'La comprobación del bloqueo de pantalla no se superó. Inténtalo de nuevo.',
  pgDeviceCheckUnavailable: 'No se pudo abrir la comprobación del bloqueo de pantalla del teléfono. Inténtalo de nuevo.',
  pgDeviceCheckNoLock: 'Los intentos del PIN de padres están detenidos en este teléfono porque no tiene bloqueo de pantalla. Usa tu código de recuperación para continuar, o activa un bloqueo de pantalla en el teléfono e inténtalo de nuevo.',
  pgFormat: 'Escribe tu PIN de padres.',
  pgUnavailable: 'No se pudo comprobar el PIN ahora mismo. No se cambió nada. Inténtalo de nuevo.',
  pgBackHome: 'Volver al inicio',
  pgForgotTitle: '¿Olvidaste el PIN?',
  pgForgotText:
    'Usa el código de recuperación que guardaste para elegir un PIN nuevo. Si perdiste el PIN y el código, el área para padres sigue bloqueada y los datos de tu familia se conservan: nunca se borran para restablecer un PIN. Las cuentas de padres que podrán ayudar a recuperar el acceso llegarán en una versión futura.',
  pgHonest: 'Este PIN solo ayuda a mantener a los niños fuera del área para padres en este dispositivo. No comprueba quién está usando la app.',
  pgVerifierMissing:
    'Este dispositivo tiene datos de la familia, pero no se encuentra su PIN de los padres (por ejemplo, después de restaurar una copia o en un dispositivo nuevo). Los datos de tus hijos están a salvo y no se cambió ni se borró nada. El acceso de los padres necesitará la recuperación con una cuenta de tutor, que llegará en una versión futura.',
  pgUnlockedBar: 'Área para padres desbloqueada',
  pgLockNow: 'Bloquear ahora',
  pgCardLocked: 'El área para padres está protegida con un PIN.',
  pgUnlockButton: 'Desbloquear área para padres',
};
