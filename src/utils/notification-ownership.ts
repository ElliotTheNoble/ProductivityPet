import { LANGUAGES, translate } from '@/i18n';
import { FAMILY_CARE_ID_PREFIX } from '@/utils/family-care-plan';

// Who owns a notification (Stage 4.5e). PURE: it looks at one notification request (what the phone lists as scheduled, or what is in
// the notification tray) and says which kind of notification it is. The private clean-up that runs when a profile is left uses it to
// cancel exactly the notifications that belong to the private categories, and nothing else.
//
// Every notification this app can create (a static test, tests/notification-audit.test.ts, fails when a new scheduling site appears):
//   task-reminder         a task, appointment or birthday reminder (src/utils/notifications.ts). Carries the task text. PRIVATE.
//                         New ones are tagged `data: { pp: 'task' }`.
//   pet-alert             a pet's "isn't feeling well" or "urgent care" alert (src/utils/pet-alerts.ts). Names the pet. PRIVATE.
//                         Tagged `data: { petId, kind }` (kind is 'sick' or 'critical').
//   legacy-task-reminder  a task reminder scheduled by an older build, without the tag: no data, a date trigger, and a title that is
//                         EXACTLY one of the app's own reminder titles in a supported language. PRIVATE.
//   test                  the Alerts page's test notification. Public, harmless, never touched. New ones are tagged `data: { pp: 'test' }`;
//                         older ones are matched by their exact title and body.
//   family-care           the anonymous family-care reminders (src/utils/family-care.ts). Identifier starts with a reserved prefix
//                         and there is no data. Only the family-care scheduler ever creates or cancels these.
//   unknown               anything else. Never cancelled and never dismissed: it keeps the clean-up "unverified" for a decision.
//
// A notification that carries the reserved family-care prefix but also has data is NOT family-care: it is unknown (nothing the app
// creates looks like that, so it is not touched).

export type NotificationClass = 'task-reminder' | 'pet-alert' | 'legacy-task-reminder' | 'test' | 'family-care' | 'unknown';

// What the phone gives back for a scheduled or presented notification (only the parts used here).
export type NotificationLike = {
  identifier?: string | null;
  content?: { title?: string | null; body?: string | null; data?: unknown } | null;
  trigger?: { type?: string | null } | null;
};

export const PRIVATE_CLASSES: readonly NotificationClass[] = ['task-reminder', 'pet-alert', 'legacy-task-reminder'];

export function isPrivateClass(kind: NotificationClass): boolean {
  return PRIVATE_CLASSES.includes(kind);
}

// The exact titles an older build used for task reminders, in every supported language.
export function legacyTaskTitles(): ReadonlySet<string> {
  const titles = new Set<string>();
  for (const { code } of LANGUAGES) {
    for (const key of ['ntTask', 'ntAppointment', 'ntBirthday'] as const) titles.add(translate(code, key));
  }
  return titles;
}

function legacyTestTexts(): { titles: ReadonlySet<string>; bodies: ReadonlySet<string> } {
  const titles = new Set<string>();
  const bodies = new Set<string>();
  for (const { code } of LANGUAGES) {
    titles.add(translate(code, 'ntTestTitle'));
    bodies.add(translate(code, 'ntTestBody'));
  }
  return { titles, bodies };
}

function dataOf(request: NotificationLike): Record<string, unknown> | null {
  const data = request.content?.data;
  return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

function hasNoData(data: Record<string, unknown> | null): boolean {
  return data === null || Object.keys(data).length === 0;
}

export function classifyNotification(request: NotificationLike): NotificationClass {
  const identifier = typeof request.identifier === 'string' ? request.identifier : '';
  const data = dataOf(request);

  if (identifier.startsWith(FAMILY_CARE_ID_PREFIX)) return hasNoData(data) ? 'family-care' : 'unknown';

  if (data && !hasNoData(data)) {
    if (data.pp === 'task') return 'task-reminder';
    if (data.pp === 'test') return 'test';
    if (typeof data.petId === 'string' && (data.kind === 'sick' || data.kind === 'critical')) return 'pet-alert';
    return 'unknown';
  }

  // No data at all (the phone reports an empty object): only an exact match with something an older build produced counts.
  const title = request.content?.title;
  const body = request.content?.body;
  if (typeof title === 'string') {
    if (legacyTaskTitles().has(title) && request.trigger?.type === 'date') return 'legacy-task-reminder';
    const test = legacyTestTexts();
    if (test.titles.has(title) && typeof body === 'string' && test.bodies.has(body)) return 'test';
  }
  return 'unknown';
}
