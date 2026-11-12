import type { parentJournalEn } from './parent-journal.en';

// Spanish strings for the Shared Journals part of the Parent Dashboard. Same keys as parent-journal.en.ts.
export const parentJournalEs: Record<keyof typeof parentJournalEn, string> = {
  pjEmpty: 'Todavía no se ha compartido nada. Cuando {name} elija Compartir con mi padre o madre, la entrada aparecerá aquí.',
  pjUnreadable: 'No se pudo leer el diario ahora. No se cambió nada.',
  pjShowMore: 'Mostrar más',
  pjOpenEntry: 'Leer la entrada del {date}',
  pjBack: 'Volver',
  pjGone: 'Esta entrada ya no está compartida.',
  pjReadOnly: 'Solo lectura. Solo {name} puede cambiar esta entrada.',
};
