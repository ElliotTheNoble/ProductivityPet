// Spanish strings for the Parent Dashboard's family management and Family Health. Same keys as family-management.en.ts (TypeScript checks
// this). A native Spanish speaker should review them before release.
import type { familyManagementEn } from './family-management.en';

type Table = { [K in keyof typeof familyManagementEn]: string };

export const familyManagementEs: Table = {
  fmRename: 'Cambiar nombre',
  fmArchive: 'Archivar',
  fmRestore: 'Restaurar',
  fmRenameLabel: 'Cambiar el nombre de {name}',
  fmArchiveLabel: 'Archivar a {name}',
  fmRestoreLabel: 'Restaurar a {name}',
  fmSelectLabel: 'Seleccionar a {name}',
  fmArchivedTitle: 'Niños archivados',
  fmArchivedShow: 'Mostrar niños archivados ({count})',
  fmArchivedHide: 'Ocultar niños archivados ({count})',
  fmArchivedHelp: 'Los niños archivados no aparecen en "¿Quién juega hoy?". No se borra nada, y sus mascotas siguen envejeciendo.',
  fmArchivedAging: 'Sus mascotas siguen envejeciendo mientras está archivado.',
  fmNewName: 'Nuevo apodo',

  fmAdded: 'Se añadió a {name}.',
  fmRenamed: 'Guardado. Ahora el niño se llama {name}.',
  fmArchived: 'Se archivó a {name}. No se borró nada.',
  fmRestored: 'Se restauró a {name} con todo lo que estaba guardado.',
  fmDismiss: 'Cerrar',

  fmDuplicate: 'Ya hay otro niño que se llama "{name}". Puedes usarlo igualmente, pero los dos se verán iguales.',

  fmErrorTitle: 'No ha funcionado',
  fmErrStorage: 'No se pudo guardar. No se cambió nada. Inténtalo de nuevo.',
  fmErrStorageMayBeFull:
    'Guardar no funcionó dos veces seguidas. Puede que el almacenamiento del dispositivo esté lleno, o que haya otro problema. No se guardó nada. Si puedes, libera espacio e inténtalo de nuevo.',
  fmErrConflict: 'La lista de la familia se cambió en otro lugar. No se sobrescribió nada. Inténtalo de nuevo.',
  fmErrBlocked: 'La lista de la familia tiene un problema (dos niños comparten un ID), así que no se puede cambiar. No se cambió nada. Mira Salud de la familia más abajo.',
  fmErrLocked: 'La sesión de los padres terminó. Desbloquea el área para padres con el PIN e inténtalo de nuevo. No se cambió nada.',
  fmErrPinRequired: 'Primero hay que crear un PIN de los padres. No se cambió nada.',
  fmErrUnconfirmed: 'Primero hay que confirmar el código de recuperación. No se cambió nada.',
  fmErrUnavailable: 'Ahora los perfiles de la familia no están disponibles porque no se pudo comprobar el almacenamiento de forma segura. No se cambió nada.',
  fmErrNotFound: 'Ya no se encuentra a ese niño. No se cambió nada.',
  fmErrInvalid: 'Escribe un apodo.',
  fmErrActive: '{name} está jugando ahora mismo. Abre Principal desde "¿Quién juega hoy?" primero y luego archiva.',
  fmErrOther: 'Algo salió mal. No se cambió nada.',

  fmArchiveTitle: '¿Archivar a {name}?',
  fmArchiveSaved: 'No se borra nada. Las mascotas, tareas, fichas y todo lo demás de {name} siguen guardados.',
  fmArchiveAging:
    'Las mascotas siguen envejeciendo mientras está archivado. Pueden tener hambre, ensuciarse y ponerse tristes, pueden enfermar y pueden fallecer si nadie las cuida.',
  fmArchiveRestoreNote: 'Al restaurar a {name} todo vuelve como estaba, pero no vuelve una mascota que ya falleció.',
  fmArchiveStatus: 'Ahora mismo: {status}',
  fmArchiveStatusUnknown: 'Ahora mismo: no se puede comprobar el estado de las mascotas.',
  fmArchiveConfirm: 'Sí, archivar a {name}',

  fmHealthTitle: 'Salud de la familia',
  fmHealthIntro: 'Aquí solo se muestra lo que necesita atención. Nunca se borra, repara ni une nada automáticamente.',
  fmHealthRefresh: 'Comprobar de nuevo',
  fmHealthCareTitle: 'Mascotas que necesitan cuidados',
  fmHealthCareActive: '{name}: {status}',
  fmHealthCareArchived: '{name} (archivado, sus mascotas siguen envejeciendo): {status}',
  fmHealthPetsUnreadable: '{name}: ahora no se pueden leer las mascotas guardadas. No se cambió nada.',
  fmHealthStoragePaused: 'Los perfiles de la familia están en pausa porque no se pudo comprobar el almacenamiento de forma segura. No se pierde nada.',
  fmHealthHouseholdUnreadable: 'No se pudo leer la lista de la familia, así que no se puede cambiar nada. No se perdió nada.',
  fmHealthUnreadableEntries_one: 'No se pudo entender {count} entrada de la lista de la familia. Se guardó una copia de seguridad del original y no se perdió nada.',
  fmHealthUnreadableEntries_other: 'No se pudieron entender {count} entradas de la lista de la familia. Se guardó una copia de seguridad del original y no se perdió nada.',
  fmHealthDuplicate: 'Dos o más niños comparten el mismo ID permanente ({ids}). La lista de la familia es de solo lectura hasta que se resuelva. No se cambió nada.',
  fmHealthInvalidIds_one: '{count} niño tiene un ID que no sirve como perfil, así que no aparece en "¿Quién juega hoy?". No se cambió nada.',
  fmHealthInvalidIds_other: '{count} niños tienen IDs que no sirven como perfil, así que no aparecen en "¿Quién juega hoy?". No se cambió nada.',
  fmHealthUnlinked_one: '{count} niño aún no está listo para jugar (su perfil no está enlazado). La aplicación lo intenta de nuevo al iniciar. No se perdió nada.',
  fmHealthUnlinked_other: '{count} niños aún no están listos para jugar (sus perfiles no están enlazados). La aplicación lo intenta de nuevo al iniciar. No se perdió nada.',
  fmHealthOrphanEmpty_one: 'Quedó {count} perfil vacío sin usar de un niño que no se pudo guardar. No tiene datos y es inofensivo. No se borra nada automáticamente.',
  fmHealthOrphanEmpty_other: 'Quedaron {count} perfiles vacíos sin usar de niños que no se pudieron guardar. No tienen datos y son inofensivos. No se borra nada automáticamente.',
  fmHealthOrphanData_one: '{count} perfil tiene datos guardados pero ningún niño en la lista de la familia. No se borró, unió ni enlazó nada, y por ahora no se puede arreglar desde aquí.',
  fmHealthOrphanData_other: '{count} perfiles tienen datos guardados pero ningún niño en la lista de la familia. No se borró, unió ni enlazó nada, y por ahora no se puede arreglar desde aquí.',
};
