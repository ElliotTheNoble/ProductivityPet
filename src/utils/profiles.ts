import AsyncStorage from '@react-native-async-storage/async-storage';

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
// Nothing here has any visible UI yet (no profile picker); that is Stage 2.

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
type Registry = { version: 1; activeProfileId: string; profiles: ProfileRecord[]; backup: BackupRecord | null };

export type ProfilesState = 'uninitialized' | 'ready' | 'safe-mode';
export type ProfilesStatus = {
  state: ProfilesState;
  activeProfileId: string;
  profiles: ProfileRecord[];
  backup: BackupRecord | null;
  // Why safe mode was entered (null when ready).
  issue: string | null;
};

function mainRecord(): ProfileRecord {
  return { id: MAIN_PROFILE_ID, kind: 'main', storage: 'legacy', createdAt: new Date().toISOString() };
}

// Until initialization finishes the app behaves exactly as before: main profile, original keys.
let registry: Registry = { version: 1, activeProfileId: MAIN_PROFILE_ID, profiles: [mainRecord()], backup: null };
let state: ProfilesState = 'uninitialized';
let issue: string | null = null;
let generation = 0;
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
  return scopedKeyFor(registry.activeProfileId, name);
}

// True while the active profile uses the original unscoped keys (the main profile). Only such a profile may
// import the pre-profile saves (old single-pet record, global task list...).
export function isActiveProfileLegacy(): boolean {
  return recordFor(registry.activeProfileId)?.storage === 'legacy';
}

export function getActiveProfileId(): string {
  return registry.activeProfileId;
}

// Changes every time the active profile changes.
export function getProfileGeneration(): number {
  return generation;
}

export function getProfilesStatus(): ProfilesStatus {
  return { state, activeProfileId: registry.activeProfileId, profiles: registry.profiles, backup: registry.backup, issue };
}

const activeListeners = new Set<(profileId: string) => void>();

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

async function writeRegistry(next: Registry): Promise<boolean> {
  try {
    await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export type RegisterResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: 'invalid-id' | 'unavailable' | 'storage' };

// Makes a child profile exist (its id should be the household child id). Creating it writes nothing but the
// registry; the child's own data appears the first time the child is used.
export function registerChildProfile(id: string): Promise<RegisterResult> {
  return serialized(async () => {
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || id === MAIN_PROFILE_ID) return { ok: false, reason: 'invalid-id' } as const;
    await ensureProfilesReady();
    if (state !== 'ready') return { ok: false, reason: 'unavailable' } as const;
    if (recordFor(id)) return { ok: true, created: false } as const;
    const next: Registry = {
      ...registry,
      profiles: [...registry.profiles, { id, kind: 'child', storage: 'scoped', createdAt: new Date().toISOString() }],
    };
    if (!(await writeRegistry(next))) return { ok: false, reason: 'storage' } as const;
    registry = next;
    return { ok: true, created: true } as const;
  });
}

export type SwitchResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'unknown-profile' | 'unavailable' | 'timeout' | 'busy' | 'unsaved-changes' | 'storage'; keys?: string[] };

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

// Synchronously makes `profileId` active: every store drops what it holds, then the id changes. Returns the
// clean-up functions the stores asked for, and whether every reset worked.
function commitActive(profileId: string): { cleanups: (() => Promise<void>)[]; clean: boolean } {
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
  registry = { ...registry, activeProfileId: profileId };
  generation += 1;
  activeListeners.forEach((listener) => listener(profileId));
  return { cleanups, clean };
}

// Switches the active profile. The order matters, so that a switch that fails leaves the CURRENT profile exactly as
// it was (nothing reset, nothing cancelled, nothing lost):
//   1. wait for every pending write and in-flight operation (a write that cannot be saved cancels the switch);
//   2. save the new active id in the registry (a failure cancels the switch; nothing in memory has changed yet);
//   3. wait once more, for anything that started while the registry was being saved (a failure puts the old id back
//      in the registry and cancels the switch);
//   4. only then swap profiles in ONE synchronous step, so nothing can run half in one profile and half in the other,
//      and run the stores' clean-up (cancelling the old profile's phone notifications).
// Nothing in memory is touched, and no clean-up runs, until step 4.
export function switchProfile(profileId: string, options: { timeoutMs?: number } = {}): Promise<SwitchResult> {
  return serialized(async (): Promise<SwitchResult> => {
    await ensureProfilesReady();
    if (!recordFor(profileId)) return { ok: false, reason: 'unknown-profile' };
    if (profileId === registry.activeProfileId) return { ok: true, changed: false };
    if (state !== 'ready') return { ok: false, reason: 'unavailable' };
    const timeoutMs = options.timeoutMs ?? SETTLE_TIMEOUT_MS;
    const previous = registry.activeProfileId;

    const blocked = await settleAll(timeoutMs);
    if (blocked) return blocked;

    if (!(await writeRegistry({ ...registry, activeProfileId: profileId }))) return { ok: false, reason: 'storage' };

    const late = await settleAll(timeoutMs);
    if (late) {
      await writeRegistry(registry); // put the old active id back (best effort; the data is consistent either way)
      return late;
    }

    // No await from here to the end of the swap.
    const swapped = commitActive(profileId);
    if (!swapped.clean) {
      // A store failed to reset. Everything was saved before the swap, so going back only means the stores reload
      // from storage; no clean-up has run.
      commitActive(previous);
      await writeRegistry(registry);
      return { ok: false, reason: 'storage' };
    }
    for (const cleanup of swapped.cleanups) void cleanup().catch(() => {});
    return { ok: true, changed: true };
  });
}
