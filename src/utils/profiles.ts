import AsyncStorage from '@react-native-async-storage/async-storage';

import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';

// Profile-scoped local storage (M2, Stage 1). Every piece of personal data (pets, tasks, Paw Tokens, shop,
// Pawadise, mood, journal, mini-game progress, alert settings...) belongs to ONE profile, and each store builds
// its storage keys with scopedKey() instead of a fixed string.
//
// - The "main" profile is the existing player. It keeps using the ORIGINAL unscoped keys
//   (`@ProductivityPet:tasks` ...), so nothing is copied, moved or rewritten and every existing save keeps
//   working untouched. It is the parent / independent-user space, never a child.
// - Child profiles use `@ProductivityPet:p:<profileId>:<name>`. A new child starts empty and can never read
//   the main profile's keys.
// - Device-level data (the onboarding record and language, the household list, developer flags) is not scoped.
//
// Before profile storage is enabled for the first time, a complete copy of every existing key is written to ONE
// backup entry (`@ProductivityPet:backup:preM2:<time>`) and read back and checked. Only then is the registry
// written (a single atomic write, last). The backup is never read, changed or deleted by the app. If the backup
// cannot be made, the app stays in "safe mode": main profile only, exactly as before this feature.
//
// Nothing here has any visible UI yet (no profile picker); that comes later.

const PREFIX = '@ProductivityPet:';
const SCOPED_PREFIX = `${PREFIX}p:`;
export const REGISTRY_KEY = `${PREFIX}profiles`;
export const BACKUP_KEY_PREFIX = `${PREFIX}backup:preM2:`;
export const MAIN_PROFILE_ID = 'main';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SETTLE_TIMEOUT_MS = 15_000;
const SETTLE_ROUNDS = 8;
// Earlier backup attempts that could not be verified are never deleted or overwritten. After this many, no further
// copy is attempted (each one would use more of an already crowded storage) and the app stays in safe mode.
const MAX_UNVERIFIED_BACKUPS = 3;

export type ProfileKind = 'main' | 'child';
export type ProfileStorage = 'legacy' | 'scoped';
export type ProfileRecord = { id: string; kind: ProfileKind; storage: ProfileStorage; createdAt: string };
export type BackupRecord = { key: string; createdAt: string; keyCount: number };
// `revision` counts the writes of the registry (absent = 0). A write is only made over the revision it started from, so a
// second browser tab holding an older copy cannot overwrite a newer registry (see writeRegistry).
type Registry = { version: 1; activeProfileId: string; profiles: ProfileRecord[]; backup: BackupRecord | null; revision?: number };

export type ProfilesState = 'uninitialized' | 'ready' | 'safe-mode';
export type ProfilesStatus = {
  state: ProfilesState;
  activeProfileId: string;
  profiles: ProfileRecord[];
  backup: BackupRecord | null;
  // Why safe mode was entered (null when ready).
  issue: string | null;
  // True while no profile is active (after releaseActiveProfile, until the next successful switch).
  released: boolean;
};

function mainRecord(): ProfileRecord {
  return { id: MAIN_PROFILE_ID, kind: 'main', storage: 'legacy', createdAt: new Date().toISOString() };
}

// Until initialization finishes the app behaves exactly as before: main profile, original keys.
let registry: Registry = { version: 1, activeProfileId: MAIN_PROFILE_ID, profiles: [mainRecord()], backup: null };
let state: ProfilesState = 'uninitialized';
let issue: string | null = null;
let generation = 0;
// True after releaseActiveProfile(): no profile is active, nothing of any profile is loaded, and asking for a profile's
// storage key is an error (so no store can quietly load or write "the last profile"). Cleared by a successful switch.
// `registry.activeProfileId` is then only the last-used pointer.
let released = false;
let initPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------------------------------------
// keys

function recordFor(profileId: string): ProfileRecord | undefined {
  return registry.profiles.find((p) => p.id === profileId);
}

// The storage key for one piece of the given profile's data.
export function scopedKeyFor(profileId: string, name: string): string {
  const record = recordFor(profileId);
  // An unknown id is never allowed to fall back to the original (main) keys.
  if (record && record.storage === 'legacy') return `${PREFIX}${name}`;
  return `${SCOPED_PREFIX}${profileId}:${name}`;
}

// The storage key for the ACTIVE profile. Stores call this at the start of each operation and keep the result,
// so an operation always reads and writes the profile it began in.
export function scopedKey(name: string): string {
  if (released) throw new Error('profile-released'); // no profile is active: never fall back to the last one
  return scopedKeyFor(registry.activeProfileId, name);
}

// True while the active profile uses the original unscoped keys (the main profile). Only such a profile may
// import the pre-profile saves (old single-pet record, global task list...).
export function isActiveProfileLegacy(): boolean {
  return !released && recordFor(registry.activeProfileId)?.storage === 'legacy';
}

// While released this is only the last-used profile: check isProfileReleased() before treating it as the one in use.
export function getActiveProfileId(): string {
  return registry.activeProfileId;
}

// True between releaseActiveProfile() and the next successful switch: the picker is showing and no profile data is loaded.
export function isProfileReleased(): boolean {
  return released;
}

// The names of the stores that clear themselves on a profile change (used by the safety tests).
export function registeredProfileStoreNames(): string[] {
  return stores.map((s) => s.name);
}

// Changes every time the active profile changes.
export function getProfileGeneration(): number {
  return generation;
}

// ---------------------------------------------------------------------------------------------------------
// ownership of delayed work (Stage 4 hardening)
//
// Every store works on whichever profile is open when it runs. So a callback that was started under profile A, and fires after A was
// left (a reward that was on its way, a reminder sync, a timer), would apply itself to B if B has loaded by then. An "owner" is a
// receipt for the profile session (the generation) in which the work was started. Work that mutates profile data after an `await`
// (or that a caller may hold on to) takes the owner when it STARTS and checks it again before every change; a callback whose
// owner is no longer the open profile session does nothing. Leaving and re-entering the SAME profile is a new session too, so a
// callback from before the leave is stale after it. (Key-level protection is separate and unchanged: an operation still builds
// its storage keys at its start, and the profile switch still waits for tracked writes and operations.)
export type ProfileOwner = { readonly generation: number };

export class StaleProfileError extends Error {
  constructor() {
    super('stale-profile');
    this.name = 'StaleProfileError';
  }
}

// The profile session open right now. While no profile is open (the picker is showing) the owner is already stale.
export function captureProfileOwner(): ProfileOwner {
  return { generation: released ? -1 : generation };
}

// True only while the same profile session that issued `owner` is still the open one.
export function isProfileOwner(owner: ProfileOwner): boolean {
  return !released && owner.generation === generation;
}

export function assertProfileOwner(owner: ProfileOwner): void {
  if (!isProfileOwner(owner)) throw new StaleProfileError();
}

// Wraps a callback so that it runs only while the profile session that created it is still the open one (otherwise it returns
// undefined and does nothing). Use it for callbacks that outlive the screen that made them.
export function ownedCallback<A extends unknown[], R>(fn: (...args: A) => R, owner: ProfileOwner = captureProfileOwner()): (...args: A) => R | undefined {
  return (...args: A) => (isProfileOwner(owner) ? fn(...args) : undefined);
}

export function getProfilesStatus(): ProfilesStatus {
  return { state, activeProfileId: registry.activeProfileId, profiles: registry.profiles, backup: registry.backup, issue, released };
}

const activeListeners = new Set<(profileId: string) => void>();

// The phone-side clean-up after a profile swap or release (cancelling everything that was scheduled, clearing the tray) runs
// just AFTER the swap. Anything that schedules notifications for the profile now in use (task reminders, pet alerts) must
// wait for it, or it could schedule a reminder that the clean-up then cancels. The epoch counts the clean-ups that really
// started (only a successful swap or release starts one, never a failed one): a reminder that was scheduled before the epoch
// changed has been cancelled on the phone even though the saved task still says it is scheduled, so it has to be scheduled again.
let notificationEpoch = 0;
let cleanupDone: Promise<void> = Promise.resolve();
const CLEANUP_WAIT_MS = 10_000;

export function getNotificationEpoch(): number {
  return notificationEpoch;
}

// Resolves when the clean-up of the last swap or release is finished (or after 10 seconds, so a phone call that never
// returns can never block scheduling forever). Never rejects.
export function whenProfileCleanupDone(): Promise<void> {
  return withTimeout(cleanupDone, CLEANUP_WAIT_MS).then(
    () => undefined,
    () => undefined
  );
}

// Registers clean-up work that did not come from a profile swap (the family-mode start-up clean-up of stale private notifications), so
// that scheduling waits for it exactly like it waits for a swap's clean-up. It counts like a swap for the reminders: whatever it
// cancelled has to be scheduled again by the next pass (see getNotificationEpoch). Never rejects.
export function trackCleanup(work: Promise<unknown>): void {
  notificationEpoch += 1;
  const settled = work.then(
    () => undefined,
    () => undefined
  );
  cleanupDone = Promise.all([cleanupDone, settled]).then(() => undefined);
}

function runCleanups(cleanups: (() => Promise<void>)[]): void {
  notificationEpoch += 1;
  const running = Promise.all(cleanups.map((cleanup) => cleanup().catch(() => {}))).then(() => undefined);
  cleanupDone = Promise.all([cleanupDone, running]).then(() => undefined);
}

export function subscribeToActiveProfile(listener: (profileId: string) => void): () => void {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------------------------------------
// tracked writes and operations (so a profile switch can wait for them, and never lose them silently)

const writeSeq = new Map<string, number>();
const failedWrites = new Map<string, string>();
const pendingWrites = new Set<Promise<boolean>>();
const operations = new Set<Promise<unknown>>();

// AsyncStorage.setItem that the profile switch can wait for. Resolves true when the value reached storage. A
// failed value is remembered (until a newer write to the same key succeeds) so a switch can retry it instead of
// dropping it.
export function writeScoped(key: string, value: string): Promise<boolean> {
  const seq = (writeSeq.get(key) ?? 0) + 1;
  writeSeq.set(key, seq);
  let call: Promise<void>;
  try {
    call = Promise.resolve(AsyncStorage.setItem(key, value));
  } catch (error) {
    call = Promise.reject(error);
  }
  const done: Promise<boolean> = call.then(
    () => {
      if (writeSeq.get(key) === seq) failedWrites.delete(key);
      return true;
    },
    () => {
      if (writeSeq.get(key) === seq) failedWrites.set(key, value);
      return false;
    }
  );
  pendingWrites.add(done);
  void done.then(() => pendingWrites.delete(done));
  return done;
}

// Marks an async operation as in flight. A profile switch waits for it to finish first, so it can never straddle
// two profiles.
// True while any tracked write or operation is still running (a leave would have to wait for it). Read-only; changes nothing.
export function hasPendingProfileWork(): boolean {
  return operations.size > 0 || pendingWrites.size > 0;
}

export function trackOperation<T>(promise: Promise<T>): Promise<T> {
  operations.add(promise);
  const forget = () => {
    operations.delete(promise);
  };
  promise.then(forget, forget);
  return promise;
}

// ---------------------------------------------------------------------------------------------------------
// store registration

export type ProfileStoreHooks = {
  name: string;
  // Resolves when the store's own queued work (a promise chain) is finished.
  settle?: () => Promise<unknown>;
  // Called synchronously while the profile changes: drop caches, cached promises and per-profile timers. May
  // return a clean-up function that is run afterwards (for example cancelling phone notifications).
  reset: () => void | (() => Promise<void>);
};

const stores: ProfileStoreHooks[] = [];

export function registerProfileStore(hooks: ProfileStoreHooks): void {
  const at = stores.findIndex((s) => s.name === hooks.name);
  if (at >= 0) stores[at] = hooks;
  else stores.push(hooks);
}

// Notification privacy (interim rule for M2: phone alerts and task reminders are only scheduled for the ACTIVE
// profile). A notification carries personal text (a pet's name, a task title), so once a switch has really happened
// everything this app has scheduled or already shown belongs to the profile that was left and is cancelled / cleared
// from the notification tray. Cancelling everything (not only the ids a profile remembers) also covers reminders
// scheduled in an earlier session. This runs only after a successful swap, never for a switch that failed, and it
// lives here (not in a screen or store module) so it can never be skipped because some module was not loaded.
registerProfileStore({
  name: 'notifications',
  reset: () => async () => {
    if (FAMILY_MODE_ENABLED) {
      // Family mode: a clean-up that can be CHECKED (list, cancel only what is positively private, list again) and that never touches
      // anything else; its result is kept as a state (see @/utils/notification-cleanup.ts). Everything else below is unchanged.
      await (require('@/utils/notification-cleanup') as typeof import('@/utils/notification-cleanup')).cleanPrivateNotifications();
      return;
    }
    try {
      const Notifications = require('expo-notifications') as typeof import('expo-notifications');
      await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
      await Notifications.dismissAllNotificationsAsync().catch(() => {});
    } catch {
      // Not available here (web, Expo Go): nothing was scheduled or shown by this app.
    }
  },
});

// ---------------------------------------------------------------------------------------------------------
// initialization (backup first, registry last)

function isLegacyKey(key: string): boolean {
  return (
    key.startsWith(PREFIX) &&
    !key.startsWith(SCOPED_PREFIX) &&
    !key.startsWith(BACKUP_KEY_PREFIX) &&
    key !== REGISTRY_KEY &&
    !key.startsWith(`${REGISTRY_KEY}.corrupt-`)
  );
}

async function captureLegacy(): Promise<Record<string, string>> {
  const keys = (await AsyncStorage.getAllKeys()).filter(isLegacyKey).sort();
  const pairs = await AsyncStorage.multiGet(keys);
  const out: Record<string, string> = {};
  for (const [key, value] of pairs) if (typeof value === 'string') out[key] = value;
  return out;
}

function sameEntries(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  return ak.length === Object.keys(b).length && ak.every((k) => a[k] === b[k]);
}

function parseBackup(raw: string | null): BackupRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; createdAt?: unknown; keyCount?: unknown; entries?: unknown };
    if (parsed.version !== 1 || typeof parsed.createdAt !== 'string' || typeof parsed.keyCount !== 'number') return null;
    if (!parsed.entries || typeof parsed.entries !== 'object') return null;
    if (Object.keys(parsed.entries as object).length !== parsed.keyCount) return null;
    return { key: '', createdAt: parsed.createdAt, keyCount: parsed.keyCount };
  } catch {
    return null;
  }
}

// Reuses a complete backup left by an interrupted earlier start, otherwise writes a new one and reads it back.
// Returns null (and changes nothing else) if a verified backup could not be made.
async function ensureBackup(): Promise<BackupRecord | null> {
  try {
    const existing = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(BACKUP_KEY_PREFIX)).sort();
    let unverified = 0;
    for (const key of existing) {
      const valid = parseBackup(await AsyncStorage.getItem(key));
      if (valid) return { ...valid, key };
      unverified += 1;
    }
    if (unverified >= MAX_UNVERIFIED_BACKUPS) return null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const first = await captureLegacy();
      const second = await captureLegacy();
      if (!sameEntries(first, second)) continue; // the app was writing while we copied: try again
      const createdAt = new Date().toISOString();
      const key = `${BACKUP_KEY_PREFIX}${String(Date.now()).padStart(15, '0')}`;
      const json = JSON.stringify({ version: 1, createdAt, keyCount: Object.keys(first).length, entries: first });
      await AsyncStorage.setItem(key, json);
      if ((await AsyncStorage.getItem(key)) !== json) return null;
      const verified = parseBackup(json);
      return verified ? { ...verified, key } : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function discoverScopedProfiles(): Promise<ProfileRecord[]> {
  const found = new Set<string>();
  for (const key of await AsyncStorage.getAllKeys()) {
    if (!key.startsWith(SCOPED_PREFIX)) continue;
    const id = key.slice(SCOPED_PREFIX.length).split(':')[0];
    if (ID_PATTERN.test(id) && id !== MAIN_PROFILE_ID) found.add(id);
  }
  const createdAt = new Date().toISOString();
  return Array.from(found).sort().map((id) => ({ id, kind: 'child' as const, storage: 'scoped' as const, createdAt }));
}

function parseRegistry(raw: string): Registry | null {
  try {
    const r = JSON.parse(raw) as Partial<Registry>;
    if (!r || r.version !== 1 || !Array.isArray(r.profiles) || typeof r.activeProfileId !== 'string') return null;
    if (r.revision !== undefined && (typeof r.revision !== 'number' || !Number.isInteger(r.revision) || r.revision < 0)) return null;
    const seen = new Set<string>();
    for (const p of r.profiles) {
      if (!p || typeof p.id !== 'string' || !ID_PATTERN.test(p.id) || seen.has(p.id)) return null;
      if (p.kind !== 'main' && p.kind !== 'child') return null;
      if (p.storage !== 'legacy' && p.storage !== 'scoped') return null;
      if (p.kind === 'child' && p.storage !== 'scoped') return null;
      if (p.kind === 'main' && p.id !== MAIN_PROFILE_ID) return null;
      if (typeof p.createdAt !== 'string') return null;
      seen.add(p.id);
    }
    if (!seen.has(MAIN_PROFILE_ID) || !seen.has(r.activeProfileId)) return null;
    const b = r.backup;
    if (!b || typeof b.key !== 'string' || !b.key.startsWith(BACKUP_KEY_PREFIX) || typeof b.createdAt !== 'string' || typeof b.keyCount !== 'number') {
      return null;
    }
    return r as Registry;
  } catch {
    return null;
  }
}

function enterSafeMode(reason: string): void {
  state = 'safe-mode';
  issue = reason;
  registry = { version: 1, activeProfileId: MAIN_PROFILE_ID, profiles: [mainRecord()], backup: null };
}

async function runInit(): Promise<void> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(REGISTRY_KEY);
  } catch {
    enterSafeMode('registry-unreadable');
    return;
  }
  if (raw !== null) {
    const parsed = parseRegistry(raw);
    if (parsed) {
      registry = parsed;
      state = 'ready';
      issue = null;
      return;
    }
    // Damaged registry: keep the original text before anything is rebuilt.
    try {
      await AsyncStorage.setItem(`${REGISTRY_KEY}.corrupt-${Date.now()}`, raw);
    } catch {
      enterSafeMode('registry-damaged-not-preserved');
      return;
    }
  }
  const backup = await ensureBackup();
  if (!backup) {
    enterSafeMode('backup-failed');
    return;
  }
  let children: ProfileRecord[] = [];
  try {
    children = await discoverScopedProfiles();
  } catch {
    enterSafeMode('registry-unreadable');
    return;
  }
  const next: Registry = { version: 1, activeProfileId: MAIN_PROFILE_ID, profiles: [mainRecord(), ...children], backup };
  try {
    await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(next));
  } catch {
    enterSafeMode('registry-write-failed');
    return;
  }
  registry = next;
  state = 'ready';
  issue = null;
}

// Resolves once the profile registry has been read (and, the first time, the backup made). Never rejects. Stores
// await this before their first read.
export function ensureProfilesReady(): Promise<void> {
  if (!initPromise) {
    initPromise = runInit().catch(() => {
      enterSafeMode('init-error');
    });
  }
  return initPromise;
}

// Tries initialization again after safe mode (for example after freeing storage space).
export async function retryProfileInitialization(): Promise<ProfilesStatus> {
  if (state === 'safe-mode') initPromise = null;
  await ensureProfilesReady();
  return getProfilesStatus();
}

// ---------------------------------------------------------------------------------------------------------
// registering and switching profiles

let registryChain: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = registryChain.then(run, run);
  registryChain = next.catch(() => {});
  return next;
}

// Saves the registry only over the revision this copy started from. AsyncStorage has no compare-and-set, so this reads what is
// stored right now, refuses if it is newer or unreadable ("conflict": another tab changed it, or it was damaged; nothing is
// overwritten), writes revision + 1 and reads it back to notice a racing write. The small window between the read and the
// write cannot be closed with this storage; the web development preview also takes a single-tab lock (a later stage).
type RegistryWrite = { status: 'ok'; registry: Registry } | { status: 'conflict' | 'failed' };

async function writeRegistry(next: Registry): Promise<RegistryWrite> {
  let storedRevision = 0;
  try {
    const raw = await AsyncStorage.getItem(REGISTRY_KEY);
    if (raw !== null) {
      const stored = parseRegistry(raw);
      if (!stored) return { status: 'conflict' }; // something we do not understand is there: never write over it
      storedRevision = stored.revision ?? 0;
    }
  } catch {
    return { status: 'failed' };
  }
  if (storedRevision !== (registry.revision ?? 0)) return { status: 'conflict' };
  const written: Registry = { ...next, revision: storedRevision + 1 };
  const json = JSON.stringify(written);
  try {
    await AsyncStorage.setItem(REGISTRY_KEY, json);
  } catch {
    return { status: 'failed' };
  }
  try {
    if ((await AsyncStorage.getItem(REGISTRY_KEY)) !== json) return { status: 'conflict' }; // another tab wrote in between
  } catch {
    return { status: 'failed' };
  }
  return { status: 'ok', registry: written };
}

// Adopts the registry that is stored right now (after a conflict). This tab keeps the profile it is using; the stored copy's
// profiles are kept as they are. Returns false when the stored registry is missing or cannot be understood (then nothing changes).
async function reloadRegistry(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(REGISTRY_KEY);
    const stored = raw === null ? null : parseRegistry(raw);
    if (!stored) return false;
    const keep = stored.profiles.some((p) => p.id === registry.activeProfileId) ? registry.activeProfileId : stored.activeProfileId;
    registry = { ...stored, activeProfileId: keep };
    return true;
  } catch {
    return false;
  }
}

// Re-reads the registry from storage so a profile added by another tab (or another part of the app) is seen. The profile in
// use does not change. Returns false when the registry could not be read.
export function reloadProfileRegistry(): Promise<boolean> {
  return serialized(async () => {
    await ensureProfilesReady();
    if (state !== 'ready') return false;
    return reloadRegistry();
  });
}

export type RegisterResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: 'invalid-id' | 'unavailable' | 'storage' | 'conflict' };

// Makes a child profile exist (its id should be the household child id). Creating it writes nothing but the
// registry; the child's own data appears the first time the child is used. Registering an id that already exists changes
// nothing (so a repeated or interrupted creation never makes a second profile). If another tab saved the registry first,
// the newer registry is adopted and this one record is added to it (nothing of the other copy is dropped).
export function registerChildProfile(id: string): Promise<RegisterResult> {
  return serialized(async () => {
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || id === MAIN_PROFILE_ID) return { ok: false, reason: 'invalid-id' } as const;
    await ensureProfilesReady();
    if (state !== 'ready') return { ok: false, reason: 'unavailable' } as const;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (recordFor(id)) return { ok: true, created: false } as const;
      const next: Registry = {
        ...registry,
        profiles: [...registry.profiles, { id, kind: 'child', storage: 'scoped', createdAt: new Date().toISOString() }],
      };
      const result = await writeRegistry(next);
      if (result.status === 'ok') {
        registry = result.registry;
        return { ok: true, created: true } as const;
      }
      if (result.status === 'failed') return { ok: false, reason: 'storage' } as const;
      if (!(await reloadRegistry())) return { ok: false, reason: 'conflict' } as const;
    }
    return { ok: false, reason: 'conflict' } as const;
  });
}

export type SwitchResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'unknown-profile' | 'unavailable' | 'timeout' | 'busy' | 'unsaved-changes' | 'storage' | 'conflict'; keys?: string[] };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Waits until no tracked operation or write is in flight and every store's own queue is empty, then retries any
// write that failed. Anything that still cannot be saved is reported, never dropped.
async function settleAll(timeoutMs: number): Promise<SwitchResult | null> {
  const drain = async (): Promise<'stable' | 'busy'> => {
    for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
      const work: Promise<unknown>[] = [...operations, ...pendingWrites];
      for (const store of stores) {
        const queued = store.settle?.();
        if (queued) work.push(queued);
      }
      await Promise.allSettled(work);
      if (operations.size === 0 && pendingWrites.size === 0) return 'stable';
    }
    return 'busy';
  };
  const first = await withTimeout(drain(), timeoutMs);
  if (first === 'timeout') return { ok: false, reason: 'timeout' };
  if (first === 'busy') return { ok: false, reason: 'busy' };
  if (failedWrites.size > 0) {
    await Promise.all(Array.from(failedWrites, ([key, value]) => writeScoped(key, value)));
    const again = await withTimeout(drain(), timeoutMs);
    if (again === 'timeout') return { ok: false, reason: 'timeout' };
    if (again === 'busy') return { ok: false, reason: 'busy' };
  }
  if (failedWrites.size > 0) return { ok: false, reason: 'unsaved-changes', keys: Array.from(failedWrites.keys()) };
  return null;
}

// Every store drops what it holds. Returns the clean-up functions the stores asked for, and whether every reset worked.
function resetStores(): { cleanups: (() => Promise<void>)[]; clean: boolean } {
  const cleanups: (() => Promise<void>)[] = [];
  let clean = true;
  for (const store of stores) {
    try {
      const cleanup = store.reset();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    } catch {
      clean = false;
    }
  }
  return { cleanups, clean };
}

// Synchronously makes `profileId` active: every store drops what it holds, then the id changes. Returns the
// clean-up functions the stores asked for, and whether every reset worked. After a release the stores are already empty
// (and asking them to reset would need a profile key), so that one step is skipped.
function commitActive(profileId: string, options: { alreadyReset?: boolean; keepSession?: boolean } = {}): { cleanups: (() => Promise<void>)[]; clean: boolean } {
  const swapped = options.alreadyReset ? { cleanups: [], clean: true } : resetStores();
  registry = { ...registry, activeProfileId: profileId };
  released = false;
  // Going BACK to the profile that was open after a failed swap is not a new session: work that belongs to it stays valid.
  if (!options.keepSession) generation += 1;
  activeListeners.forEach((listener) => listener(profileId));
  return swapped;
}

// Switches the active profile. The order matters, so that a switch that fails leaves the CURRENT profile exactly as
// it was (nothing reset, nothing cancelled, nothing lost):
//   1. wait for every pending write and in-flight operation (a write that cannot be saved cancels the switch);
//   2. save the new active id in the registry (a failure cancels the switch; nothing in memory has changed yet; a registry
//      another tab saved first is adopted once and the switch retried, then it is a "conflict");
//   3. wait once more, for anything that started while the registry was being saved (a failure puts the old id back
//      in the registry and cancels the switch);
//   4. only then swap profiles in ONE synchronous step, so nothing can run half in one profile and half in the other,
//      and run the stores' clean-up (cancelling the old profile's phone notifications).
// Nothing in memory is touched, and no clean-up runs, until step 4.
// Switching to the profile that was last used works after a release too (the release is what is being ended).
export function switchProfile(profileId: string, options: { timeoutMs?: number } = {}): Promise<SwitchResult> {
  return serialized(async (): Promise<SwitchResult> => {
    await ensureProfilesReady();
    // A profile another tab added since this one started is not "unknown": look at the stored registry once before refusing.
    if (!recordFor(profileId) && state === 'ready') await reloadRegistry();
    if (!recordFor(profileId)) return { ok: false, reason: 'unknown-profile' };
    if (profileId === registry.activeProfileId && !released) return { ok: true, changed: false };
    if (state !== 'ready') return { ok: false, reason: 'unavailable' };
    const timeoutMs = options.timeoutMs ?? SETTLE_TIMEOUT_MS;
    const previous = registry.activeProfileId;
    const wasReleased = released;

    const blocked = await settleAll(timeoutMs);
    if (blocked) return blocked;

    let written = await writeRegistry({ ...registry, activeProfileId: profileId });
    if (written.status === 'conflict' && (await reloadRegistry())) {
      if (!recordFor(profileId)) return { ok: false, reason: 'unknown-profile' };
      written = await writeRegistry({ ...registry, activeProfileId: profileId });
    }
    if (written.status !== 'ok') return { ok: false, reason: written.status === 'conflict' ? 'conflict' : 'storage' };
    registry = { ...registry, revision: written.registry.revision }; // the id in memory changes only in step 4

    const late = await settleAll(timeoutMs);
    if (late) {
      const back = await writeRegistry(registry); // put the old active id back (best effort; the data is consistent either way)
      if (back.status === 'ok') registry = back.registry;
      return late;
    }

    // No await from here to the end of the swap.
    const sessionBefore = generation;
    const swapped = commitActive(profileId, { alreadyReset: wasReleased });
    if (!swapped.clean) {
      // A store failed to reset. Everything was saved before the swap, so going back only means the stores reload
      // from storage; no clean-up has run. The profile session that was open stays the same one (work that belongs to it stays valid).
      commitActive(previous, { keepSession: true });
      generation = sessionBefore;
      const back = await writeRegistry(registry);
      if (back.status === 'ok') registry = back.registry;
      return { ok: false, reason: 'storage' };
    }
    runCleanups(swapped.cleanups);
    return { ok: true, changed: true };
  });
}

export type ReleaseResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'unavailable' | 'timeout' | 'busy' | 'unsaved-changes' | 'storage'; keys?: string[] };

// Leaves the active profile WITHOUT choosing another (for the family picker): every pending write and in-flight operation
// finishes first (a write that cannot be saved cancels the release and the profile stays exactly as it was), then, in one
// synchronous step, every store drops what it holds, the phone notifications of the profile being left are cancelled and
// cleared (the same rule as a switch), the parent area locks (listeners are told) and no profile is active until the next
// successful switchProfile(). Nothing is written to the registry: the last-used pointer stays as it was, which is not
// an active profile. While released, scopedKey() throws, so no store can load or write anything by accident.
export function releaseActiveProfile(options: { timeoutMs?: number } = {}): Promise<ReleaseResult> {
  return serialized(async (): Promise<ReleaseResult> => {
    await ensureProfilesReady();
    if (released) return { ok: true, changed: false };
    if (state !== 'ready') return { ok: false, reason: 'unavailable' };
    const timeoutMs = options.timeoutMs ?? SETTLE_TIMEOUT_MS;
    for (let round = 0; round < 3; round += 1) {
      const blocked = await settleAll(timeoutMs);
      if (blocked && !blocked.ok) return { ok: false, reason: blocked.reason === 'conflict' || blocked.reason === 'unknown-profile' ? 'storage' : blocked.reason, keys: blocked.keys };
      if (operations.size === 0 && pendingWrites.size === 0) break;
    }
    if (operations.size > 0 || pendingWrites.size > 0) return { ok: false, reason: 'busy' };

    // No await from here to the end of the release.
    const previous = registry.activeProfileId;
    const swapped = resetStores();
    if (!swapped.clean) {
      // A store failed to reset: stay in the profile (everything was saved), and make the screens reload what is saved.
      commitActive(previous, { keepSession: true });
      return { ok: false, reason: 'storage' };
    }
    released = true;
    generation += 1;
    activeListeners.forEach((listener) => listener(previous));
    runCleanups(swapped.cleanups);
    return { ok: true, changed: true };
  });
}
