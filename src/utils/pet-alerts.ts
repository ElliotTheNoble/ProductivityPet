import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { subscribeToLanguage, tr } from '@/i18n';
import { ensureNotificationPermission } from '@/utils/notifications';
import {
  ensureFamilyLoaded,
  getLivingPets,
  getPetLabel,
  markAlertSent,
  peekFamily,
  subscribeToFamily,
  subscribeToLifecycle,
  type FamilyState,
  type PetRecord,
} from '@/utils/pet-family';
import { CRITICAL_TO_DEATH_HOURS, SICK_TO_CRITICAL_HOURS } from '@/utils/pet-family-config';
import { isEggStage, predictSickTime } from '@/utils/pet-lifecycle-core';
import { describeNeededCare } from '@/utils/pet-life-messages';

// Pet health alerts: phone notifications (a gentle one when a pet gets Sick,
// a stronger emergency one when it turns Critical) and a live "critical"
// signal the app uses for vibration and the optional flashlight alert.
//
// Notifications are scheduled AHEAD of time from the saved sickness clocks,
// so they arrive even if the app is closed (where the OS allows it) — the app
// does not need to be running when a pet's 24-hour deadline passes. Whenever
// anything changes (recovery, death, resurrection, new episode) the whole
// schedule is cancelled and rebuilt, so obsolete alerts never fire. Each
// sickness episode is announced once (tracked on the pet).
//
// Local notifications need a development or production build on Android;
// Expo Go can't schedule them, and every native call here fails safe.

const SETTINGS_KEY = '@ProductivityPet:petAlertSettings';
const SCHEDULE_KEY = '@ProductivityPet:petAlertSchedule';
const HEALTH_CHANNEL = 'pet-health';
const EMERGENCY_CHANNEL = 'pet-emergency';
const EMERGENCY_QUIET_CHANNEL = 'pet-emergency-no-vibration';
const HOUR_MS = 3600 * 1000;

export type PetAlertSettings = {
  // Phone notifications (asks for permission when turned on).
  notifications: boolean;
  // Vibrate on a live Critical alert and on the emergency notification channel.
  vibration: boolean;
  // The three-flash flashlight alert while the app is open. Off by default.
  flash: boolean;
};

export const DEFAULT_ALERT_SETTINGS: PetAlertSettings = { notifications: false, vibration: true, flash: false };

let settings: PetAlertSettings | null = null;
const settingsListeners = new Set<(s: PetAlertSettings) => void>();
const criticalListeners = new Set<(petId: string) => void>();

export async function getAlertSettings(): Promise<PetAlertSettings> {
  if (settings) return settings;
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY);
    const parsed = stored ? (JSON.parse(stored) as Partial<PetAlertSettings>) : {};
    settings = {
      notifications: parsed.notifications === true,
      vibration: parsed.vibration !== false,
      flash: parsed.flash === true,
    };
  } catch {
    settings = { ...DEFAULT_ALERT_SETTINGS };
  }
  return settings;
}

export async function saveAlertSettings(patch: Partial<PetAlertSettings>): Promise<PetAlertSettings> {
  const next = { ...(await getAlertSettings()), ...patch };
  settings = next;
  AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
  settingsListeners.forEach((listener) => listener(next));
  void syncPetAlerts();
  return next;
}

export function subscribeToAlertSettings(listener: (s: PetAlertSettings) => void): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

// Fired when a pet turns Critical while the app is open and in use — the
// in-app vibration / optional flashlight alert listens to this.
export function subscribeToCriticalAlert(listener: (petId: string) => void): () => void {
  criticalListeners.add(listener);
  return () => {
    criticalListeners.delete(listener);
  };
}

// Turning notifications ON asks the OS for permission first; if it is
// refused the setting stays off and false is returned.
export async function setNotificationsEnabled(enabled: boolean): Promise<boolean> {
  if (enabled) {
    const granted = await ensureNotificationPermission();
    if (!granted) return false;
  }
  await saveAlertSettings({ notifications: enabled });
  return true;
}

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(HEALTH_CHANNEL, {
      name: tr('ntChHealth'),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F6C99A',
    });
    await Notifications.setNotificationChannelAsync(EMERGENCY_CHANNEL, {
      name: tr('ntChEmergency'),
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400, 200, 400],
      enableVibrate: true,
      sound: 'default',
      lightColor: '#E86F8E',
    });
    // Same alert without vibration, used when the player turns vibration off.
    await Notifications.setNotificationChannelAsync(EMERGENCY_QUIET_CHANNEL, {
      name: tr('ntChQuiet'),
      importance: Notifications.AndroidImportance.MAX,
      enableVibrate: false,
      sound: 'default',
      lightColor: '#E86F8E',
    });
  } catch {
    // Notifications unsupported in this runtime (e.g. Expo Go on Android).
  }
}

type AlertKind = 'sick' | 'critical';

function contentFor(kind: AlertKind, label: string, pet: PetRecord, useVibration: boolean) {
  if (kind === 'sick') {
    return {
      title: tr('ntSickTitle', { pet: label }),
      body: tr('ntSickBody', { pet: label, care: describeNeededCare(pet.profile) }),
      data: { petId: pet.id, kind },
    };
  }
  return {
    title: tr('ntCritTitle', { pet: label }),
    body: tr('ntCritBody', { pet: label }),
    data: { petId: pet.id, kind },
    sound: 'default' as const,
    priority: Notifications.AndroidNotificationPriority.MAX,
    // (vibration for the emergency alert comes from its channel)
    vibrate: useVibration ? [0, 400, 200, 400, 200, 400] : undefined,
  };
}

function channelFor(kind: AlertKind, useVibration: boolean): string {
  if (kind === 'sick') return HEALTH_CHANNEL;
  return useVibration ? EMERGENCY_CHANNEL : EMERGENCY_QUIET_CHANNEL;
}

async function readSchedule(): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(SCHEDULE_KEY);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

let syncing = false;
let syncAgain = false;

// Cancels every previously scheduled pet alert and schedules the ones that
// are still wanted, from the pets' saved clocks. Safe to call any time.
export async function syncPetAlerts(): Promise<void> {
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    const current = await getAlertSettings();
    const family = peekFamily() ?? (await ensureFamilyLoaded());

    for (const id of await readSchedule()) {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {
        // already gone / unsupported runtime
      }
    }
    const scheduled: string[] = [];
    if (current.notifications) {
      await ensureChannels();
      const now = Date.now();
      const schedule = async (kind: AlertKind, atMs: number, pet: PetRecord) => {
        if (atMs <= now + 5000) return;
        try {
          const id = await Notifications.scheduleNotificationAsync({
            content: contentFor(kind, getPetLabel(pet, family.pets), pet, current.vibration),
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(atMs),
              channelId: channelFor(kind, current.vibration),
            },
          });
          scheduled.push(id);
        } catch {
          // Notifications unsupported in this runtime.
        }
      };
      for (const pet of getLivingPets(family)) {
        if (isEggStage(pet.growthUnits)) continue;
        if (pet.lifecycle.state === 'healthy') {
          const predicted = predictSickTime(pet.profile, new Date());
          if (predicted) await schedule('sick', predicted.getTime(), pet);
        } else if (pet.lifecycle.state === 'sick' && pet.lifecycle.sickSince) {
          await schedule('critical', new Date(pet.lifecycle.sickSince).getTime() + SICK_TO_CRITICAL_HOURS * HOUR_MS, pet);
        }
      }
    }
    AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(scheduled)).catch(() => {});
  } finally {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      void syncPetAlerts();
    }
  }
}

async function dismissPresentedFor(petId: string): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const item of presented) {
      if ((item.request.content.data as { petId?: string } | undefined)?.petId === petId) {
        await Notifications.dismissNotificationAsync(item.request.identifier);
      }
    }
  } catch {
    // unsupported runtime
  }
}

async function sendNow(kind: AlertKind, pet: PetRecord, family: FamilyState, useVibration: boolean): Promise<void> {
  try {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: contentFor(kind, getPetLabel(pet, family.pets), pet, useVibration),
      trigger: Platform.OS === 'android' ? { channelId: channelFor(kind, useVibration) } : null,
    });
  } catch {
    // unsupported runtime
  }
}

// A pet's health changed (see subscribeToLifecycle). Announces a new episode
// once, and cleans up alerts that no longer apply.
async function handleLifecycleNotice(notice: { petId: string; type: string; at: string; live: boolean }): Promise<void> {
  const family = peekFamily();
  const pet = family?.pets.find((p) => p.id === notice.petId);
  if (!family || !pet) return;

  if (notice.type === 'recovered' || notice.type === 'died' || notice.type === 'resurrected' || notice.type === 'retired') {
    void dismissPresentedFor(pet.id);
    return;
  }
  if (notice.type !== 'sick' && notice.type !== 'critical') return;

  const kind = notice.type as AlertKind;
  const episode = pet.lifecycle.sickSince ?? notice.at;
  const already = kind === 'sick' ? pet.alerts?.sickNotifiedFor === episode : pet.alerts?.criticalNotifiedFor === episode;
  if (already) return;
  // Mark first so a second event for the same episode can't announce it twice.
  markAlertSent(pet.id, kind, episode);

  // Caught up at launch: the scheduled notification already fired while the
  // app was closed (or notifications are off) — don't announce it again.
  if (!notice.live) return;

  const current = await getAlertSettings();
  if (current.notifications) await sendNow(kind, pet, family, current.vibration);
  if (kind === 'critical') criticalListeners.forEach((listener) => listener(pet.id));
}

// Signature of everything the schedule depends on, so the notifications are
// only rebuilt when something relevant changed (not on every need tick).
function scheduleSignature(family: FamilyState): string {
  return getLivingPets(family)
    .map((pet) => {
      if (pet.lifecycle.state === 'healthy') {
        const predicted = isEggStage(pet.growthUnits) ? null : predictSickTime(pet.profile, new Date());
        // Rounded to 30 minutes: small drift doesn't trigger a rebuild.
        return `${pet.id}:h:${predicted ? Math.round(predicted.getTime() / (30 * 60 * 1000)) : 'x'}`;
      }
      return `${pet.id}:${pet.lifecycle.state}:${pet.lifecycle.sickSince ?? ''}`;
    })
    .join('|');
}

let started = false;

// Called once from the root layout. Listens for health changes and keeps the
// notification schedule current.
export function startPetAlerts(): () => void {
  if (started) return () => {};
  started = true;
  let lastSignature = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const offLifecycle = subscribeToLifecycle((notice) => {
    void handleLifecycleNotice(notice);
  });
  // Scheduled notifications hold their text, so they are rebuilt when the language changes.
  const offLanguage = subscribeToLanguage(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncPetAlerts(), 500);
  });
  const offFamily = subscribeToFamily((family) => {
    const signature = scheduleSignature(family);
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncPetAlerts(), 1500);
  });
  void ensureFamilyLoaded().then((family) => {
    lastSignature = scheduleSignature(family);
    void syncPetAlerts();
  });

  return () => {
    started = false;
    offLifecycle();
    offLanguage();
    offFamily();
    if (timer) clearTimeout(timer);
  };
}

// A short test notification (Alerts settings page).
export async function sendTestNotification(): Promise<boolean> {
  const granted = await ensureNotificationPermission();
  if (!granted) return false;
  try {
    await ensureChannels();
    const current = await getAlertSettings();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: tr('ntTestTitle'),
        body: tr('ntTestBody'),
        sound: 'default',
      },
      trigger: Platform.OS === 'android' ? { channelId: channelFor('critical', current.vibration) } : null,
    });
    return true;
  } catch {
    return false;
  }
}

export const ALERT_HOURS = { sickToCritical: SICK_TO_CRITICAL_HOURS, criticalToDeath: CRITICAL_TO_DEATH_HOURS };

// For the Alerts settings page: plays the in-app critical alert (vibration and,
// if enabled, the flashlight) without any pet being sick.
export function triggerTestCriticalAlert(): void {
  criticalListeners.forEach((listener) => listener('test'));
}
