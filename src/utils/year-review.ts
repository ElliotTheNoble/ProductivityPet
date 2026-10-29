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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
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

export function buildYearRecap(facts: YearReviewFacts): string {
  if (!hasAnyYearData(facts)) {
    return facts.isCurrentYear
      ? `Your ${facts.year} is just getting started — nothing is recorded yet. As you complete tasks, check in with your mood, and write reflections, your story so far will build up here.`
      : `There isn't anything recorded for ${facts.year} yet.`;
  }
  const sentences: string[] = [];

  // "You completed 180 tasks, earned 1,250 tokens, and stayed productive on
  // 92 different days" — each piece only when its data exists.
  const pieces: string[] = [];
  if (facts.taskCount > 0) pieces.push(`completed ${plural(facts.taskCount, 'task', 'tasks')}`);
  if (facts.tokensEarned > 0) {
    pieces.push(`earned ${facts.tokensEarned.toLocaleString()} Paw ${facts.tokensEarned === 1 ? 'Token' : 'Tokens'}`);
  }
  if (facts.activeDays > 0) {
    pieces.push(`stayed productive on ${facts.activeDays} different ${facts.activeDays === 1 ? 'day' : 'days'}`);
  }
  if (pieces.length > 0) {
    const topNames = facts.topCategories.slice(0, 2).map((c) => c.category);
    sentences.push(
      `${facts.isCurrentYear ? `So far in ${facts.year}, you have` : `In ${facts.year}, you`} ${joinList(pieces)}` +
        (facts.taskCount > 0 && topNames.length > 0 ? `, with the most accomplishments in ${joinList(topNames)}` : '') +
        '.'
    );
  }
  if (facts.longestStreak >= 2) {
    sentences.push(
      `Your longest streak ${facts.isCurrentYear ? 'so far' : 'that year'} was ${facts.longestStreak} days in a row.`
    );
  }

  if (facts.moodCount > 0) {
    sentences.push(
      `You recorded ${plural(facts.moodCount, 'mood check-in', 'mood check-ins')}` +
        (facts.topMood ? `, and ${facts.topMood} was the mood you recorded most` : '') +
        '.'
    );
  }

  if (facts.reflectionCount > 0) {
    const quoted = facts.highlights.slice(0, 2).map((text) => `“${text}”`);
    sentences.push(
      `You saved ${plural(facts.reflectionCount, 'personal reflection', 'personal reflections')}` +
        (quoted.length > 0 ? `. In your own words: ${joinList(quoted)}` : '') +
        '.'
    );
  }

  if (facts.petMilestones.length > 0) {
    sentences.push(`Along the way: ${joinList(facts.petMilestones)}.`);
  }

  sentences.push(
    facts.isCurrentYear
      ? 'Your year is still being written — every little step counts. Keep going! 💗'
      : 'Thank you for taking a moment to look back — every little step counts. 💗'
  );
  return sentences.join(' ');
}
