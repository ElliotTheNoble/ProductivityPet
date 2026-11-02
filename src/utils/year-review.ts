import { getLocale, tn, tr } from '@/i18n';
import { categoryLabel, type TaskCategory } from '@/utils/categorize-task';
import { moodName, type Mood } from '@/utils/mood';

// Builds the written "My Year in Review" recap from the player's REAL saved
// data — a local template, not an AI service, so nothing private ever leaves
// the device. Every sentence is only included when the data for it exists;
// nothing is assumed about why anything was felt, moods are never called good
// or bad, and journal text is quoted exactly as written (only shortened).

export type YearReviewFacts = {
  year: number;
  // True for the current calendar year: the recap reads as "so far" and
  // only covers January 1 through today (nothing in the future is counted).
  isCurrentYear: boolean;
  taskCount: number;
  topCategories: { category: string; count: number }[];
  moodCount: number;
  topMood: string | null;
  reflectionCount: number;
  // Paw Tokens earned that year (from the recorded earnings history only).
  tokensEarned: number;
  // Days with at least one completed task, and the longest run of them.
  activeDays: number;
  longestStreak: number;
  // The player's own words (already trimmed/shortened by the caller).
  highlights: string[];
  // Plain statements about recorded pet dates in this year.
  petMilestones: string[];
};

// "a and b" / "a, b, and c" in the current language.
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return tr('yrJoin2', { a: items[0], b: items[1] });
  return tr('yrJoin3', { a: items.slice(0, -1).join(', '), c: items[items.length - 1] });
}

export function hasAnyYearData(facts: YearReviewFacts): boolean {
  return (
    facts.taskCount > 0 || facts.tokensEarned > 0 || facts.activeDays > 0 || facts.moodCount > 0 || facts.reflectionCount > 0 || facts.petMilestones.length > 0
  );
}

// Shortens a reflection to a quotable snippet without altering its wording.
export function snippet(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

// The written recap is assembled from translated sentence templates (see history.en.ts / history.es.ts); the
// player's own reflection quotes, pet names and category/mood names are inserted afterwards.
export function buildYearRecap(facts: YearReviewFacts): string {
  const now = facts.isCurrentYear;
  if (!hasAnyYearData(facts)) {
    return now ? tr('yrRecapEmptyNow', { year: facts.year }) : tr('yrRecapEmptyPast', { year: facts.year });
  }
  const sentences: string[] = [];

  const pieces: string[] = [];
  if (facts.taskCount > 0) pieces.push(tn(now ? 'yrPieceTasksNow' : 'yrPieceTasksPast', facts.taskCount));
  if (facts.tokensEarned > 0) {
    pieces.push(tn(now ? 'yrPieceTokensNow' : 'yrPieceTokensPast', facts.tokensEarned, { n: facts.tokensEarned.toLocaleString(getLocale()) }));
  }
  if (facts.activeDays > 0) pieces.push(tn(now ? 'yrPieceActiveNow' : 'yrPieceActivePast', facts.activeDays));
  if (pieces.length > 0) {
    const topNames = facts.topCategories.slice(0, 2).map((c) => categoryLabel(c.category as TaskCategory));
    sentences.push(
      tr(now ? 'yrLeadNow' : 'yrLeadPast', { year: facts.year, list: joinList(pieces) }) +
        (facts.taskCount > 0 && topNames.length > 0 ? tr('yrTopCats', { list: joinList(topNames) }) : '') +
        '.'
    );
  }
  if (facts.longestStreak >= 2) {
    sentences.push(tr(now ? 'yrStreakNow' : 'yrStreakPast', { n: facts.longestStreak }));
  }

  if (facts.moodCount > 0) {
    sentences.push(
      tn('yrRecapMood', facts.moodCount) +
        (facts.topMood ? tr('yrRecapMoodTop', { mood: moodName(facts.topMood as Mood) }) : '') +
        '.'
    );
  }

  if (facts.reflectionCount > 0) {
    const quoted = facts.highlights.slice(0, 2).map((text) => `“${text}”`);
    sentences.push(
      tn('yrRecapRefl', facts.reflectionCount) +
        (quoted.length > 0 ? tr('yrRecapQuote', { list: joinList(quoted) }) : '') +
        '.'
    );
  }

  if (facts.petMilestones.length > 0) {
    sentences.push(tr('yrRecapAlong', { list: joinList(facts.petMilestones) }));
  }

  sentences.push(tr(now ? 'yrEndNow' : 'yrEndPast'));
  return sentences.join(' ');
}
