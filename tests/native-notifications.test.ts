const fs = require('fs');
const path = require('path');

import { T0, freezeClock, unfreezeClock } from './helpers';

// Expo Go on Android: importing expo-notifications THROWS there (its push-token side effects), which used to crash the app at launch
// because two files imported it at the top. It is now loaded the first time something is read from it (src/utils/native-notifications.ts),
// so the throw lands inside the try/catch every native call already has. These tests check: the app's modules load when the package
// throws, the fallbacks are the honest ones (never "success"), the failure is not retried noisily, and a package that loads behaves as before.

const EXPO_GO_ERROR =
  'expo-notifications: Android Push notifications (remote notifications) functionality provided by expo-notifications was removed from Expo Go with the release of SDK 53. Use a development build instead of Expo Go.';

const task = {
  id: 't1',
  text: 'Walk',
  category: 'Personal',
  important: false,
  kind: 'task',
  date: '2026-03-11',
  completed: false,
  time: '09:00',
  reminderMinutesBefore: 30,
} as never;

beforeEach(() => {
  jest.resetModules();
  freezeClock(T0);
});
afterEach(() => unfreezeClock());

// Mocks expo-notifications as a package that throws when it is loaded, and counts how often that is attempted.
function mockThrowingPackage() {
  const attempts = { count: 0 };
  jest.doMock('expo-notifications', () => {
    attempts.count += 1;
    throw new Error(EXPO_GO_ERROR);
  });
  return attempts;
}

function mockWorkingPackage(over: Record<string, unknown> = {}) {
  const api = {
    scheduleNotificationAsync: jest.fn(async () => 'id-1'),
    cancelScheduledNotificationAsync: jest.fn(async () => undefined),
    getPermissionsAsync: jest.fn(async () => ({ granted: true })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setNotificationChannelAsync: jest.fn(async () => undefined),
    setNotificationHandler: jest.fn(),
    getPresentedNotificationsAsync: jest.fn(async () => []),
    dismissNotificationAsync: jest.fn(async () => undefined),
    SchedulableTriggerInputTypes: { DATE: 'date' },
    AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
    AndroidNotificationPriority: { MAX: 'max' },
    ...over,
  };
  jest.doMock('expo-notifications', () => api);
  return api;
}

describe('expo-notifications cannot load (Expo Go on Android)', () => {
  it('loading the notification modules does not throw and does not touch the package', () => {
    const attempts = mockThrowingPackage();
    expect(() => require('@/utils/notifications')).not.toThrow();
    expect(() => require('@/utils/pet-alerts')).not.toThrow();
    expect(() => require('@/utils/native-notifications')).not.toThrow();
    expect(attempts.count).toBe(0); // nothing reads it at load time
  });

  it('reading anything from it throws the package\'s own error, and the load is attempted only once', () => {
    const attempts = mockThrowingPackage();
    const { Notifications } = require('@/utils/native-notifications') as typeof import('@/utils/native-notifications');
    expect(() => Notifications.scheduleNotificationAsync).toThrow(/removed from Expo Go/);
    expect(() => Notifications.AndroidImportance).toThrow(/removed from Expo Go/);
    expect(() => Notifications.getPermissionsAsync).toThrow(/removed from Expo Go/);
    expect(attempts.count).toBe(1);
  });

  it('permission is reported as NOT granted, never as granted', async () => {
    mockThrowingPackage();
    const { ensureNotificationPermission } = require('@/utils/notifications') as typeof import('@/utils/notifications');
    await expect(ensureNotificationPermission()).resolves.toBe(false);
  });

  it('the foreground handler registration does not throw', () => {
    mockThrowingPackage();
    const { ensureNotificationHandler } = require('@/utils/notifications') as typeof import('@/utils/notifications');
    expect(() => ensureNotificationHandler()).not.toThrow();
  });

  it('a task reminder is not scheduled, and the task comes back unchanged (no invented id)', async () => {
    mockThrowingPackage();
    const { syncTaskNotifications } = require('@/utils/notifications') as typeof import('@/utils/notifications');
    const result = await syncTaskNotifications([task]);
    expect(result[0].scheduledNotificationId).toBeUndefined();
  });

  it('cancelling a reminder does not throw', async () => {
    mockThrowingPackage();
    const { cancelTaskNotification } = require('@/utils/notifications') as typeof import('@/utils/notifications');
    await expect(cancelTaskNotification({ ...(task as object), scheduledNotificationId: 'x' } as never)).resolves.toBeUndefined();
  });

  it('the test notification reports failure, and pet alert syncing finishes without an unhandled error', async () => {
    mockThrowingPackage();
    const alerts = require('@/utils/pet-alerts') as typeof import('@/utils/pet-alerts');
    await expect(alerts.sendTestNotification()).resolves.toBe(false);
    await expect(alerts.setNotificationsEnabled(true)).resolves.toBe(false); // the setting is not turned on
    await expect(alerts.syncPetAlerts()).resolves.toBeUndefined();
  });
});

describe('expo-notifications loads (development and production builds)', () => {
  it('passes every read and call straight through to the real package', async () => {
    const api = mockWorkingPackage();
    const { Notifications } = require('@/utils/native-notifications') as typeof import('@/utils/native-notifications');
    expect(Notifications.scheduleNotificationAsync).toBe(api.scheduleNotificationAsync);
    expect(Notifications.AndroidImportance).toBe(api.AndroidImportance);
    expect(Notifications.SchedulableTriggerInputTypes.DATE).toBe('date');
  });

  it('permission is granted and a task reminder is scheduled with the id the phone returned', async () => {
    const api = mockWorkingPackage();
    const { ensureNotificationPermission, syncTaskNotifications } = require('@/utils/notifications') as typeof import('@/utils/notifications');
    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(api.setNotificationHandler).toHaveBeenCalledTimes(1);
    const result = await syncTaskNotifications([task]);
    expect(api.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(result[0].scheduledNotificationId).toBe('id-1');
  });

  it('a refused permission is reported as refused', async () => {
    mockWorkingPackage({
      getPermissionsAsync: jest.fn(async () => ({ granted: false })),
      requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
    });
    const { ensureNotificationPermission } = require('@/utils/notifications') as typeof import('@/utils/notifications');
    await expect(ensureNotificationPermission()).resolves.toBe(false);
  });

  it('an unexpected native failure is not treated as success', async () => {
    mockWorkingPackage({
      scheduleNotificationAsync: jest.fn(async () => {
        throw new Error('native failure');
      }),
    });
    const { syncTaskNotifications } = require('@/utils/notifications') as typeof import('@/utils/notifications');
    const alerts = require('@/utils/pet-alerts') as typeof import('@/utils/pet-alerts');
    const result = await syncTaskNotifications([task]);
    expect(result[0].scheduledNotificationId).toBeUndefined();
    await expect(alerts.sendTestNotification()).resolves.toBe(false);
  });

  it('the test notification is sent when the package works', async () => {
    const api = mockWorkingPackage();
    const alerts = require('@/utils/pet-alerts') as typeof import('@/utils/pet-alerts');
    await expect(alerts.sendTestNotification()).resolves.toBe(true);
    expect(api.scheduleNotificationAsync).toHaveBeenCalled();
  });
});

describe('static check', () => {
  const SRC = path.resolve('src');
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry: { name: string; isDirectory: () => boolean }) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });

  it('no source file imports expo-notifications at the top of the file (it would crash Expo Go on Android at launch)', () => {
    const offenders = walk(SRC).filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return /^\s*import\s[^;]*from\s+['"]expo-notifications['"]/m.test(text) || /^\s*export\s[^;]*from\s+['"]expo-notifications['"]/m.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('the only value-level loads of expo-notifications are lazy requires', () => {
    const files = walk(SRC).filter((file: string) => /require\(['"]expo-notifications['"]\)/.test(fs.readFileSync(file, 'utf8')));
    expect(files.map((f: string) => path.basename(f)).sort()).toEqual(['family-care.ts', 'native-notifications.ts', 'notification-cleanup.ts', 'profiles.ts']);
  });
});
