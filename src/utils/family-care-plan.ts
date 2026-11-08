import { advancePet, isEggStage, type PetRecord } from '@/utils/pet-lifecycle-core';
import { SICK_TO_CRITICAL_HOURS } from '@/utils/pet-family-config';

// The anonymous "family care" notification plan (Stage 4.5d). PURE: nothing here reads or writes storage, calls a notification API, sets a
// timer or reads a clock; the caller passes in everything (the pets' saved data, who is eligible, the time). It only works out WHICH
// generic notifications should exist, and when. Nothing uses it yet: scheduling, cancelling, channels and the profile-leave clean-up belong
// to a later stage.
//
// What a planned notification can contain: a fixed title, a fixed body in English or Spanish, a time, an urgency (which of two channels
// it would use later) and a local identifier made of a fixed prefix and a counter. No child, pet or profile name, no profile id, no
// pet id, no condition ("sick", "hungry"...) and no data payload. The plan's `report` DOES name profiles (so a caller can explain why
// a profile was left out); it is diagnostic only and must never be given to the notification system.
//
// Rules, in order:
//   1. Who counts: a profile is left out when it is archived, when it is the profile that is open right now (its own detailed alerts
//      cover it), when its own alert setting is off, or when its saved record could not be read. Main counts like any other profile.
//   2. Events: for each living pet at home that is not an egg: a healthy pet gets a "sick" event at the moment the pet lifecycle itself
//      will record it as sick if nobody looks after it, and a "critical" event 24 hours after that; a sick pet gets a "critical" event
//      24 hours after it fell sick; critical and deceased pets get none (their moment has passed). The "will record" moment is read from
//      the real lifecycle (advancePet run on a COPY, 14 days ahead), not from predictSickTime: predictSickTime ignores the dirty penalty
//      (a dirty pet's happiness falls twice as fast) and exhaustion, so for a dirty pet it can be a day late. The lifecycle result
//      includes both and nothing is added to it (no margin). It assumes the situation stays as it is NOW: feeding, washing or playing
//      with a pet, or a pet getting dirty, changes the real moment, so the plan is recomputed whenever the app can (leaving a profile,
//      the picker opening, coming back to the app, a household or setting change).
//   3. Anything not later than five seconds from now is dropped (the same margin the detailed alerts use).
//   4. Grouping: events are sorted by time and an event joins the group of the one that started it when it is within 30 minutes of that
//      first event. A group fires at its FIRST event's time, so grouping can only make a later event's notification earlier (by up to
//      30 minutes), never later. A group is critical when any event in it is.
//   5. Cap: at most 10 notifications, less when the platform's total pending-notification limit leaves less room. The EARLIEST group is
//      always kept (the nearest warning is what prompts someone to open the app). Among the others, when there are too many, the latest
//      "normal" groups go first, then the latest critical ones.
//   6. Wording: the exact text below. An unknown language gets English.

export const FAMILY_CARE_ID_PREFIX = 'pp-family-care-';
export const GROUP_WINDOW_MS = 30 * 60 * 1000;
export const MAX_GENERIC_NOTIFICATIONS = 10;
export const MIN_LEAD_MS = 5000;
// iOS keeps only the soonest 64 pending local notifications for the whole app (task reminders and detailed alerts included).
export const PLATFORM_PENDING_LIMIT = 64;

const HOUR_MS = 60 * 60 * 1000;
// How far ahead the lifecycle is asked about a healthy pet: longer than the slowest need takes to run out (Happiness: 100 / (5/6) = 120
// awake hours, 10 days of 12 awake hours).
export const LIFECYCLE_HORIZON_MS = 14 * 24 * HOUR_MS;
// No real event can be later than the horizon plus the sick-to-critical delay. A later one means the saved data or the clock is
// inconsistent (for example the clock was set back), and it is dropped rather than scheduled for a wrong moment.
export const MAX_EVENT_AHEAD_MS = LIFECYCLE_HORIZON_MS + SICK_TO_CRITICAL_HOURS * HOUR_MS;

export type CareUrgency = 'normal' | 'critical';
export type CareEvent = { atMs: number; urgency: CareUrgency };

export type ProfileCareInput = {
  profileId: string;
  kind: 'main' | 'child';
  archived: boolean;
  // The profile's OWN saved "pet alerts" switch.
  alertsEnabled: boolean;
  // False when the profile's saved record could not be read or understood: nothing is claimed about its pets.
  readable: boolean;
  events: readonly CareEvent[];
};

export type PlannedNotification = {
  identifier: string;
  atMs: number;
  urgency: CareUrgency;
  title: string;
  body: string;
};

export type SkipReason = 'archived' | 'open' | 'alerts-off' | 'unreadable' | 'duplicate' | 'no-events';
export type PlanReport = {
  included: string[];
  skipped: { profileId: string; reason: SkipReason }[];
  // Groups that did not fit under the cap.
  droppedGroups: number;
  cap: number;
};
export type FamilyCarePlan = { notifications: PlannedNotification[]; report: PlanReport };

export type PlanOptions = {
  now: number;
  // The profile in use right now (null at the picker). It is left out: it keeps its own detailed alerts.
  openProfileId: string | null;
  language: string;
  // Pending notifications that are not part of this plan (task reminders, the open profile's detailed alerts...).
  otherPendingCount?: number;
  platformLimit?: number;
  maxNotifications?: number;
};

// ---------------------------------------------------------------------------------------------------------
// wording

export const FAMILY_CARE_TITLE = 'ProductivityPet';
export const FAMILY_CARE_BODY = {
  en: 'A pet needs care. Open ProductivityPet.',
  es: 'Una mascota necesita cuidados. Abre ProductivityPet.',
} as const;

export function familyCareMessage(language: string): { title: string; body: string } {
  const body = language === 'es' ? FAMILY_CARE_BODY.es : FAMILY_CARE_BODY.en;
  return { title: FAMILY_CARE_TITLE, body };
}

// ---------------------------------------------------------------------------------------------------------
// events from saved pets

// The upcoming care events of one profile's pets, from its saved pets (already read; nothing is read or written here). The pets are
// advanced on COPIES with the same rules the app uses when the profile is opened. A pet whose saved data cannot be worked with (an
// invalid timestamp, anything that makes the lifecycle throw) simply contributes nothing.
export function careEventsFromPets(pets: readonly PetRecord[], now: Date): CareEvent[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  const events: CareEvent[] = [];
  const criticalAfterMs = SICK_TO_CRITICAL_HOURS * HOUR_MS;
  const add = (atMs: number, urgency: CareUrgency) => {
    if (Number.isFinite(atMs) && atMs <= nowMs + MAX_EVENT_AHEAD_MS) events.push({ atMs, urgency });
  };
  for (const saved of pets) {
    try {
      if (saved.retired) continue; // in Pet Pawadise: frozen, never sick
      const pet = advancePet(saved, now);
      if (pet.lifecycle.state === 'deceased') continue;
      if (isEggStage(pet.growthUnits)) continue; // an egg cannot get sick
      if (pet.lifecycle.state === 'healthy') {
        // When would the lifecycle itself mark this pet sick if nothing changes? Run it far ahead on a copy: whatever happens on the
        // way (the dirty penalty, bedtime, exhaustion) is already in its answer.
        const ahead = advancePet(pet, new Date(nowMs + LIFECYCLE_HORIZON_MS));
        const since = ahead.lifecycle.sickSince ? new Date(ahead.lifecycle.sickSince).getTime() : Number.NaN;
        if (Number.isFinite(since)) {
          add(since, 'normal');
          add(since + criticalAfterMs, 'critical');
        }
      } else if (pet.lifecycle.state === 'sick' && pet.lifecycle.sickSince) {
        add(new Date(pet.lifecycle.sickSince).getTime() + criticalAfterMs, 'critical');
      }
      // 'critical': the sick and critical moments have both passed, and nothing is announced for a death.
    } catch {
      // unusable saved pet: nothing is claimed about it
    }
  }
  return events;
}

// Whether a profile's saved pet-alert setting is on: the same rule as the detailed alerts (only an explicit `true`). A missing or
// damaged record is "off".
export function alertsEnabledFromSaved(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { notifications?: unknown } | null;
    return !!parsed && typeof parsed === 'object' && parsed.notifications === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// the plan

type Group = { atMs: number; urgency: CareUrgency };

// How many generic notifications may exist given the platform's total limit and what else is already pending.
export function genericCap(options: Pick<PlanOptions, 'otherPendingCount' | 'platformLimit' | 'maxNotifications'>): number {
  // A number that is not a number is the safe answer: no room.
  const whole = (value: number | undefined, fallback: number): number =>
    value === undefined ? fallback : Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  // 10 is a ceiling: a caller can ask for fewer, never for more.
  const max = Math.min(MAX_GENERIC_NOTIFICATIONS, whole(options.maxNotifications, MAX_GENERIC_NOTIFICATIONS));
  const limit = whole(options.platformLimit, PLATFORM_PENDING_LIMIT);
  const others = options.otherPendingCount === undefined ? 0 : Number.isFinite(options.otherPendingCount) ? Math.max(0, Math.floor(options.otherPendingCount)) : Infinity;
  return Math.min(max, Math.max(0, limit - others));
}

export function buildFamilyCarePlan(inputs: readonly ProfileCareInput[], options: PlanOptions): FamilyCarePlan {
  const report: PlanReport = { included: [], skipped: [], droppedGroups: 0, cap: genericCap(options) };
  const events: CareEvent[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    if (seen.has(input.profileId)) {
      report.skipped.push({ profileId: input.profileId, reason: 'duplicate' });
      continue;
    }
    seen.add(input.profileId);
    if (input.archived) {
      report.skipped.push({ profileId: input.profileId, reason: 'archived' });
      continue;
    }
    if (options.openProfileId !== null && input.profileId === options.openProfileId) {
      report.skipped.push({ profileId: input.profileId, reason: 'open' });
      continue;
    }
    if (!input.alertsEnabled) {
      report.skipped.push({ profileId: input.profileId, reason: 'alerts-off' });
      continue;
    }
    if (!input.readable) {
      report.skipped.push({ profileId: input.profileId, reason: 'unreadable' });
      continue;
    }
    const usable = input.events.filter(
      (event) => Number.isFinite(event.atMs) && event.atMs > options.now + MIN_LEAD_MS && event.atMs <= options.now + MAX_EVENT_AHEAD_MS
    );
    if (usable.length === 0) {
      report.skipped.push({ profileId: input.profileId, reason: 'no-events' });
      continue;
    }
    report.included.push(input.profileId);
    events.push(...usable);
  }

  // Group: sorted by time; an event within the window of the event that started the group joins it. The group fires at that first
  // event's time.
  events.sort((a, b) => a.atMs - b.atMs);
  let groups: Group[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && event.atMs - last.atMs <= GROUP_WINDOW_MS) {
      if (event.urgency === 'critical') last.urgency = 'critical';
    } else {
      groups.push({ atMs: event.atMs, urgency: event.urgency });
    }
  }

  // Cap: the earliest group is always kept. Of the rest, the latest normal groups go first, then the latest critical ones.
  if (groups.length > report.cap) {
    const drop = groups.length - report.cap;
    report.droppedGroups = drop;
    if (report.cap <= 0) {
      groups = [];
    } else {
      const doomed = new Set<Group>();
      const latestFirst = groups.slice(1).reverse();
      for (const urgency of ['normal', 'critical'] as const) {
        for (const group of latestFirst) {
          if (doomed.size >= drop) break;
          if (group.urgency === urgency) doomed.add(group);
        }
      }
      groups = groups.filter((group) => !doomed.has(group));
    }
  }

  const { title, body } = familyCareMessage(options.language);
  const notifications: PlannedNotification[] = groups.map((group, index) => ({
    identifier: `${FAMILY_CARE_ID_PREFIX}${index}`,
    atMs: group.atMs,
    urgency: group.urgency,
    title,
    body,
  }));
  return { notifications, report };
}
