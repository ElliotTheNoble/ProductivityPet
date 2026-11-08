import { Platform } from 'react-native';

import { getCurrentLanguage } from '@/i18n';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { readFamilyCareInputs } from '@/utils/family-care-input';
import { FAMILY_CARE_ID_PREFIX, MAX_GENERIC_NOTIFICATIONS, buildFamilyCarePlan, type ProfileCareInput } from '@/utils/family-care-plan';
import { getCleanupSnapshot } from '@/utils/notification-cleanup';
import { classifyNotification, type NotificationLike } from '@/utils/notification-ownership';
import { getNotificationEpoch, getActiveProfileId, whenProfileCleanupDone } from '@/utils/profiles';

// The anonymous family-care reminders on the phone (Stage 4.5e, family mode only, native only). ONE function decides everything:
// syncFamilyCare() works out the plan (see @/utils/family-care-plan.ts), removes the family-care reminders that are there, and schedules
// the new ones. It only ever touches notifications of its own kind: identifiers start with FAMILY_CARE_ID_PREFIX and carry no data, and
// it cancels only notifications that are positively classified as family-care (never anything else, never "all").
//
// What a family-care reminder contains: the fixed title and body of the plan, nothing else. No `data`, no subtitle, no sound override.
// On Android it uses one of two channels created here, both with lock-screen visibility PRIVATE (the lock screen shows that
// ProductivityPet has a notification, and hides the content). A channel's settings cannot be changed after it exists, so these are NEW
// channels; the existing detailed-alert channels are left as they are (a pre-release review item, see BUG-072).
//
// When it does nothing: family mode off, the web, no notification permission (it never asks), or the private clean-up of the profile that
// was just left is not VERIFIED (unverified, unsupported, running or never run: nothing new is scheduled while a private reminder may
// still be on the phone; it runs again when the clean-up becomes verified). Failures never throw and never touch a profile switch; they leave a status (getFamilyCareStatus) and the next
// trigger tries again. Guards against stale runs: every step checks that no newer run started, that no profile swap happened and that
// the profile in use is the same; a stale run stops and a fresh one is made.

export const FAMILY_CARE_CHANNEL = 'pp-family-care';
export const FAMILY_CARE_URGENT_CHANNEL = 'pp-family-care-urgent';
export const CALL_DEADLINE_MS = 4000;

export const FAMILY_CARE_CHANNEL_NAMES = {
  normal: { en: 'Pet care reminders', es: 'Recordatorios de cuidado de mascotas' },
  urgent: { en: 'Urgent pet care reminders', es: 'Recordatorios urgentes de cuidado de mascotas' },
} as const;

export type FamilyCareResult = {
  status: 'scheduled' | 'skipped' | 'degraded';
  scheduled: number;
  reason: string | null;
};

type Native = typeof import('expo-notifications');

type Overrides = {
  native?: Native | null;
  inputs?: () => Promise<ProfileCareInput[]>;
  openProfileId?: () => string | null;
  now?: () => number;
};
let overrides: Overrides = {};

function native(): Native | null {
  if (overrides.native !== undefined) return overrides.native;
  try {
    return require('expo-notifications') as Native;
  } catch {
    return null;
  }
}

function enabled(): boolean {
  return FAMILY_MODE_ENABLED && Platform.OS !== 'web';
}

// The profile in use right now, or null when nobody has chosen one (the picker is showing).
function openProfileId(): string | null {
  if (overrides.openProfileId) return overrides.openProfileId();
  try {
    const { hasChosenProfile } = require('@/utils/family-session') as typeof import('@/utils/family-session');
    return hasChosenProfile() ? getActiveProfileId() : null;
  } catch {
    return null;
  }
}

function deadline<T>(work: Promise<T>, ms = CALL_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('deadline')), ms);
  });
  return Promise.race([work, late]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

let status: FamilyCareResult = { status: 'skipped', scheduled: 0, reason: 'not-run' };
export function getFamilyCareStatus(): FamilyCareResult {
  return status;
}

let token = 0;
let flight: Promise<FamilyCareResult> | null = null;
let again = false;

// Brings the family-care reminders up to date. Runs one at a time; a request made while one is running makes it run once more.
export function syncFamilyCare(): Promise<FamilyCareResult> {
  if (!enabled()) return Promise.resolve({ status: 'skipped', scheduled: 0, reason: 'disabled' });
  if (flight) {
    again = true;
    return flight;
  }
  flight = (async () => {
    let result: FamilyCareResult;
    do {
      again = false;
      try {
        result = await runOnce();
      } catch {
        result = { status: 'degraded', scheduled: 0, reason: 'unexpected-error' };
      }
      status = result;
    } while (again);
    return result;
  })().finally(() => {
    flight = null;
  });
  return flight;
}

async function runOnce(): Promise<FamilyCareResult> {
  const N = native();
  if (!N) return { status: 'skipped', scheduled: 0, reason: 'unsupported' };

  // Not before the clean-up of the profile that was just left has finished: it lists and cancels, and must not see half of this.
  await whenProfileCleanupDone();
  // Only a VERIFIED clean-up allows anything new: not unverified, not unsupported, not running, not "never run".
  if (getCleanupSnapshot().state !== 'verified') return { status: 'skipped', scheduled: 0, reason: 'cleanup-not-verified' };

  const mine = ++token;
  const epoch = getNotificationEpoch();
  const open = openProfileId();
  const stale = () => {
    const isStale = mine !== token || epoch !== getNotificationEpoch() || open !== openProfileId();
    if (isStale) again = true; // the change that made this stale asks for a fresh run; make sure one happens
    return isStale;
  };

  // Permission is only looked at, never asked for here.
  try {
    const permission = await deadline(N.getPermissionsAsync());
    if (!permission.granted) {
      await cancelOwn(N, null);
      return { status: 'skipped', scheduled: 0, reason: 'no-permission' };
    }
  } catch {
    return { status: 'degraded', scheduled: 0, reason: 'permission-unknown' };
  }
  if (stale()) return { status: 'skipped', scheduled: 0, reason: 'stale' };

  // What is on the phone now: ours to replace, and how many others use up the platform's limit.
  let listed: NotificationLike[] | null = null;
  try {
    listed = (await deadline(N.getAllScheduledNotificationsAsync())) as NotificationLike[];
  } catch {
    listed = null;
  }
  const classes = listed ? listed.map((item) => ({ item, kind: classifyNotification(item) })) : null;
  const own = classes ? classes.filter((entry) => entry.kind === 'family-care').map((entry) => String(entry.item.identifier)) : null;
  // A notification that has one of OUR names but is not ours (it carries data): scheduling with that name would silently replace it.
  // Its name is left alone and the reminder that wanted it is skipped.
  const occupied = new Set(
    classes ? classes.filter((entry) => entry.kind !== 'family-care' && String(entry.item.identifier).startsWith(FAMILY_CARE_ID_PREFIX)).map((entry) => String(entry.item.identifier)) : []
  );
  const otherPending = classes ? classes.filter((entry) => entry.kind !== 'family-care').length : undefined;

  const now = overrides.now ? overrides.now() : Date.now();
  let inputs: ProfileCareInput[];
  try {
    inputs = await (overrides.inputs ? overrides.inputs() : readFamilyCareInputs(new Date(now)));
  } catch {
    return { status: 'degraded', scheduled: 0, reason: 'inputs-unreadable' };
  }
  if (stale()) return { status: 'skipped', scheduled: 0, reason: 'stale' };

  const plan = buildFamilyCarePlan(inputs, { now, openProfileId: open, language: getCurrentLanguage(), otherPendingCount: otherPending });

  // Android: the two private channels first. If they cannot be made nothing is scheduled (the reminder must not fall back to a channel
  // without the lock-screen setting).
  if (Platform.OS === 'android' && plan.notifications.length > 0) {
    try {
      await ensureChannels(N);
    } catch {
      await cancelOwn(N, own);
      return { status: 'degraded', scheduled: 0, reason: 'channels-failed' };
    }
  }
  if (stale()) return { status: 'skipped', scheduled: 0, reason: 'stale' };

  // Take away our own old reminders (only those), then schedule the plan.
  const cancelled = await cancelOwn(N, own);
  let degraded = !cancelled;
  let scheduled = 0;
  for (const planned of plan.notifications) {
    if (stale()) return { status: 'skipped', scheduled, reason: 'stale' };
    if (occupied.has(planned.identifier)) {
      degraded = true;
      continue;
    }
    try {
      await deadline(
        N.scheduleNotificationAsync({
          identifier: planned.identifier,
          content: { title: planned.title, body: planned.body },
          trigger: {
            type: N.SchedulableTriggerInputTypes.DATE,
            date: new Date(planned.atMs),
            ...(Platform.OS === 'android' ? { channelId: planned.urgency === 'critical' ? FAMILY_CARE_URGENT_CHANNEL : FAMILY_CARE_CHANNEL } : null),
          },
        })
      );
      scheduled += 1;
    } catch {
      degraded = true; // this one failed; the others still go
    }
  }
  if (stale()) return { status: 'skipped', scheduled, reason: 'stale' }; // something changed during the last call: a fresh run replaces this one
  return { status: degraded ? 'degraded' : 'scheduled', scheduled, reason: degraded ? 'some-calls-failed' : null };
}

async function ensureChannels(N: Native): Promise<void> {
  const lang = getCurrentLanguage() === 'es' ? 'es' : 'en';
  await deadline(
    N.setNotificationChannelAsync(FAMILY_CARE_CHANNEL, {
      name: FAMILY_CARE_CHANNEL_NAMES.normal[lang],
      importance: N.AndroidImportance.HIGH,
      lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
    })
  );
  await deadline(
    N.setNotificationChannelAsync(FAMILY_CARE_URGENT_CHANNEL, {
      name: FAMILY_CARE_CHANNEL_NAMES.urgent[lang],
      importance: N.AndroidImportance.MAX,
      lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 400, 200, 400],
      showBadge: false,
    })
  );
}

// Cancels our own reminders and nothing else. With the list: exactly those. Without it (the phone would not list): the fixed names of our
// own namespace (prefix plus 0 to 9), which are ours by construction; cancelling a name that does not exist does nothing. Returns whether
// every cancel went through.
async function cancelOwn(N: Native, listed: string[] | null): Promise<boolean> {
  const ids = listed ?? Array.from({ length: MAX_GENERIC_NOTIFICATIONS }, (_, i) => `${FAMILY_CARE_ID_PREFIX}${i}`);
  const results = await Promise.allSettled(ids.map((id) => deadline(N.cancelScheduledNotificationAsync(id))));
  return results.every((result) => result.status === 'fulfilled');
}

// For tests.
export function configureFamilyCareForTests(next: Overrides | null): void {
  overrides = next ?? {};
  token += 1;
  flight = null;
  again = false;
  status = { status: 'skipped', scheduled: 0, reason: 'not-run' };
}
