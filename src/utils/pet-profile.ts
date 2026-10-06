import AsyncStorage from '@react-native-async-storage/async-storage';

// This is the persistent data foundation for the upcoming virtual pet-care
// system (hunger/cleanliness/happiness/energy decay, sleep schedule,
// sickness, poop events, Paw Tokens). This file deliberately only creates
// and persists the profile shape itself — no decay, no earning, no
// schedule/sickness/poop rules live here yet; those are separate, later
// steps that will read/update this same profile via getPetProfile /
// savePetProfile below.

export type PetProfile = {
  // 0-100 "need" meters — see clampNeedValue.
  hunger: number;
  cleanliness: number;
  happiness: number;
  energy: number;
  // Lifetime currency earned through pet care — never decays on its own,
  // so it isn't clamped the way the needs above are (only floored at 0).
  pawTokens: number;
  // ISO datetime the profile was first created. Set exactly once, the very
  // first time a profile is created for this device, and preserved on every
  // later load/save after that — never regenerated.
  adoptionDate: string;
  // ISO datetime this profile was last saved. Updated on every save; future
  // need-decay logic will diff against this to compute elapsed time.
  lastUpdatedAt: string;
  isSleeping: boolean;
  isSick: boolean;
  hasPoop: boolean;
};

// Same key-prefix convention as the rest of the app's AsyncStorage keys
// (@ProductivityPet:tasks, @ProductivityPet:mood — see src/utils/task-storage.ts
// and src/app/index.tsx).
export const PET_PROFILE_STORAGE_KEY = '@ProductivityPet:petProfile';

const DEFAULT_NEED_VALUE = 100;
const NEED_MIN = 0;
const NEED_MAX = 100;

// Exported so future need-changing logic (feeding, cleaning, decay, etc.)
// clamps to the exact same 0-100 bounds instead of each reimplementing it.
export function clampNeedValue(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return NEED_MIN;
  return Math.min(NEED_MAX, Math.max(NEED_MIN, value));
}

function createDefaultPetProfile(): PetProfile {
  const now = new Date().toISOString();
  return {
    hunger: DEFAULT_NEED_VALUE,
    cleanliness: DEFAULT_NEED_VALUE,
    happiness: DEFAULT_NEED_VALUE,
    energy: DEFAULT_NEED_VALUE,
    pawTokens: 0,
    adoptionDate: now,
    lastUpdatedAt: now,
    isSleeping: false,
    isSick: false,
    hasPoop: false,
  };
}

// Repairs a raw value loaded from storage into a valid PetProfile, field by
// field — a single malformed/missing field never discards the rest of a
// real saved profile. `adoptionDate` in particular is only ever replaced
// with "now" when it's genuinely missing from the stored record; it is
// never regenerated just because some other field on the same record was
// invalid.
export function normalizePetProfile(raw: unknown): PetProfile {
  const fallback = createDefaultPetProfile();
  if (!raw || typeof raw !== 'object') return fallback;
  const value = raw as Record<string, unknown>;

  return {
    hunger: typeof value.hunger === 'number' ? clampNeedValue(value.hunger) : fallback.hunger,
    cleanliness: typeof value.cleanliness === 'number' ? clampNeedValue(value.cleanliness) : fallback.cleanliness,
    happiness: typeof value.happiness === 'number' ? clampNeedValue(value.happiness) : fallback.happiness,
    energy: typeof value.energy === 'number' ? clampNeedValue(value.energy) : fallback.energy,
    pawTokens: typeof value.pawTokens === 'number' && value.pawTokens >= 0 ? value.pawTokens : fallback.pawTokens,
    adoptionDate: typeof value.adoptionDate === 'string' && value.adoptionDate ? value.adoptionDate : fallback.adoptionDate,
    lastUpdatedAt:
      typeof value.lastUpdatedAt === 'string' && value.lastUpdatedAt ? value.lastUpdatedAt : fallback.lastUpdatedAt,
    isSleeping: typeof value.isSleeping === 'boolean' ? value.isSleeping : false,
    isSick: typeof value.isSick === 'boolean' ? value.isSick : false,
    hasPoop: typeof value.hasPoop === 'boolean' ? value.hasPoop : false,
  };
}

// In-memory cache, same reasoning as src/utils/task-storage.ts's
// cachedTasks: avoids a fresh AsyncStorage read + parse from every screen
// that ends up needing the pet profile. `null` means "not loaded yet this
// session" (distinct from a real profile object).
let cachedProfile: PetProfile | null = null;
// De-dupes concurrent first-reads into a single AsyncStorage call.
let inFlightRead: Promise<PetProfile> | null = null;

// Loads the pet profile, creating (and persisting) a default one the very
// first time this is ever called for this device — after that, the same
// saved profile (with its original adoptionDate) is returned on every
// future load. Subsequent calls within the same session resolve from
// memory, same as getCachedTasks().
export async function getPetProfile(): Promise<PetProfile> {
  if (cachedProfile !== null) return cachedProfile;
  if (inFlightRead) return inFlightRead;

  inFlightRead = (async () => {
    try {
      const stored = await AsyncStorage.getItem(PET_PROFILE_STORAGE_KEY);
      if (!stored) {
        // No profile has ever been created for this device — create one
        // now (stamping adoptionDate/lastUpdatedAt to this exact moment)
        // and persist it immediately, so this branch is only ever reached
        // once per device.
        const created = createDefaultPetProfile();
        cachedProfile = created;
        try {
          await AsyncStorage.setItem(PET_PROFILE_STORAGE_KEY, JSON.stringify(created));
        } catch {
          // Still usable for this session via the in-memory cache even if
          // the initial write failed; the next savePetProfile() call will
          // retry persisting it.
        }
        return created;
      }

      const parsed = JSON.parse(stored) as unknown;
      cachedProfile = normalizePetProfile(parsed);
      return cachedProfile;
    } catch {
      // Stored value exists but isn't valid JSON at all — nothing in it is
      // recoverable. Fall back to an in-memory default for this session
      // without overwriting whatever is actually in storage, in case this
      // was a transient read error rather than genuinely corrupted data.
      const created = createDefaultPetProfile();
      cachedProfile = created;
      return created;
    } finally {
      inFlightRead = null;
    }
  })();

  return inFlightRead;
}

// Persists the given profile and updates the shared in-memory cache in the
// same step, mirroring persistCachedTasks(). Automatically stamps
// `lastUpdatedAt` to the current time on every save — callers never need to
// (and can't accidentally forget to) set it themselves. Every other field,
// including `adoptionDate`, is saved exactly as passed in and is never
// modified here.
export function savePetProfile(profile: PetProfile): void {
  const updated: PetProfile = { ...profile, lastUpdatedAt: new Date().toISOString() };
  cachedProfile = updated;
  AsyncStorage.setItem(PET_PROFILE_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
  notifyPetProfileListeners(updated);
}

// Lets a UI component (e.g. the header's Paw Token balance) stay in sync
// with the profile without polling or re-reading storage itself — it's
// notified synchronously every time ANY save happens, regardless of which
// screen or action (Feed/Bath/Play/Rest, Paw Token earning, etc.)
// triggered it. Returns an unsubscribe function; callers should call it on
// unmount. Deliberately minimal (a plain Set of callbacks) rather than a
// full pub/sub library — this is the only place in the app that currently
// needs cross-component reactivity for the Pet Profile.
const petProfileListeners = new Set<(profile: PetProfile) => void>();

export function subscribeToPetProfile(listener: (profile: PetProfile) => void): () => void {
  petProfileListeners.add(listener);
  return () => {
    petProfileListeners.delete(listener);
  };
}

function notifyPetProfileListeners(profile: PetProfile): void {
  petProfileListeners.forEach((listener) => listener(profile));
}
