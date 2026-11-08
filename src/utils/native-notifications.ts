// expo-notifications, loaded the first time something is READ from it instead of when the app starts.
//
// Importing the package runs code that throws on Android in Expo Go (its push-token side effects; "removed from Expo Go with the release
// of SDK 53"), so a plain `import * as Notifications from 'expo-notifications'` at the top of a file crashes the app at launch there.
// Every native call in this app is already wrapped so that a throw means "reminders aren't available right now" (a false permission, a
// task left unscheduled, ...); this makes the load itself one of those calls. Nothing is made to look successful: the error is the
// package's own, it is thrown on every access, and the callers' existing fallbacks decide what it means.
//
// In a development or production build the require succeeds and the object is the real module, so behavior there is unchanged.
// (Kept separate from the lazy requires in family-care.ts / notification-cleanup.ts, which have their own test hooks and ownership rules.)

type NativeNotifications = typeof import('expo-notifications');

let loaded: NativeNotifications | null = null;
let failure: { error: unknown } | null = null;

function load(): NativeNotifications {
  if (loaded) return loaded;
  if (failure) throw failure.error; // the module does not load here: do not run (and fail) its load again
  try {
    loaded = require('expo-notifications') as NativeNotifications;
    return loaded;
  } catch (error) {
    failure = { error };
    throw error;
  }
}

// Reading any property (`Notifications.scheduleNotificationAsync`, `Notifications.AndroidImportance`, ...) loads the module; if it cannot
// load, the read throws, which every use in notifications.ts and pet-alerts.ts already sits inside a try/catch for.
export const Notifications: NativeNotifications = new Proxy({} as NativeNotifications, {
  get: (_target, property) => (load() as unknown as Record<PropertyKey, unknown>)[property],
});

// For tests.
export function resetNativeNotificationsForTests(): void {
  loaded = null;
  failure = null;
}
