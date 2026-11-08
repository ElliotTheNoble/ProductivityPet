import { LANGUAGES, translate } from '@/i18n';
import { FAMILY_CARE_ID_PREFIX } from '@/utils/family-care-plan';
import { classifyNotification, isPrivateClass, legacyTaskTitles, type NotificationLike } from '@/utils/notification-ownership';

// Stage 4.5e: who owns a notification. The private clean-up cancels ONLY what is positively identified here, so every ambiguous case
// has to come out as "unknown" (never touched), not as private.

const scheduled = (over: Partial<NotificationLike> = {}): NotificationLike => ({
  identifier: 'abc-123',
  content: { title: 'Something', body: 'Body', data: {} },
  trigger: { type: 'date' },
  ...over,
});
const withContent = (content: NotificationLike['content'], extra: Partial<NotificationLike> = {}) => scheduled({ content, ...extra });

describe('tagged notifications', () => {
  test('a task reminder tagged pp:task is a private task reminder, whatever its text', () => {
    expect(classifyNotification(withContent({ title: 'anything', body: "Mia's task", data: { pp: 'task' } }))).toBe('task-reminder');
  });

  test('a pet alert carries petId and a kind of sick or critical; any other kind is not recognised', () => {
    expect(classifyNotification(withContent({ title: 't', body: 'b', data: { petId: 'pet-1', kind: 'sick' } }))).toBe('pet-alert');
    expect(classifyNotification(withContent({ title: 't', body: 'b', data: { petId: 'pet-1', kind: 'critical' } }))).toBe('pet-alert');
    expect(classifyNotification(withContent({ title: 't', body: 'b', data: { petId: 'pet-1', kind: 'other' } }))).toBe('unknown');
    expect(classifyNotification(withContent({ title: 't', body: 'b', data: { petId: 7, kind: 'sick' } }))).toBe('unknown');
    expect(classifyNotification(withContent({ title: 't', body: 'b', data: { petId: 'pet-1' } }))).toBe('unknown');
  });

  test('the test notification is tagged pp:test and is never private', () => {
    expect(classifyNotification(withContent({ title: 'T', body: 'B', data: { pp: 'test' } }))).toBe('test');
    expect(isPrivateClass('test')).toBe(false);
  });

  test('data with anything else in it is unknown, even next to a recognised key', () => {
    expect(classifyNotification(withContent({ title: 'Task reminder', body: 'b', data: { url: '/somewhere' } }))).toBe('unknown');
    expect(classifyNotification(withContent({ title: 't', body: 'b', data: { pp: 'something-new' } }))).toBe('unknown');
    expect(classifyNotification(withContent({ title: 't', body: 'b', data: [] as unknown as Record<string, unknown> }))).toBe('unknown');
  });
});

describe('family-care notifications', () => {
  test('the reserved prefix with no data is family-care', () => {
    expect(classifyNotification(scheduled({ identifier: `${FAMILY_CARE_ID_PREFIX}0`, content: { title: 'ProductivityPet', body: 'x', data: {} } }))).toBe('family-care');
    expect(classifyNotification(scheduled({ identifier: `${FAMILY_CARE_ID_PREFIX}9`, content: { title: 'ProductivityPet', body: 'x' } }))).toBe('family-care');
    expect(isPrivateClass('family-care')).toBe(false);
  });

  test('the reserved prefix WITH data is unknown: nothing the app creates looks like that, so it is not touched', () => {
    expect(classifyNotification(scheduled({ identifier: `${FAMILY_CARE_ID_PREFIX}0`, content: { title: 'x', body: 'y', data: { petId: 'p', kind: 'sick' } } }))).toBe('unknown');
    expect(classifyNotification(scheduled({ identifier: `${FAMILY_CARE_ID_PREFIX}0`, content: { title: 'x', body: 'y', data: { pp: 'task' } } }))).toBe('unknown');
  });

  test('a lookalike prefix is not family-care', () => {
    expect(classifyNotification(scheduled({ identifier: 'pp-family-cars-0' }))).toBe('unknown');
    expect(classifyNotification(scheduled({ identifier: `x${FAMILY_CARE_ID_PREFIX}0` }))).toBe('unknown');
  });
});

describe('older task reminders (no tag)', () => {
  const types = ['ntTask', 'ntAppointment', 'ntBirthday'] as const;

  test.each(LANGUAGES.map((l) => l.code))('every reminder title in "%s" is recognised, for every notification type', (code) => {
    for (const key of types) {
      const title = translate(code, key);
      expect([code, key, classifyNotification(withContent({ title, body: 'Buy milk', data: {} }))]).toEqual([code, key, 'legacy-task-reminder']);
      // the phone may report no data at all instead of an empty object
      expect(classifyNotification(withContent({ title, body: 'Buy milk' }))).toBe('legacy-task-reminder');
    }
  });

  test('is private, so the clean-up cancels it', () => {
    expect(isPrivateClass('legacy-task-reminder')).toBe(true);
    expect(isPrivateClass('task-reminder')).toBe(true);
    expect(isPrivateClass('pet-alert')).toBe(true);
    expect(isPrivateClass('unknown')).toBe(false);
  });

  test('the title must match EXACTLY: other case, extra words or whitespace are unknown', () => {
    for (const title of ['task reminder', 'Task reminder!', ' Task reminder', 'Task reminder ', 'Task', 'Reminder', 'Task Reminder']) {
      expect([title, classifyNotification(withContent({ title, body: 'b', data: {} }))]).toEqual([title, 'unknown']);
    }
  });

  test('it must be a scheduled (date) notification: no trigger or another trigger kind is unknown', () => {
    const title = translate('en', 'ntTask');
    expect(classifyNotification(withContent({ title, body: 'b', data: {} }, { trigger: null }))).toBe('unknown');
    expect(classifyNotification(withContent({ title, body: 'b', data: {} }, { trigger: { type: 'timeInterval' } }))).toBe('unknown');
    expect(classifyNotification(withContent({ title, body: 'b', data: {} }, { trigger: undefined }))).toBe('unknown');
  });

  test('the reminder titles cannot be confused with any other notification text of the app', () => {
    const titles = legacyTaskTitles();
    expect(titles.size).toBe(LANGUAGES.length * 3);
    const others: string[] = [];
    for (const { code } of LANGUAGES) {
      for (const key of ['ntSickTitle', 'ntSickBody', 'ntCritTitle', 'ntCritBody', 'ntTestTitle', 'ntTestBody', 'ntChReminders'] as const) {
        others.push(translate(code, key, { pet: 'Kitty', care: 'food' }));
      }
    }
    for (const text of others) expect(titles.has(text)).toBe(false);
    expect(titles.has('ProductivityPet')).toBe(false); // nor the family-care title
  });

  test('the older test notification is recognised by its exact title AND body, and nothing else', () => {
    for (const { code } of LANGUAGES) {
      expect(classifyNotification(withContent({ title: translate(code, 'ntTestTitle'), body: translate(code, 'ntTestBody'), data: {} }, { trigger: null }))).toBe('test');
    }
    expect(classifyNotification(withContent({ title: translate('en', 'ntTestTitle'), body: 'something else', data: {} }))).toBe('unknown');
    expect(classifyNotification(withContent({ title: 'x', body: translate('en', 'ntTestBody'), data: {} }))).toBe('unknown');
  });
});

describe('everything else', () => {
  test('unknown: no tag, no recognised title', () => {
    expect(classifyNotification(scheduled())).toBe('unknown');
    expect(classifyNotification({})).toBe('unknown');
    expect(classifyNotification({ identifier: undefined, content: null })).toBe('unknown');
    expect(classifyNotification({ identifier: 'x', content: { title: null, body: null, data: null } })).toBe('unknown');
  });

  test('never throws on odd input', () => {
    for (const odd of [{ content: { title: 5 as unknown as string } }, { identifier: 7 as unknown as string }, { content: { data: 'text' } }, { trigger: { type: null } }]) {
      expect(() => classifyNotification(odd as NotificationLike)).not.toThrow();
    }
  });
});
