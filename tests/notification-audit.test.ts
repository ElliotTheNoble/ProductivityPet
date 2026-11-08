// Stage 4.5e: a static audit of every place the app creates, cancels or reacts to a notification. A NEW scheduling site, a new way of
// cancelling "everything", or a notification-tap handler fails here until someone classifies it (see @/utils/notification-ownership.ts).

const fs = require('fs');
const path = require('path');

const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8');
function files(dir: string): string[] {
  return fs
    .readdirSync(path.resolve(dir), { withFileTypes: true })
    .flatMap((entry: { name: string; isDirectory(): boolean }) => {
      const rel = `${dir}/${entry.name}`;
      return entry.isDirectory() ? files(rel) : /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
    })
    .sort();
}
const SOURCES = files('src');
const code = (rel: string) => read(rel).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const withText = (pattern: RegExp) => SOURCES.filter((file) => pattern.test(code(file)));

describe('every notification the app can schedule is classified', () => {
  const sites = withText(/scheduleNotificationAsync\s*\(/);

  test('exactly these files schedule notifications, and the number of sites in each is known', () => {
    expect(sites).toEqual(['src/utils/family-care.ts', 'src/utils/notifications.ts', 'src/utils/pet-alerts.ts']);
    const count = (file: string) => (code(file).match(/scheduleNotificationAsync\s*\(/g) ?? []).length;
    expect(count('src/utils/notifications.ts')).toBe(1); // task, appointment and birthday reminders
    expect(count('src/utils/pet-alerts.ts')).toBe(3); // scheduled pet alert, immediate pet alert, test notification
    expect(count('src/utils/family-care.ts')).toBe(1); // anonymous family-care reminders
  });

  test('task reminders carry the task tag, in family mode only (with it off the reminder is exactly what it always was)', () => {
    expect(code('src/utils/notifications.ts')).toMatch(/\.\.\.\(FAMILY_MODE_ENABLED \? \{ data: \{ pp: 'task' \} \} : null\)/);
  });

  test('pet alerts (scheduled and immediate) carry petId and kind, and the test notification carries its tag', () => {
    const text = code('src/utils/pet-alerts.ts');
    expect(text).toMatch(/data:\s*\{\s*petId:\s*pet\.id,\s*kind\s*\}/);
    expect(text).toMatch(/\.\.\.\(FAMILY_MODE_ENABLED \? \{ data: \{ pp: 'test' \} \} : null\)/);
  });

  test('family-care reminders are scheduled with a reserved identifier and with ONLY a title and a body', () => {
    const text = code('src/utils/family-care.ts');
    const call = text.slice(text.indexOf('N.scheduleNotificationAsync('));
    const content = call.slice(call.indexOf('content:'), call.indexOf('trigger:'));
    expect(content.replace(/\s+/g, ' ').trim()).toBe('content: { title: planned.title, body: planned.body },');
    expect(call.slice(0, call.indexOf('trigger:'))).toMatch(/identifier:\s*planned\.identifier/);
    expect(text).not.toMatch(/\bdata:/);
    expect(text).not.toMatch(/subtitle|sound:|badge/);
  });

  test('the reserved family-care prefix is only used by the code that owns it', () => {
    const users = withText(/FAMILY_CARE_ID_PREFIX|pp-family-care-/);
    expect(users).toEqual(['src/utils/family-care-plan.ts', 'src/utils/family-care.ts', 'src/utils/notification-ownership.ts', 'src/utils/notifications.ts']);
  });
});

describe('nothing cancels or dismisses "everything" except the old family-mode-off path', () => {
  test('cancel-all and dismiss-all appear only in profiles.ts, after the family-mode branch has returned', () => {
    expect(withText(/cancelAllScheduledNotificationsAsync|dismissAllNotificationsAsync/)).toEqual(['src/utils/profiles.ts']);
    const text = code('src/utils/profiles.ts');
    const branch = text.indexOf('if (FAMILY_MODE_ENABLED) {');
    const old = text.indexOf('cancelAllScheduledNotificationsAsync');
    expect(branch).toBeGreaterThan(-1);
    expect(old).toBeGreaterThan(branch);
    expect(text.slice(branch, old)).toMatch(/cleanPrivateNotifications\(\);\s*return;\s*\}/);
  });

  test('the checked clean-up cancels one notification at a time, by identifier, from a classified list', () => {
    const text = code('src/utils/notification-cleanup.ts');
    expect(text).not.toMatch(/cancelAllScheduledNotificationsAsync|dismissAllNotificationsAsync/);
    expect(text).toMatch(/isPrivateClass\(classifyNotification\(item\)\)/);
    expect(text).toMatch(/cancelScheduledNotificationAsync\(String\(item\.identifier\)\)/);
    expect(text).toMatch(/dismissNotificationAsync\(String\(item\.request\.identifier\)\)/);
  });

  test('the family-care scheduler cancels only identifiers that are positively family-care or its own fixed names', () => {
    const text = code('src/utils/family-care.ts');
    expect(text).not.toMatch(/cancelAllScheduledNotificationsAsync|dismissAllNotificationsAsync/);
    expect(text).toMatch(/entry\.kind === 'family-care'/);
    expect(text).toMatch(/`\$\{FAMILY_CARE_ID_PREFIX\}\$\{i\}`/);
  });
});

describe('notification taps', () => {
  test('there is no handler for a tap anywhere: nothing can open a profile, a route or the parent area from a notification', () => {
    expect(withText(/addNotificationResponseReceivedListener|useLastNotificationResponse|getLastNotificationResponse|addNotificationReceivedListener|NotificationResponse/)).toEqual([]);
  });

  test('family-care reminders have no data to act on, and nothing reads notification data to navigate', () => {
    // (pet-alerts.ts reads petId from the tray only to dismiss that pet's own alert after recovery; it navigates nowhere)
    expect(withText(/request\.content\.data|content\.data/)).toEqual(['src/utils/pet-alerts.ts']);
    expect(withText(/Linking\.(addEventListener|getInitialURL)/).length).toBe(0);
  });
});

describe('Android channels', () => {
  test('both family-care channels are private on the lock screen, and the detailed-alert channels are untouched (a recorded pre-release review item)', () => {
    const care = code('src/utils/family-care.ts');
    expect((care.match(/lockscreenVisibility:\s*N\.AndroidNotificationVisibility\.PRIVATE/g) ?? []).length).toBe(2);
    expect(care).toMatch(/FAMILY_CARE_CHANNEL = 'pp-family-care'/);
    expect(care).toMatch(/FAMILY_CARE_URGENT_CHANNEL = 'pp-family-care-urgent'/);
    expect(code('src/utils/pet-alerts.ts')).not.toMatch(/lockscreenVisibility/); // BUG-072: pre-release review
  });
});

describe('the parent-only warning', () => {
  test('the clean-up warning component is used only on the Parent dashboard, never in a child-facing screen', () => {
    const users = withText(/NotificationCleanupNotice/).filter((file) => file !== 'src/components/notification-cleanup-notice.tsx');
    expect(users).toEqual(['src/components/parent-dashboard.tsx']);
    expect(withText(/useCleanupSnapshot/).filter((file) => file !== 'src/utils/notification-cleanup.ts')).toEqual(['src/components/notification-cleanup-notice.tsx']);
  });

  test('the parent dashboard sits behind the Parent Gate', () => {
    expect(code('src/app/parent.tsx')).toMatch(/<ParentGate>/);
  });
});
