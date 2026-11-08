import {
  FAMILY_CARE_BODY,
  FAMILY_CARE_ID_PREFIX,
  FAMILY_CARE_TITLE,
  GROUP_WINDOW_MS,
  MAX_EVENT_AHEAD_MS,
  MAX_GENERIC_NOTIFICATIONS,
  MIN_LEAD_MS,
  PLATFORM_PENDING_LIMIT,
  alertsEnabledFromSaved,
  buildFamilyCarePlan,
  careEventsFromPets,
  familyCareMessage,
  genericCap,
  type CareEvent,
  type ProfileCareInput,
} from '@/utils/family-care-plan';
import { advancePet, predictSickTime } from '@/utils/pet-lifecycle-core';
import { SICK_TO_CRITICAL_HOURS } from '@/utils/pet-family-config';
import { DAY, HOUR, T0, iso, local, pet } from './helpers';

// Stage 4.5d: the PURE family-care plan. Nothing here touches storage or notifications; these tests pin who is included, what the events
// are, how they are grouped and capped, and that a planned notification can never carry anything private.

const MIN = 60 * 1000;
const NOW = T0;
const normal = (atMs: number): CareEvent => ({ atMs, urgency: 'normal' });
const critical = (atMs: number): CareEvent => ({ atMs, urgency: 'critical' });
const input = (profileId: string, events: CareEvent[], over: Partial<ProfileCareInput> = {}): ProfileCareInput => ({
  profileId,
  kind: profileId === 'main' ? 'main' : 'child',
  archived: false,
  alertsEnabled: true,
  readable: true,
  events,
  ...over,
});
const plan = (inputs: ProfileCareInput[], over: Partial<Parameters<typeof buildFamilyCarePlan>[1]> = {}) =>
  buildFamilyCarePlan(inputs, { now: NOW, openProfileId: null, language: 'en', ...over });
const times = (p: ReturnType<typeof plan>) => p.notifications.map((n) => n.atMs);

describe('the constants', () => {
  test('are pinned', () => {
    expect(MAX_GENERIC_NOTIFICATIONS).toBe(10);
    expect(GROUP_WINDOW_MS).toBe(30 * MIN);
    expect(MIN_LEAD_MS).toBe(5000);
    expect(PLATFORM_PENDING_LIMIT).toBe(64);
    expect(FAMILY_CARE_ID_PREFIX).toBe('pp-family-care-');
  });
});

describe('who is included', () => {
  const soon = [normal(NOW + HOUR)];

  test('Main and children with alerts on and a readable record are included', () => {
    const p = plan([input('main', soon), input('kid-a', [normal(NOW + 3 * HOUR)])]);
    expect(p.report.included).toEqual(['main', 'kid-a']);
    expect(p.notifications).toHaveLength(2);
  });

  test('an archived child is never included, whatever its events and setting say', () => {
    const p = plan([input('kid-old', soon, { archived: true }), input('kid-a', [normal(NOW + 5 * HOUR)])]);
    expect(p.report.skipped).toContainEqual({ profileId: 'kid-old', reason: 'archived' });
    expect(times(p)).toEqual([NOW + 5 * HOUR]);
  });

  test('the profile that is open is left out (its own detailed alerts cover it); at the picker nobody is', () => {
    const open = plan([input('kid-a', soon), input('kid-b', [normal(NOW + 4 * HOUR)])], { openProfileId: 'kid-a' });
    expect(open.report.skipped).toContainEqual({ profileId: 'kid-a', reason: 'open' });
    expect(times(open)).toEqual([NOW + 4 * HOUR]);
    const picker = plan([input('kid-a', soon), input('kid-b', [normal(NOW + 4 * HOUR)])]);
    expect(picker.report.included).toEqual(['kid-a', 'kid-b']);
  });

  test('Main is included only when its own alert setting is on, and counts as the open profile when it is open', () => {
    expect(plan([input('main', soon, { alertsEnabled: false })]).notifications).toEqual([]);
    expect(plan([input('main', soon, { alertsEnabled: false })]).report.skipped).toEqual([{ profileId: 'main', reason: 'alerts-off' }]);
    expect(plan([input('main', soon)]).notifications).toHaveLength(1);
    expect(plan([input('main', soon)], { openProfileId: 'main' }).notifications).toEqual([]);
  });

  test('a profile whose alerts are off, or whose record could not be read, contributes nothing', () => {
    const p = plan([input('kid-a', soon, { alertsEnabled: false }), input('kid-b', soon, { readable: false }), input('kid-c', [])]);
    expect(p.notifications).toEqual([]);
    expect(p.report.skipped).toEqual([
      { profileId: 'kid-a', reason: 'alerts-off' },
      { profileId: 'kid-b', reason: 'unreadable' },
      { profileId: 'kid-c', reason: 'no-events' },
    ]);
  });

  test('the same profile given twice counts once', () => {
    const p = plan([input('kid-a', [normal(NOW + HOUR)]), input('kid-a', [normal(NOW + 10 * HOUR)])]);
    expect(times(p)).toEqual([NOW + HOUR]);
    expect(p.report.skipped).toContainEqual({ profileId: 'kid-a', reason: 'duplicate' });
  });

  test('the inputs are never changed', () => {
    const inputs = [input('main', [normal(NOW + HOUR)]), input('kid-a', [critical(NOW + 2 * HOUR)])];
    const frozen = JSON.stringify(inputs);
    Object.freeze(inputs);
    for (const i of inputs) {
      Object.freeze(i);
      Object.freeze(i.events);
    }
    plan(inputs);
    expect(JSON.stringify(inputs)).toBe(frozen);
  });
});

describe('which moments count', () => {
  test('events in the past, now, and within five seconds are dropped; one millisecond later is kept', () => {
    const p = plan([input('kid-a', [normal(NOW - HOUR), normal(NOW), normal(NOW + MIN_LEAD_MS), normal(NOW + MIN_LEAD_MS + 1)])]);
    expect(times(p)).toEqual([NOW + MIN_LEAD_MS + 1]);
  });

  test('non-finite times are dropped', () => {
    const p = plan([input('kid-a', [normal(Number.NaN), normal(Number.POSITIVE_INFINITY), normal(NOW + HOUR)])]);
    expect(times(p)).toEqual([NOW + HOUR]);
  });
});

describe('grouping within 30 minutes', () => {
  test('events at 0, 29 and exactly 30 minutes are one notification at the FIRST time; 30 minutes and 1 ms starts another', () => {
    const t = NOW + HOUR;
    const p = plan([input('kid-a', [normal(t), normal(t + 29 * MIN), normal(t + 30 * MIN), normal(t + 30 * MIN + 1)])]);
    expect(times(p)).toEqual([t, t + 30 * MIN + 1]);
  });

  test('the window is measured from the first event of the group, not chained from the last', () => {
    const t = NOW + HOUR;
    const p = plan([input('kid-a', [normal(t), normal(t + 20 * MIN), normal(t + 40 * MIN)])]);
    expect(times(p)).toEqual([t, t + 40 * MIN]);
  });

  test('a notification is never later than any event it stands for, and never more than 30 minutes earlier', () => {
    const t = NOW + HOUR;
    const events = [normal(t + 25 * MIN), normal(t), normal(t + 10 * MIN)];
    const p = plan([input('kid-a', events)]);
    expect(p.notifications).toHaveLength(1);
    const n = p.notifications[0];
    for (const e of events) {
      expect(n.atMs).toBeLessThanOrEqual(e.atMs);
      expect(e.atMs - n.atMs).toBeLessThanOrEqual(GROUP_WINDOW_MS);
    }
  });

  test('several pets of one profile and several profiles around the same time are one notification', () => {
    const t = NOW + 2 * HOUR;
    const p = plan([
      input('main', [normal(t), normal(t + 5 * MIN)]),
      input('kid-a', [normal(t + 1 * MIN)]),
      input('kid-b', [normal(t + 2 * MIN), normal(t)]),
    ]);
    expect(p.notifications).toHaveLength(1);
    expect(p.notifications[0].atMs).toBe(t);
  });

  test('a group is critical when any event in it is, wherever it falls in the group', () => {
    const t = NOW + HOUR;
    expect(plan([input('a', [normal(t), critical(t + 10 * MIN)])]).notifications[0].urgency).toBe('critical');
    expect(plan([input('a', [critical(t), normal(t + 10 * MIN)])]).notifications[0].urgency).toBe('critical');
    expect(plan([input('a', [normal(t), normal(t + 10 * MIN)])]).notifications[0].urgency).toBe('normal');
  });

  test('a critical event that falls just outside the window stays its own group, so urgency is not spread to a later normal one', () => {
    const t = NOW + HOUR;
    const p = plan([input('a', [normal(t), critical(t + 31 * MIN), normal(t + 45 * MIN)])]);
    expect(p.notifications.map((n) => n.urgency)).toEqual(['normal', 'critical']);
    expect(times(p)).toEqual([t, t + 31 * MIN]);
  });
});

describe('the cap', () => {
  const spread = (count: number, make: (at: number) => CareEvent = normal) =>
    Array.from({ length: count }, (_, i) => make(NOW + HOUR + i * 2 * HOUR));

  test('at most 10 notifications, the earliest ones, when they are all alike', () => {
    const p = plan([input('a', spread(15))]);
    expect(p.notifications).toHaveLength(10);
    expect(times(p)).toEqual(spread(10).map((e) => e.atMs));
    expect(p.report.droppedGroups).toBe(5);
  });

  test('normal groups are dropped before critical ones, latest first', () => {
    const events = [...spread(8, normal), critical(NOW + 40 * HOUR), critical(NOW + 41 * HOUR + 31 * MIN), normal(NOW + 50 * HOUR), normal(NOW + 52 * HOUR)];
    const p = plan([input('a', events)]);
    expect(p.notifications).toHaveLength(10);
    expect(p.notifications.filter((n) => n.urgency === 'critical')).toHaveLength(2); // both critical groups survive
    expect(times(p)).not.toContain(NOW + 52 * HOUR); // the latest normal groups went
    expect(times(p)).not.toContain(NOW + 50 * HOUR);
  });

  test('a near normal notification is kept over a far one, and the order stays chronological', () => {
    const p = plan([input('a', [...spread(12, normal)])]);
    const t = times(p);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(t[0]).toBe(NOW + HOUR);
  });

  test('more than 10 critical groups: the earliest 10 are kept', () => {
    const p = plan([input('a', spread(12, critical))]);
    expect(times(p)).toEqual(spread(10).map((e) => e.atMs));
    expect(p.notifications.every((n) => n.urgency === 'critical')).toBe(true);
  });

  test('grouping happens before the cap, so events that share a group never use two places', () => {
    const events = Array.from({ length: 30 }, (_, i) => normal(NOW + HOUR + i * MIN)); // 30 events inside 30 minutes
    expect(plan([input('a', events)]).notifications).toHaveLength(1);
  });

  test('the platform limit shrinks the cap by what is already pending, and never below zero', () => {
    const events = spread(12);
    expect(plan([input('a', events)], { otherPendingCount: 60 }).notifications).toHaveLength(4);
    expect(plan([input('a', events)], { otherPendingCount: 64 }).notifications).toEqual([]);
    expect(plan([input('a', events)], { otherPendingCount: 500 }).notifications).toEqual([]);
    expect(plan([input('a', events)], { otherPendingCount: 0, platformLimit: 5 }).notifications).toHaveLength(5);
    expect(plan([input('a', events)], { maxNotifications: 3 }).notifications).toHaveLength(3);
    expect(plan([input('a', spread(25))], { maxNotifications: 50 }).notifications).toHaveLength(10);
  });

  test('genericCap', () => {
    expect(genericCap({})).toBe(10);
    expect(genericCap({ otherPendingCount: 55 })).toBe(9);
    expect(genericCap({ otherPendingCount: 70 })).toBe(0);
    expect(genericCap({ maxNotifications: -3 })).toBe(0);
    expect(genericCap({ maxNotifications: 4, platformLimit: 100, otherPendingCount: 10 })).toBe(4);
    expect(genericCap({ maxNotifications: 50 })).toBe(10); // a ceiling, not a default
    expect(genericCap({ maxNotifications: 50, platformLimit: 1000 })).toBe(10);
    expect(genericCap({ maxNotifications: Number.NaN })).toBe(0);
  });
});

describe('what a planned notification can contain', () => {
  const secrets = ['Mia', 'Leo', 'kid-mia', 'kid-leo', 'Maximilian', 'pet-secret-1'];
  const secretInputs = () => [
    input('kid-mia', [normal(NOW + HOUR), critical(NOW + 5 * HOUR)]),
    input('kid-leo', [normal(NOW + 9 * HOUR)]),
    input('main', [normal(NOW + 12 * HOUR)]),
  ];

  test('exactly these fields, and the exact English and Spanish wording', () => {
    const en = plan(secretInputs(), { language: 'en' });
    const es = plan(secretInputs(), { language: 'es' });
    for (const n of en.notifications) {
      expect(Object.keys(n).sort()).toEqual(['atMs', 'body', 'identifier', 'title', 'urgency']);
      expect(n.title).toBe('ProductivityPet');
      expect(n.body).toBe('A pet needs care. Open ProductivityPet.');
    }
    for (const n of es.notifications) {
      expect(n.title).toBe('ProductivityPet');
      expect(n.body).toBe('Una mascota necesita cuidados. Abre ProductivityPet.');
    }
    expect(FAMILY_CARE_TITLE).toBe('ProductivityPet');
    expect(FAMILY_CARE_BODY).toEqual({ en: 'A pet needs care. Open ProductivityPet.', es: 'Una mascota necesita cuidados. Abre ProductivityPet.' });
  });

  test('the body and title are identical for normal and critical notifications (only the urgency differs)', () => {
    const p = plan(secretInputs());
    expect(p.notifications.map((n) => n.urgency)).toContain('critical');
    expect(p.notifications.map((n) => n.urgency)).toContain('normal');
    expect(new Set(p.notifications.map((n) => `${n.title}|${n.body}`)).size).toBe(1);
  });

  test('an unknown language gets English, never a blank or another profile\'s text', () => {
    for (const language of ['', 'fr', 'EN', 'undefined', 'es-MX']) expect(familyCareMessage(language).body).toBe(FAMILY_CARE_BODY.en);
    expect(familyCareMessage('es').body).toBe(FAMILY_CARE_BODY.es);
  });

  test('nothing in the notifications names a profile, child, pet or condition, and there is no data payload', () => {
    const p = plan(secretInputs());
    const text = JSON.stringify(p.notifications);
    for (const secret of secrets) expect(text).not.toContain(secret);
    // (urgency is the word "critical" in the plan object, which never reaches the phone; the shown text has no condition at all)
    for (const n of p.notifications) expect(`${n.title} ${n.body}`).not.toMatch(/sick|ill|hungry|dirty|unhappy|dying|died|critical|enferm|hambre|sucia|muri/i);
    expect(text.toLowerCase()).not.toContain('"data"');
    expect(text.toLowerCase()).not.toContain('profile');
    for (const n of p.notifications) expect(n.identifier).toMatch(/^pp-family-care-\d+$/);
  });

  test('identifiers are the prefix and a counter in time order, and the same input always gives the same plan', () => {
    const a = plan(secretInputs());
    expect(a.notifications.map((n) => n.identifier)).toEqual(a.notifications.map((_, i) => `${FAMILY_CARE_ID_PREFIX}${i}`));
    expect(plan(secretInputs())).toEqual(a);
  });

  test('the report, which does name profiles, is separate from the notifications', () => {
    const p = plan(secretInputs());
    expect(p.report.included).toEqual(['kid-mia', 'kid-leo', 'main']);
    expect(Object.keys(p).sort()).toEqual(['notifications', 'report']);
  });
});

describe('events from saved pets', () => {
  const at = new Date(T0);

  test('a healthy hatched pet: a "sick" event at the predicted moment and a "critical" one 24 hours later', () => {
    // hunger 10 at 10:00 local drains 2.5/h: it reaches 0 at 14:00 local
    const events = careEventsFromPets([pet({ p: { hunger: 10 } })], at);
    const predicted = predictSickTime(pet({ p: { hunger: 10 } }).profile, at)!.getTime();
    expect(events).toEqual([
      { atMs: predicted, urgency: 'normal' },
      { atMs: predicted + SICK_TO_CRITICAL_HOURS * HOUR, urgency: 'critical' },
    ]);
    expect(Math.abs(predicted - local(2026, 3, 10, 14).getTime())).toBeLessThan(HOUR);
  });

  test('a sick pet: a "critical" event 24 hours after it fell sick, and no "sick" event', () => {
    const sickSince = T0 - 2 * HOUR;
    const sick = pet({
      p: { hunger: 0 },
      lifecycle: { state: 'sick', exhausted: false, lastEvaluatedAt: iso(T0), sickSince: iso(sickSince) },
    });
    expect(careEventsFromPets([sick], at)).toEqual([{ atMs: sickSince + 24 * HOUR, urgency: 'critical' }]);
  });

  test('a critical pet has no upcoming event: both of its moments have passed', () => {
    const crit = pet({
      p: { hunger: 0 },
      lifecycle: { state: 'critical', exhausted: false, lastEvaluatedAt: iso(T0), sickSince: iso(T0 - 30 * HOUR), criticalSince: iso(T0 - 6 * HOUR) },
    });
    expect(careEventsFromPets([crit], at)).toEqual([]);
  });

  test('a pet that has passed away, a retired pet (Pet Pawadise) and an egg have none', () => {
    const dead = pet({ lifecycle: { state: 'deceased', exhausted: false, lastEvaluatedAt: iso(T0), diedAt: iso(T0 - DAY) } });
    const retired = pet({ retired: { since: iso(T0 - DAY) }, p: { hunger: 10 } });
    const egg = pet({ growthUnits: 0, p: { hunger: 10 } });
    expect(careEventsFromPets([dead], at)).toEqual([]);
    expect(careEventsFromPets([retired], at)).toEqual([]);
    expect(careEventsFromPets([egg], at)).toEqual([]);
  });

  test('pets are caught up first: one that fell sick while closed gets the critical event, not a stale "sick" one', () => {
    // Saved at 10:00 with hunger 10; read 20 hours later it has been sick since 14:00 (the pet's saved clock)
    const saved = pet({ p: { hunger: 10 } });
    const later = new Date(T0 + 20 * HOUR);
    const events = careEventsFromPets([saved], later);
    expect(events.every((e) => e.atMs > later.getTime() - 1)).toBe(true);
    expect(events.filter((e) => e.urgency === 'normal')).toEqual([]);
    expect(events.filter((e) => e.urgency === 'critical')).toHaveLength(1);
  });

  test('the saved pets are not changed (the work is done on copies)', () => {
    const saved = pet({ p: { hunger: 10 } });
    const before = JSON.stringify(saved);
    Object.freeze(saved);
    careEventsFromPets([saved], new Date(T0 + 30 * HOUR));
    expect(JSON.stringify(saved)).toBe(before);
  });

  test('every pet of a profile contributes', () => {
    const a = pet({ id: 'pet-a', p: { hunger: 10 } });
    const b = pet({ id: 'pet-b', p: { cleanliness: 20 } });
    expect(careEventsFromPets([a, b], at).length).toBe(4);
  });
});

describe('timing comes from the real lifecycle (Stage 4.5e)', () => {
  const at = new Date(T0);
  const hours = (e: { atMs: number }) => (e.atMs - T0) / HOUR;
  // the planner's sick moment must equal what the pet lifecycle itself records when nobody looks after the pet
  const recorded = (p: ReturnType<typeof pet>) => new Date(advancePet(p, new Date(T0 + 20 * DAY)).lifecycle.sickSince!).getTime();

  test.each([
    ['clean, happiness 20', { happiness: 20, hunger: 100, cleanliness: 100, needsBath: false }, 48],
    ['DIRTY, happiness 20', { happiness: 20, hunger: 100, cleanliness: 100, needsBath: true }, 26],
    ['clean, happiness 40', { happiness: 40, hunger: 100, cleanliness: 100, needsBath: false }, 76],
    ['DIRTY, happiness 40', { happiness: 40, hunger: 100, cleanliness: 100, needsBath: true }, 50],
    ['hungry (hunger 10, zero at 2 PM)', { hunger: 10 }, 4],
  ])('%s: the "sick" event is when the lifecycle records it, the "critical" event 24 hours later', (_name, needs, expectedHours) => {
    const p = pet({ p: needs });
    const events = careEventsFromPets([p], at);
    expect(events).toHaveLength(2);
    expect(events[0].urgency).toBe('normal');
    expect(events[1].urgency).toBe('critical');
    expect(events[0].atMs).toBe(recorded(p));
    expect(hours(events[0])).toBeCloseTo(expectedHours, 6);
    expect(events[1].atMs - events[0].atMs).toBe(24 * HOUR);
  });

  test('a dirty pet is NOT predicted as late as predictSickTime would (which ignores the dirty penalty)', () => {
    const p = pet({ p: { happiness: 20, hunger: 100, cleanliness: 100, needsBath: true } });
    const old = predictSickTime(p.profile, at)!.getTime();
    const events = careEventsFromPets([p], at);
    expect(old - events[0].atMs).toBeGreaterThanOrEqual(20 * HOUR); // the old prediction was about 22 hours late
  });

  test('for a clean pet the lifecycle and predictSickTime agree exactly (no change where nothing was wrong)', () => {
    const p = pet({ p: { hunger: 10 } });
    expect(careEventsFromPets([p], at)[0].atMs).toBe(predictSickTime(p.profile, at)!.getTime());
  });

  test('the answer depends on how the pet is now: caring for it later moves the moment (a plan is only as good as the moment it is made)', () => {
    const neglected = careEventsFromPets([pet({ p: { hunger: 10 } })], at)[0].atMs;
    const fed = careEventsFromPets([pet({ p: { hunger: 100 } })], at)[0].atMs;
    expect(fed).toBeGreaterThan(neglected + 10 * HOUR);
  });

  test('a sick pet: "critical" at exactly sickSince + 24 hours, from the saved record', () => {
    const sickSince = T0 - 5 * HOUR;
    const sick = pet({ p: { hunger: 0 }, lifecycle: { state: 'sick', exhausted: false, lastEvaluatedAt: iso(T0), sickSince: iso(sickSince) } });
    expect(careEventsFromPets([sick], at)).toEqual([{ atMs: sickSince + 24 * HOUR, urgency: 'critical' }]);
  });

  test('near-critical boundaries: one second before the moment it still counts, at the moment (already critical) nothing is left', () => {
    const make = (sickSince: number) => pet({ p: { hunger: 0 }, lifecycle: { state: 'sick', exhausted: false, lastEvaluatedAt: iso(T0), sickSince: iso(sickSince) } });
    const almost = careEventsFromPets([make(T0 - 24 * HOUR + 1000)], at); // critical in one second
    expect(almost).toEqual([{ atMs: T0 + 1000, urgency: 'critical' }]);
    expect(plan([input('a', almost)]).notifications).toEqual([]); // inside the five-second margin: dropped by the planner
    const ten = careEventsFromPets([make(T0 - 24 * HOUR + 10_000)], at);
    expect(plan([input('a', ten)]).notifications.map((n) => n.atMs)).toEqual([T0 + 10_000]); // far enough: kept
    expect(careEventsFromPets([make(T0 - 24 * HOUR)], at)).toEqual([]); // exactly 24 hours: the lifecycle already says critical
    expect(careEventsFromPets([make(T0 - 24 * HOUR - 1)], at)).toEqual([]);
  });

  test('bad saved data never throws: an invalid timestamp, a pet that cannot be worked with, an invalid "now"', () => {
    const badStamp = pet({ p: { hunger: 10, lastUpdatedAt: 'garbage' } });
    expect(() => careEventsFromPets([badStamp], at)).not.toThrow();
    const badSick = pet({ p: { hunger: 0 }, lifecycle: { state: 'sick', exhausted: false, lastEvaluatedAt: iso(T0), sickSince: 'not a date' } });
    for (const e of careEventsFromPets([badSick], at)) expect(Number.isFinite(e.atMs)).toBe(true);
    const broken = { ...pet(), profile: null } as unknown as ReturnType<typeof pet>;
    expect(() => careEventsFromPets([broken], at)).not.toThrow();
    expect(careEventsFromPets([broken, pet({ p: { hunger: 10 } })], at)).toHaveLength(2); // the good pet still counts
    expect(careEventsFromPets([pet({ p: { hunger: 10 } })], new Date(Number.NaN))).toEqual([]);
  });

  test('clock anomalies: a clock set far back cannot produce an event in the far future', () => {
    // the pet was last evaluated five days "after" the current clock: nothing is advanced, and nothing wildly late is scheduled
    const p = pet({ p: { hunger: 10, lastUpdatedAt: iso(T0 + 5 * DAY) }, lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: iso(T0 + 5 * DAY) } });
    for (const e of careEventsFromPets([p], at)) expect(e.atMs).toBeLessThanOrEqual(T0 + MAX_EVENT_AHEAD_MS);
    // and the planner drops anything beyond what the lifecycle could ever produce
    const far = plan([input('a', [normal(NOW + MAX_EVENT_AHEAD_MS), normal(NOW + MAX_EVENT_AHEAD_MS + 1)])]);
    expect(times(far)).toEqual([NOW + MAX_EVENT_AHEAD_MS]);
  });

  test('retired and egg pets still give nothing, and a profile mixes its pets', () => {
    const events = careEventsFromPets([pet({ id: 'a', p: { hunger: 10 } }), pet({ id: 'b', growthUnits: 0 }), pet({ id: 'c', retired: { since: iso(T0) } })], at);
    expect(events).toHaveLength(2);
  });
});

describe('the cap keeps the earliest group (Stage 4.5e)', () => {
  const at = (h: number) => NOW + h * HOUR;

  test('15 pets: the near "sick" warning is kept, then the earliest critical ones', () => {
    const events = Array.from({ length: 15 }, (_, i) => [normal(at((i + 1) * 3)), critical(at((i + 1) * 3 + 24))]).flat();
    const p = plan([input('a', events)]);
    expect(p.notifications).toHaveLength(10);
    expect(p.notifications[0]).toMatchObject({ atMs: at(3), urgency: 'normal' }); // not displaced
    expect(p.notifications.slice(1).every((n) => n.urgency === 'critical')).toBe(true);
    expect(p.notifications.slice(1).map((n) => n.atMs)).toEqual(Array.from({ length: 9 }, (_, i) => at((i + 1) * 3 + 24)));
  });

  test('one imminent normal alert and ten far critical ones: the imminent one stays, the latest critical one goes', () => {
    const events = [normal(at(1)), ...Array.from({ length: 10 }, (_, i) => critical(at(40 + i * 3)))];
    const p = plan([input('a', events)]);
    expect(p.notifications).toHaveLength(10);
    expect(p.notifications[0].atMs).toBe(at(1));
    expect(times(p)).not.toContain(at(40 + 9 * 3));
    expect(p.report.droppedGroups).toBe(1);
  });

  test('a cap of one keeps only the earliest; a cap of zero keeps none', () => {
    const events = [critical(at(50)), normal(at(2)), critical(at(60))];
    expect(times(plan([input('a', events)], { maxNotifications: 1 }))).toEqual([at(2)]);
    expect(plan([input('a', events)], { maxNotifications: 0 }).notifications).toEqual([]);
    expect(plan([input('a', events)], { otherPendingCount: 64 }).notifications).toEqual([]);
  });

  test('the earliest group is always in the plan whenever the plan is not empty (random plans)', () => {
    let s = 7;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let round = 0; round < 200; round += 1) {
      const events = Array.from({ length: 1 + Math.floor(rand() * 40) }, () => ({ atMs: at(1 + Math.floor(rand() * 400)), urgency: rand() < 0.5 ? ('critical' as const) : ('normal' as const) }));
      const earliest = Math.min(...events.map((e) => e.atMs));
      const p = plan([input('a', events)], { maxNotifications: 1 + Math.floor(rand() * 10), otherPendingCount: Math.floor(rand() * 60) });
      expect(p.notifications.length).toBeGreaterThan(0);
      expect(p.notifications[0].atMs).toBe(earliest);
    }
  });
});

describe('the saved alert setting', () => {
  test('only an explicit true counts, exactly like the detailed alerts', () => {
    expect(alertsEnabledFromSaved(JSON.stringify({ notifications: true, vibration: true, flash: false }))).toBe(true);
    expect(alertsEnabledFromSaved(JSON.stringify({ notifications: false }))).toBe(false);
    expect(alertsEnabledFromSaved(JSON.stringify({ notifications: 'yes' }))).toBe(false);
    expect(alertsEnabledFromSaved(JSON.stringify({ notifications: 1 }))).toBe(false);
    expect(alertsEnabledFromSaved(JSON.stringify({}))).toBe(false);
    expect(alertsEnabledFromSaved('null')).toBe(false);
    expect(alertsEnabledFromSaved('[]')).toBe(false);
    expect(alertsEnabledFromSaved('not json')).toBe(false);
    expect(alertsEnabledFromSaved('')).toBe(false);
    expect(alertsEnabledFromSaved(null)).toBe(false);
  });
});

describe('random plans keep their promises', () => {
  // A small seeded generator so a failure is reproducible.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  test('300 random families: cap, order, wording, exclusions and coverage', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rand = rng(seed);
      const pickEvents = (count: number, base: number): CareEvent[] =>
        Array.from({ length: count }, () => ({ atMs: base + Math.floor(rand() * 6 * 24 * HOUR) - 2 * HOUR, urgency: rand() < 0.35 ? 'critical' : 'normal' }));
      const FAR = 4000 * DAY; // events of excluded profiles live far from everything else, so any notification there would be a leak
      const included = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, i) => input(`kid-${i}`, pickEvents(Math.floor(rand() * 8), NOW)));
      const excluded = [
        input('arch', pickEvents(4, NOW + FAR), { archived: true }),
        input('open', pickEvents(4, NOW + FAR)),
        input('off', pickEvents(4, NOW + FAR), { alertsEnabled: false }),
        input('bad', pickEvents(4, NOW + FAR), { readable: false }),
      ];
      const cap = 1 + Math.floor(rand() * 12);
      const p = plan([...included, ...excluded], { openProfileId: 'open', maxNotifications: cap });
      const ns = p.notifications;
      expect(ns.length).toBeLessThanOrEqual(Math.min(cap, 10));
      expect(ns.every((n) => n.atMs < NOW + FAR / 2)).toBe(true); // nothing came from an excluded profile
      expect(ns.map((n) => n.atMs)).toEqual([...ns.map((n) => n.atMs)].sort((a, b) => a - b));
      expect(ns.every((n) => n.atMs > NOW + MIN_LEAD_MS)).toBe(true);
      expect(new Set(ns.map((n) => n.atMs)).size).toBe(ns.length);

      // Without a cap in the way, every usable event is covered: a notification no later than it and at most 30 minutes before.
      if (p.report.droppedGroups === 0) {
        for (const e of included.flatMap((i) => i.events).filter((e) => e.atMs > NOW + MIN_LEAD_MS)) {
          expect(ns.some((n) => n.atMs <= e.atMs && e.atMs - n.atMs <= GROUP_WINDOW_MS)).toBe(true);
          if (e.urgency === 'critical') {
            const cover = ns.filter((n) => n.atMs <= e.atMs && e.atMs - n.atMs <= GROUP_WINDOW_MS);
            expect(cover.some((n) => n.urgency === 'critical')).toBe(true);
          }
        }
      }
    }
  });
});

describe('the plan is pure', () => {
  const read = (file: string): string => require('fs').readFileSync(file, 'utf8');

  test('the plan module touches no storage, notification API, clock, timer or React', () => {
    const text = read('src/utils/family-care-plan.ts').replace(/\/\/.*$/gm, '');
    expect(text).not.toMatch(/async-storage|expo-notifications|react-native|\bAsyncStorage\b|\bNotifications\b/);
    expect(text).not.toMatch(/Date\.now\(|new Date\(\)|setTimeout|setInterval|require\(/);
    expect(text).not.toMatch(/@\/utils\/(profiles|household|pet-family'|pet-alerts|notifications)/);
  });

  test('only the notification layer uses the plan modules, and the plan modules themselves stay free of native code', () => {
    const fs = require('fs');
    const path = require('path');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry: { name: string; isDirectory(): boolean }) => {
        const full = path.join(dir, entry.name).split(path.sep).join('/');
        return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });
    const users = walk('src')
      .filter((file) => !/family-care-(plan|input)\.ts$/.test(file))
      .filter((file) => /family-care-(plan|input)/.test(read(file)))
      .sort();
    // the scheduler, the ownership classifier (reserved prefix), the foreground handler (reserved prefix) and nothing else
    expect(users).toEqual(['src/utils/family-care.ts', 'src/utils/notification-ownership.ts', 'src/utils/notifications.ts']);
  });

  test('the alert-setting key name matches the one the detailed alerts use', () => {
    const { ALERT_SETTINGS_KEY_NAME } = require('@/utils/family-care-input') as typeof import('@/utils/family-care-input');
    expect(read('src/utils/pet-alerts.ts')).toContain(`const SETTINGS_KEY_NAME = '${ALERT_SETTINGS_KEY_NAME}';`);
  });

  test('the title is not a translation key (it is fixed text), and equals the app name', () => {
    expect(familyCareMessage('en').title).toBe(familyCareMessage('es').title);
  });
});
