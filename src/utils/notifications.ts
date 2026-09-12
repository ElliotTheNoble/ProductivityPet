import * as Notifications from 'expo-notifications';

import { addDaysISO, isOccurrenceCompleted, occursOnDate, todayISO, type Task } from '@/utils/tasks';

const CHANNEL_ID = 'task-reminders';

// How many days ahead the rolling scheduler will look for a repeating
// task's next occurrence — far more than any realistic weekly gap, so it
// only fails to find one when the series has genuinely ended (repeatUntil
// reached, or excluded/completed for every remaining candidate in range).
const SCAN_HORIZON_DAYS = 400;

// expo-notifications' Android functionality is unavailable in Expo Go
// (removed starting SDK 53 — it throws a descriptive error the moment any
// scheduling/permission call is made there) but works normally in a
// development or production build. Rather than trying to detect which
// runtime we're in (Expo Go and a dev-client build report the same
// Constants.executionEnvironment value, so that check can't tell them
// apart), every actual native call below is wrapped so a throw there is
// treated as "reminders aren't available right now" instead of crashing
// the app — the feature still fully works wherever the native module does.
let handlerRegistered = false;

// Notifications should still show while the app is open, not just in the
// background — reminders are meant to be seen wherever the user is.
function ensureHandlerRegistered() {
  if (handlerRegistered) return;
  handlerRegistered = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Notifications unsupported in this runtime (e.g. Expo Go on Android).
  }
}

let channelReady = false;
async function ensureAndroidChannel() {
  if (channelReady) return;
  channelReady = true;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Task & appointment reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  } catch {
    // Notifications unsupported in this runtime (e.g. Expo Go on Android).
  }
}

// Requests notification permission — call this only at the moment a user
// actually picks a reminder option other than "None", never on app launch.
// Returns whether reminders can actually be scheduled; false (rather than
// throwing) whenever the native module isn't usable in this runtime.
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    ensureHandlerRegistered();
    await ensureAndroidChannel();
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

// Parses the free-text time field used throughout the app (e.g. "3:00 PM",
// "15:00", "3:00pm"). Returns null for anything it can't confidently read,
// so an unparseable time simply doesn't get a reminder scheduled instead of
// scheduling at the wrong time.
function parseTimeOfDay(time: string): { hour: number; minute: number } | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const meridiem = match[3]?.toLowerCase();
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) return null;

  if (meridiem === 'am') {
    if (hour === 12) hour = 0;
  } else if (meridiem === 'pm') {
    if (hour !== 12) hour += 12;
  }
  if (hour > 23) return null;

  return { hour, minute };
}

// Finds the soonest date (today or later, within SCAN_HORIZON_DAYS) on
// which `task` actually occurs, isn't already completed for that date, and
// whose computed reminder trigger time is still in the future. Reuses
// occursOnDate/isOccurrenceCompleted exactly as the rest of the app does, so
// Stop Repeating, Remove Just This Day, and completion are automatically
// respected without duplicating any of that logic here.
function findNextTrigger(task: Task, now: Date): { dateISO: string; triggerDate: Date } | null {
  if (task.reminderMinutesBefore === undefined || !task.time) return null;
  const parsed = parseTimeOfDay(task.time);
  if (!parsed) return null;

  let candidate = todayISO();
  for (let i = 0; i <= SCAN_HORIZON_DAYS; i++) {
    if (occursOnDate(task, candidate) && !isOccurrenceCompleted(task, candidate)) {
      const [year, month, day] = candidate.split('-').map(Number);
      const triggerDate = new Date(year, month - 1, day, parsed.hour, parsed.minute, 0, 0);
      triggerDate.setMinutes(triggerDate.getMinutes() - task.reminderMinutesBefore);
      if (triggerDate.getTime() > now.getTime()) {
        return { dateISO: candidate, triggerDate };
      }
    }
    candidate = addDaysISO(candidate, 1);
  }
  return null;
}

async function cancelIfScheduled(task: Task): Promise<void> {
  if (!task.scheduledNotificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(task.scheduledNotificationId);
  } catch {
    // Already fired or already cancelled — nothing left to clean up.
  }
}

// Cancels a task/appointment's scheduled reminder, if any. Call this
// explicitly whenever a record is fully deleted: full deletion removes the
// item from the array syncTaskNotifications() reconciles against, so it's
// the one case that pass can't clean up on its own.
export async function cancelTaskNotification(task: Task): Promise<void> {
  await cancelIfScheduled(task);
}

// Reconciles every task/appointment's reminder against its current
// date/time/repeat/completion state, scheduling at most one upcoming
// notification per item (the next valid occurrence) and cancelling
// anything stale. Returns the SAME array reference when nothing needed to
// change, so callers can skip re-saving state and avoid a re-render loop.
// Every field besides scheduledNotificationId/scheduledNotificationFor is
// passed through untouched — history, pet progress, Important status, etc.
// are never affected by this pass.
export async function syncTaskNotifications(tasks: Task[]): Promise<Task[]> {
  const now = new Date();
  let changed = false;

  const updated = await Promise.all(
    tasks.map(async (task) => {
      if (task.reminderMinutesBefore === undefined) {
        if (task.scheduledNotificationId) {
          await cancelIfScheduled(task);
          changed = true;
          return { ...task, scheduledNotificationId: undefined, scheduledNotificationFor: undefined };
        }
        return task;
      }

      const next = findNextTrigger(task, now);

      if (!next) {
        if (task.scheduledNotificationId) {
          await cancelIfScheduled(task);
          changed = true;
          return { ...task, scheduledNotificationId: undefined, scheduledNotificationFor: undefined };
        }
        return task;
      }

      if (task.scheduledNotificationId && task.scheduledNotificationFor === next.dateISO) {
        // Already correctly scheduled for this occurrence — nothing to do.
        return task;
      }

      await cancelIfScheduled(task);
      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: task.kind === 'event' ? 'Appointment reminder' : 'Task reminder',
            body: task.text,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: next.triggerDate,
          },
        });
        changed = true;
        return { ...task, scheduledNotificationId: id, scheduledNotificationFor: next.dateISO };
      } catch {
        // Notifications unsupported in this runtime (e.g. Expo Go on
        // Android) — leave the task as-is rather than crashing the sync.
        return task;
      }
    })
  );

  return changed ? updated : tasks;
}
