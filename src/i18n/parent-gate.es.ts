import type { parentGateEn } from './parent-gate.en';

export const parentGateEs: Record<keyof typeof parentGateEn, string> = {
  pgTitle: 'Área para padres',
  pgSubtitle: 'Escribe el PIN de los padres para continuar.',
  pgPinLabel: 'PIN de los padres',
  pgPinPlaceholder: 'De 6 a 8 dígitos',
  pgUnlock: 'Desbloquear',
  pgChecking: 'Comprobando…',
  pgWrong: 'Ese PIN no es correcto.',
  pgTriesLeft_one: 'Queda {count} intento antes de una pausa corta.',
  pgTriesLeft_other: 'Quedan {count} intentos antes de una pausa corta.',
  pgCooldown: 'Demasiados intentos. Espera {time} antes de volver a intentarlo.',
  pgFormat: 'Escribe de 6 a 8 dígitos.',
  pgUnavailable: 'No se pudo comprobar el PIN ahora mismo. No se cambió nada. Inténtalo de nuevo.',
  pgBackHome: 'Volver al inicio',
  pgForgotTitle: '¿Olvidaste el PIN?',
  pgForgotText:
    'Esta versión de la app no puede restablecer el PIN por ti, y los datos de tu familia nunca se borran para restablecerlo. Las cuentas de padres que podrán ayudar a recuperar el acceso llegarán en una versión futura.',
  pgHonest: 'Este PIN solo ayuda a mantener a los niños fuera del área para padres en este dispositivo. No comprueba quién está usando la app.',
  pgVerifierMissing:
    'Este dispositivo tiene datos de la familia, pero no se encuentra su PIN de los padres (por ejemplo, después de restaurar una copia o en un dispositivo nuevo). Los datos de tus hijos están a salvo y no se cambió ni se borró nada. El acceso de los padres necesitará la recuperación con una cuenta de tutor, que llegará en una versión futura.',
  pgUnlockedBar: 'Área para padres desbloqueada',
  pgLockNow: 'Bloquear ahora',
  pgCardLocked: 'El área para padres está protegida con un PIN.',
  pgUnlockButton: 'Desbloquear área para padres',
};
