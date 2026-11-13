import AsyncStorage from '@react-native-async-storage/async-storage';

import { tr } from '@/i18n';
import { FAMILY_MODE_ENABLED, GAMEPLAY_CHEATS_ALLOWED } from '@/utils/dev-flags';
import { endToySession, getToySession, resetToySessions, startToySession } from '@/utils/pet-toy-session';
import {
  captureProfileOwner,
  ensureProfilesReady,
  isActiveProfileLegacy,
  isProfileOwner,
  registerProfileStore,
  scopedKey,
  trackOperation,
  writeScoped,
} from '@/utils/profiles';
import { getToy } from '@/utils/toys/toy-catalog';
import { PET_ACCESSORY_ART } from '@/utils/pet-accessories';
import {
  MAX_LIVING_PETS,
  GROWTH_UNITS_PER_TASK,
  RESURRECTION_COST,
  MEDICINE_NEED_BOOST,
  MEDICINE_PRICE,
  RESURRECTION_RESTORED_NEED_VALUE,
  SICK_TO_CRITICAL_HOURS,
  WASHCLOTH_PRICE,
} from '@/utils/pet-family-config';
import {
  addEvents,
  advancePet,
  getPeakFor,
  makeEvent,
  reevaluatePet,
  type LifeState,
  type PetEvent,
  type PetEventType,
  type PetLifecycle,
  type PetRecord,
} from '@/utils/pet-lifecycle-core';
import {
  PET_PROFILE_STORAGE_KEY,
  createDefaultPetProfile,
  normalizePetProfile,
  type PetProfile,
} from '@/utils/pet-profile-model';
import { TASKS_PER_STAGE } from '@/utils/pet-stage';
import { getCompletedTaskCount, normalizeTask, todayISO } from '@/utils/tasks';

// The pet family: every pet the player has raised (living or deceased) plus
// the player's shared Paw Token wallet, in ONE saved record. Keeping it in a
// single AsyncStorage value is what makes the risky operations atomic — a
// resurrection (charge 500 + revive) or an adoption either fully saves or
// doesn't save at all, so a crash can't leave a half-finished state.
//
// Migration: the first launch after this shipped copies the old single Pet
// Profile (and its tasks-derived growth, equipment and album peaks) into
// pet #1 with the SAME stable id the Pet Album already used, and moves its
// Paw Tokens into the wallet. The old saved values are left untouched.
//
// Screens keep using getPetProfile/savePetProfile (@/utils/pet-profile.ts);
// those now read and write the SELECTED pet through the functions below.

export { MAX_LIVING_PETS };
export type { LifeState, PetEvent, PetEventType, PetLifecycle, PetRecord };

// The family record belongs to the active profile (see @/utils/profiles.ts). The LEGACY_* keys below are the
// pre-profile saves; only the main profile (which keeps the original keys) may ever import them.
export const FAMILY_KEY_NAME = 'petFamily';
const LEGACY_TASKS_KEY = '@ProductivityPet:tasks';
const LEGACY_ALBUM_KEY = '@ProductivityPet:petAlbum';
const LEGACY_HAT_KEY = '@ProductivityPet:equippedPetHatId';
const LEGACY_BOW_KEY = '@ProductivityPet:equippedPetBowId';
const LEGACY_SINGLE_KEY = '@ProductivityPet:equippedPetAccessoryId';

export type FamilyState = {
  version: 1;
  selectedPetId: string;
  pets: PetRecord[];
  wallet: { pawTokens: number };
  // Consumable Pet Care Supplies the player owns (shared by all pets). Missing in older saves = none.
  supplies?: { washcloth: number; medicine: number };
  // Toys the player owns and hasn't used yet, by toy id (see @/utils/toys). Missing in older saves = none.
  toys?: Record<string, number>;
  // Household tasks (a parent's approved tasks, see @/utils/household-rewards.ts) whose Paw Token reward has ALREADY been added to the wallet above.
  // It lives in this same record, so the credit and the note that it was given are saved together in one write: whatever interrupts a save,
  // either both are there or neither is, which is what lets a reward be retried safely and never paid twice. Missing in older saves = none.
  householdRewards?: string[];
};

export type LifecycleNotice = {
  petId: string;
  type: PetEventType;
  at: string;
  // True when it was detected while the app is open and being used (so an
  // in-app alert makes sense); false for catching up at launch.
  live: boolean;
};

let state: FamilyState | null = null;
let loadPromise: Promise<FamilyState> | null = null;
const familyListeners = new Set<(s: FamilyState) => void>();
const profileListeners = new Set<(p: PetProfile) => void>();
const lifecycleListeners = new Set<(n: LifecycleNotice) => void>();

// ----- small helpers -----

function nowIso(): string {
  return new Date().toISOString();
}

// Retired in Pet Pawadise (frozen, off the active slots; see PetRecord.retired).
export function isRetired(pet: PetRecord): boolean {
  return !!pet.retired;
}

// "Living" = an ACTIVE pet at home: not passed away and not retired in Pawadise. This is what counts
// toward the three-pet limit, grows from tasks, decays and can get sick. A retired pet is alive but
// deliberately NOT included, so every rule written for living pets leaves it frozen.
export function isLiving(pet: PetRecord): boolean {
  return pet.lifecycle.state !== 'deceased' && !pet.retired;
}

export function getRetiredPets(s: FamilyState): PetRecord[] {
  return s.pets.filter((p) => isRetired(p) && p.lifecycle.state !== 'deceased');
}

export function getPetSpecies(pet: PetRecord): string {
  return pet.species ?? 'cat';
}

export function getLivingPets(s: FamilyState): PetRecord[] {
  return s.pets.filter(isLiving);
}

export function canAdoptMore(s: FamilyState): boolean {
  return getLivingPets(s).length < MAX_LIVING_PETS;
}

export function getSelectedPet(s: FamilyState): PetRecord {
  return s.pets.find((p) => p.id === s.selectedPetId) ?? s.pets[0];
}

function petIdFromAdoptionDate(adoptionDate: string): string {
  const t = new Date(adoptionDate).getTime();
  return Number.isNaN(t) ? 'pet-current' : `pet-${t}`;
}

function newPetId(): string {
  return `pet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Every profile object handed out here carries (invisibly: a symbol key, never saved, copied by an object spread) the profile
// session it was read in. A copy of it that a delayed callback saves later is refused when that session is over, so it can never
// overwrite another profile's pet or wallet (see savePetProfileForSelectedPet and ProfileOwner in @/utils/profiles.ts).
const SESSION_TAG = Symbol('profileSession');
type SessionTagged = { [SESSION_TAG]?: number };
// Also invisible and copied by a spread: the wallet balance the profile was read with. A save is applied as a CHANGE to the balance (what the
// screen added or spent since it read the profile), not as a new balance, so an older copy that nothing changed the balance in can never wipe
// out Paw Tokens that arrived after it was read (a reward, a task payout...).
const WALLET_BASE = Symbol('walletBase');
type WalletTagged = { [WALLET_BASE]?: number };

function toProfile(pet: PetRecord, wallet: { pawTokens: number }): PetProfile {
  const profile: PetProfile & SessionTagged = {
    ...pet.profile,
    pawTokens: wallet.pawTokens,
    petId: pet.id,
    petName: pet.name,
    growthCredit: pet.growthUnits / GROWTH_UNITS_PER_TASK,
    lifeState: pet.lifecycle.state,
    sickSince: pet.lifecycle.sickSince,
    criticalSince: pet.lifecycle.criticalSince,
    diedAt: pet.lifecycle.diedAt,
  };
  profile[SESSION_TAG] = captureProfileOwner().generation;
  (profile as WalletTagged)[WALLET_BASE] = wallet.pawTokens;
  return profile;
}

// Same object back for the same pet + balance, so React state set from a
// listener doesn't re-render when nothing visible changed.
const profileCache = new WeakMap<PetRecord, { tokens: number; profile: PetProfile }>();
function selectedProfile(s: FamilyState): PetProfile {
  const pet = getSelectedPet(s);
  const cached = profileCache.get(pet);
  if (cached && cached.tokens === s.wallet.pawTokens) return cached.profile;
  const profile = toProfile(pet, s.wallet);
  profileCache.set(pet, { tokens: s.wallet.pawTokens, profile });
  return profile;
}

const EXTRA_KEYS = new Set([
  'petId',
  'petName',
  'growthCredit',
  'lifeState',
  'sickSince',
  'criticalSince',
  'diedAt',
  'pawTokens',
  'lastUpdatedAt',
]);

function comparable(profile: PetProfile): string {
  const entries = Object.entries(profile as Record<string, unknown>)
    .filter(([key]) => !EXTRA_KEYS.has(key))
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(entries);
}

function stripExtras(profile: PetProfile): PetProfile {
  const copy: Record<string, unknown> = { ...(profile as Record<string, unknown>) };
  for (const key of ['petId', 'petName', 'growthCredit', 'lifeState', 'sickSince', 'criticalSince', 'diedAt']) {
    delete copy[key];
  }
  delete (copy as SessionTagged)[SESSION_TAG];
  delete (copy as WalletTagged)[WALLET_BASE];
  return copy as PetProfile;
}

// ----- persistence -----

let writeChain: Promise<boolean> = Promise.resolve(true);

// Writes the CURRENT state. Writes are queued in order; resolves true only
// if the value really reached storage. The key is fixed now, so a write queued for one
// profile can never land in another profile's record.
function persistNow(): Promise<boolean> {
  const snapshot = JSON.stringify(state);
  const key = scopedKey(FAMILY_KEY_NAME);
  writeChain = writeChain.then(() => writeScoped(key, snapshot));
  return writeChain;
}

function notify(): void {
  if (!state) return;
  const s = state;
  familyListeners.forEach((listener) => listener(s));
  const profile = selectedProfile(s);
  profileListeners.forEach((listener) => listener(profile));
}

function setState(next: FamilyState, persist = true): void {
  state = next;
  if (persist) void persistNow();
  notify();
}

function emitNotices(before: PetRecord[], after: PetRecord[], live: boolean): void {
  for (const pet of after) {
    const previous = before.find((p) => p.id === pet.id);
    const known = new Set((previous?.events ?? []).map((e) => e.id));
    for (const event of pet.events) {
      if (!known.has(event.id)) {
        lifecycleListeners.forEach((listener) => listener({ petId: pet.id, type: event.type, at: event.at, live }));
      }
    }
  }
}

// ----- normalization of the saved family -----

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function normalizeLifecycle(raw: unknown): PetLifecycle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const state: LifeState =
    r.state === 'sick' || r.state === 'critical' || r.state === 'deceased' ? r.state : 'healthy';
  return {
    state,
    sickSince: typeof r.sickSince === 'string' ? r.sickSince : undefined,
    criticalSince: typeof r.criticalSince === 'string' ? r.criticalSince : undefined,
    diedAt: typeof r.diedAt === 'string' ? r.diedAt : undefined,
    exhausted: r.exhausted === true,
    lastEvaluatedAt: typeof r.lastEvaluatedAt === 'string' ? r.lastEvaluatedAt : nowIso(),
  };
}

function normalizePet(raw: unknown): PetRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  const profile = normalizePetProfile(r.profile);
  const equipped = (r.equipped && typeof r.equipped === 'object' ? r.equipped : {}) as Record<string, unknown>;
  const peakRaw = (r.peak && typeof r.peak === 'object' ? r.peak : {}) as Record<string, unknown>;
  const units = isFiniteNumber(r.growthUnits) && r.growthUnits >= 0 ? r.growthUnits : 0;
  const events: PetEvent[] = Array.isArray(r.events)
    ? r.events.filter(
        (e): e is PetEvent =>
          !!e && typeof (e as PetEvent).id === 'string' && typeof (e as PetEvent).at === 'string' && typeof (e as PetEvent).type === 'string'
      )
    : [];
  const revivalRaw = r.revival as { startedAt?: unknown; done?: unknown } | undefined;
  const alertsRaw = (r.alerts && typeof r.alerts === 'object' ? r.alerts : undefined) as Record<string, unknown> | undefined;
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name ? r.name : null,
    profile: { ...profile, pawTokens: 0 },
    growthUnits: units,
    tasksCounted: isFiniteNumber(r.tasksCounted) && r.tasksCounted >= 0 ? r.tasksCounted : 0,
    lifecycle: normalizeLifecycle(r.lifecycle),
    equipped: {
      hat: typeof equipped.hat === 'string' ? equipped.hat : null,
      bow: typeof equipped.bow === 'string' ? equipped.bow : null,
    },
    events,
    peak: {
      stageIndex: isFiniteNumber(peakRaw.stageIndex) ? peakRaw.stageIndex : getPeakFor(units, profile.paidStageIndex).stageIndex,
      level: isFiniteNumber(peakRaw.level) ? peakRaw.level : getPeakFor(units, profile.paidStageIndex).level,
    },
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : profile.adoptionDate,
    species: typeof r.species === 'string' && r.species ? r.species : undefined,
    retired:
      r.retired && typeof (r.retired as { since?: unknown }).since === 'string' && normalizeLifecycle(r.lifecycle).state !== 'deceased'
        ? { since: (r.retired as { since: string }).since }
        : undefined,
    revival:
      revivalRaw && typeof revivalRaw.startedAt === 'string'
        ? { startedAt: revivalRaw.startedAt, done: revivalRaw.done === true }
        : undefined,
    alerts: alertsRaw
      ? {
          sickNotifiedFor: typeof alertsRaw.sickNotifiedFor === 'string' ? alertsRaw.sickNotifiedFor : undefined,
          criticalNotifiedFor:
            typeof alertsRaw.criticalNotifiedFor === 'string' ? alertsRaw.criticalNotifiedFor : undefined,
        }
      : undefined,
  };
}

// Understands a saved family record WITHOUT loading it into the store (no state, no listeners, no writes). Used to read another
// profile's pets for the family picker (@/utils/family-profiles.ts).
export function parseSavedFamily(raw: unknown): FamilyState | null {
  return normalizeFamily(raw);
}

function normalizeFamily(raw: unknown): FamilyState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pets = (Array.isArray(r.pets) ? r.pets : []).map(normalizePet).filter((p): p is PetRecord => p !== null);
  if (pets.length === 0) return null;
  const wallet = (r.wallet && typeof r.wallet === 'object' ? r.wallet : {}) as Record<string, unknown>;
  const selected =
    typeof r.selectedPetId === 'string' && pets.some((p) => p.id === r.selectedPetId)
      ? r.selectedPetId
      : (pets.find(isLiving) ?? pets.find((p) => !p.retired) ?? pets[0]).id;
  return {
    version: 1,
    selectedPetId: selected,
    pets,
    wallet: { pawTokens: isFiniteNumber(wallet.pawTokens) && wallet.pawTokens >= 0 ? wallet.pawTokens : 0 },
    supplies: normalizeSupplies(r.supplies),
    toys: normalizeToys(r.toys),
    ...(Array.isArray(r.householdRewards) ? { householdRewards: r.householdRewards.filter((id): id is string => typeof id === 'string' && id.length > 0) } : {}),
  };
}

function normalizeToys(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object') {
    for (const [id, n] of Object.entries(raw as Record<string, unknown>)) {
      if (isFiniteNumber(n) && n >= 1) out[id] = Math.floor(n);
    }
  }
  return out;
}

function normalizeSupplies(raw: unknown): { washcloth: number; medicine: number } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const count = (v: unknown) => (isFiniteNumber(v) && v > 0 ? Math.floor(v) : 0);
  return { washcloth: count(r.washcloth), medicine: count(r.medicine) };
}

// ----- migration from the old single-pet saves -----

async function readJson(key: string): Promise<unknown> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as unknown) : null;
  } catch {
    return null;
  }
}

async function readString(key: string): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return typeof stored === 'string' && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

async function buildFirstPetFromLegacy(): Promise<{ pet: PetRecord; tokens: number }> {
  const legacyProfile = normalizePetProfile(await readJson(PET_PROFILE_STORAGE_KEY));
  const rawTasks = await readJson(LEGACY_TASKS_KEY);
  const today = todayISO();
  const taskCount = Array.isArray(rawTasks)
    ? getCompletedTaskCount(rawTasks.map((raw) => normalizeTask(raw, today)))
    : 0;

  let hat = await readString(LEGACY_HAT_KEY);
  let bow = await readString(LEGACY_BOW_KEY);
  const single = await readString(LEGACY_SINGLE_KEY);
  if (single && !hat && !bow) {
    const art = PET_ACCESSORY_ART[single];
    if (art) {
      if (art.slot === 'headHat') hat = single;
      else bow = single;
    }
  }

  const id = petIdFromAdoptionDate(legacyProfile.adoptionDate);
  const albumRaw = (await readJson(LEGACY_ALBUM_KEY)) as { peaks?: Record<string, { stageIndex?: number; level?: number }> } | null;
  const albumPeak = albumRaw?.peaks?.[id];

  const units = taskCount * GROWTH_UNITS_PER_TASK;
  const livePeak = getPeakFor(units, legacyProfile.paidStageIndex);
  const events: PetEvent[] = [makeEvent('adopted', legacyProfile.adoptionDate)];
  if (legacyProfile.hatchedAt) events.push(makeEvent('hatched', legacyProfile.hatchedAt));

  const pet: PetRecord = {
    id,
    name: null,
    profile: { ...legacyProfile, pawTokens: 0 },
    growthUnits: units,
    tasksCounted: taskCount,
    lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: nowIso() },
    equipped: { hat: hat && PET_ACCESSORY_ART[hat] ? hat : null, bow: bow && PET_ACCESSORY_ART[bow] ? bow : null },
    events,
    peak: {
      stageIndex: Math.max(livePeak.stageIndex, albumPeak?.stageIndex ?? 0),
      level: Math.max(livePeak.level, albumPeak?.level ?? 0),
    },
    createdAt: legacyProfile.adoptionDate,
  };
  return { pet, tokens: Math.max(0, legacyProfile.pawTokens) };
}

// ----- loading -----

// The first pet of a profile that has no pet family yet and no old save to bring over (every child profile):
// one brand-new egg, no tokens, nothing inherited.
function buildFreshFirstPet(): { pet: PetRecord; tokens: number } {
  const now = nowIso();
  const profile = createDefaultPetProfile();
  const pet: PetRecord = {
    id: newPetId(),
    name: null,
    profile: { ...profile, pawTokens: 0, adoptionDate: now, lastUpdatedAt: now },
    growthUnits: 0,
    tasksCounted: 0,
    lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: now },
    equipped: { hat: null, bow: null },
    events: [makeEvent('adopted', now)],
    peak: { stageIndex: 0, level: 1 },
    createdAt: now,
  };
  return { pet, tokens: 0 };
}

async function loadFamily(): Promise<FamilyState> {
  await ensureProfilesReady();
  // Family mode: a child's Pet Safety setting lives in the household record. It is started loading here and NOT waited for: until it has
  // loaded the rules are unknown, and unknown counts as Gentle (see @/utils/pet-safety.ts), so a pet is never lost to a setting that has not been
  // read yet. The next minute's tick (or any care action) evaluates again with the real rules, and a Classic pet that was due to pass away does
  // so then, at the time it was due.
  if (FAMILY_MODE_ENABLED) {
    try {
      void (require('@/utils/household') as typeof import('@/utils/household')).ensureHouseholdLoaded().catch(() => {});
    } catch {
      // unknown settings fail safe
    }
  }
  const familyKey = scopedKey(FAMILY_KEY_NAME);
  const legacyProfile = isActiveProfileLegacy();
  let stored: string | null = null;
  let readFailed = false;
  try {
    stored = await AsyncStorage.getItem(familyKey);
  } catch {
    readFailed = true;
  }

  let loaded: FamilyState | null = null;
  if (stored) {
    try {
      loaded = normalizeFamily(JSON.parse(stored));
    } catch {
      loaded = null;
    }
    if (!loaded) {
      // Unreadable family record: keep a copy before anything is rewritten.
      AsyncStorage.setItem(`${familyKey}.corrupt-${Date.now()}`, stored).catch(() => {});
    }
  }

  const now = new Date();
  let migrated = false;
  if (!loaded) {
    const { pet, tokens } = legacyProfile ? await buildFirstPetFromLegacy() : buildFreshFirstPet();
    loaded = { version: 1, selectedPetId: pet.id, pets: [pet], wallet: { pawTokens: tokens } };
    migrated = true;
  }

  // Catch every living pet up to now. Migrated pets use "grace": a need that
  // is already 0 starts its sickness clock now, so nothing can die on the
  // first launch after this update.
  const before = loaded.pets;
  const pets = loaded.pets.map((pet) => advancePet(pet, now, migrated));
  const next: FamilyState = { ...loaded, pets };
  state = next;
  emitNotices(before, pets, false);
  if (migrated ? !readFailed : pets.some((p, i) => p.events.length !== before[i].events.length)) {
    void persistNow();
  }
  return next;
}

export function ensureFamilyLoaded(): Promise<FamilyState> {
  if (state) return Promise.resolve(state);
  if (!loadPromise) {
    loadPromise = trackOperation(loadFamily()).finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

export function peekFamily(): FamilyState | null {
  return state;
}

// ----- subscriptions -----

export function subscribeToFamily(listener: (s: FamilyState) => void): () => void {
  familyListeners.add(listener);
  return () => {
    familyListeners.delete(listener);
  };
}

export function subscribeToSelectedPetProfile(listener: (p: PetProfile) => void): () => void {
  profileListeners.add(listener);
  return () => {
    profileListeners.delete(listener);
  };
}

export function subscribeToLifecycle(listener: (n: LifecycleNotice) => void): () => void {
  lifecycleListeners.add(listener);
  return () => {
    lifecycleListeners.delete(listener);
  };
}

// ----- time -----

function meaningfullyDifferent(a: PetRecord, b: PetRecord): boolean {
  return (
    a.lifecycle.state !== b.lifecycle.state ||
    a.lifecycle.exhausted !== b.lifecycle.exhausted ||
    a.events.length !== b.events.length ||
    a.profile.isSleeping !== b.profile.isSleeping ||
    Math.round(a.profile.hunger) !== Math.round(b.profile.hunger) ||
    Math.round(a.profile.cleanliness) !== Math.round(b.profile.cleanliness) ||
    Math.round(a.profile.happiness) !== Math.round(b.profile.happiness) ||
    Math.round(a.profile.energy) !== Math.round(b.profile.energy)
  );
}

// Brings every living pet up to date at `now` (needs, sleep, health). The
// single place time passes for the whole family. Only saves and re-renders
// screens when something visible actually changed.
export function advanceAllPets(now: Date = new Date(), live = true): void {
  if (!state) return;
  const before = state.pets;
  const pets = before.map((pet) => advancePet(pet, now));
  const changed = pets.some((p, i) => meaningfullyDifferent(before[i], p));
  if (changed) {
    emitNotices(before, pets, live);
    setState({ ...state, pets });
  } else {
    // Keep the fresh timestamps in memory only.
    state = { ...state, pets };
  }
}

export async function advanceSelectedPetAndGetProfile(now: Date = new Date()): Promise<PetProfile> {
  const s = await ensureFamilyLoaded();
  advanceAllPets(now, true);
  return selectedProfile(state ?? s);
}

// ----- selected-pet profile API (used through pet-profile.ts) -----

export async function getPetProfileForSelectedPet(): Promise<PetProfile> {
  const s = await ensureFamilyLoaded();
  return selectedProfile(state ?? s);
}

export function savePetProfileForSelectedPet(profile: PetProfile): void {
  // A profile read in an earlier profile session (the person left and someone else came) is never saved into the one open now.
  const readIn = (profile as SessionTagged)[SESSION_TAG];
  if (readIn !== undefined && readIn !== captureProfileOwner().generation) return;
  if (!state) {
    const owner = captureProfileOwner();
    void ensureFamilyLoaded()
      .then(() => {
        if (isProfileOwner(owner)) savePetProfileForSelectedPet(profile);
      })
      .catch(() => {});
    return;
  }
  const s = state;
  const selected = getSelectedPet(s);
  const now = new Date();
  let pets = s.pets;
  let petChanged = false;

  // A profile that was read for a DIFFERENT pet (for example a screen that is
  // still holding the previous pet's data while the player switches) must never
  // overwrite the selected pet: only the shared wallet may change in that case.
  const belongsToSelected = profile.petId === undefined || profile.petId === selected.id;
  // A deceased pet's care data is frozen: only the shared wallet may change.
  if (belongsToSelected && isLiving(selected) && comparable(stripExtras(profile)) !== comparable(selected.profile)) {
    let updated: PetRecord = {
      ...selected,
      profile: { ...stripExtras(profile), pawTokens: 0, lastUpdatedAt: now.toISOString() },
    };
    updated = reevaluatePet(updated, now);
    pets = pets.map((p) => (p.id === selected.id ? updated : p));
    petChanged = true;
    emitNotices([selected], [updated], true);
  }

  // The profile's balance is a CHANGE against the balance it was read with (see WALLET_BASE). A profile with no such note (built by hand)
  // keeps the older meaning: its balance is the new balance.
  const base = (profile as WalletTagged)[WALLET_BASE];
  const nextTokens = !isFiniteNumber(profile.pawTokens)
    ? s.wallet.pawTokens
    : base === undefined
      ? Math.max(0, profile.pawTokens)
      : Math.max(0, s.wallet.pawTokens + (profile.pawTokens - base));
  const walletChanged = nextTokens !== s.wallet.pawTokens;
  if (!petChanged && !walletChanged) return;
  setState({ ...s, pets, wallet: walletChanged ? { pawTokens: nextTokens } : s.wallet });
}

// ----- selection, equipment -----

export function selectPet(petId: string): void {
  if (!state || state.selectedPetId === petId) return;
  // A pet retired in Pawadise can't be selected: it is frozen until it is brought home.
  const target = state.pets.find((p) => p.id === petId);
  if (!target || target.retired) return;
  setState({ ...state, selectedPetId: petId });
}

export async function getEquippedForSelectedPet(): Promise<{ hat: string | null; bow: string | null }> {
  const s = await ensureFamilyLoaded();
  return { ...getSelectedPet(state ?? s).equipped };
}

export function getEquippedForPet(s: FamilyState, petId: string): { hat: string | null; bow: string | null } {
  return s.pets.find((p) => p.id === petId)?.equipped ?? { hat: null, bow: null };
}

export function setSelectedPetEquipped(slot: 'hat' | 'bow', id: string | null): Promise<void> {
  return trackOperation(doSetSelectedPetEquipped(slot, id));
}

async function doSetSelectedPetEquipped(slot: 'hat' | 'bow', id: string | null): Promise<void> {
  const s = await ensureFamilyLoaded();
  const current = state ?? s;
  const selected = getSelectedPet(current);
  // A deceased pet keeps exactly the accessories it was wearing.
  if (!isLiving(selected) || selected.equipped[slot] === id) return;
  const updated: PetRecord = { ...selected, equipped: { ...selected.equipped, [slot]: id } };
  setState({ ...current, pets: current.pets.map((p) => (p.id === selected.id ? updated : p)) });
}

// ----- wallet and rewards -----

export function getWalletBalance(): number {
  return state?.wallet.pawTokens ?? 0;
}

// A household task's reward, added ONCE (see @/utils/household-rewards.ts). The credit and the note "this task was paid" change in the same
// state and are saved in the same write, and the result is only 'paid' once that write reached storage:
//  'paid'    - added now and saved
//  'already' - this task had been added before (nothing changes)
//  'failed'  - the family is not loaded, the amount is not valid, or the write did not reach storage. If the credit was made in memory it stays,
//              with its note, and the save is retried by the next save (or the profile switch); asking again never adds it a second time.
export async function creditHouseholdReward(taskId: string, amount: number): Promise<'paid' | 'already' | 'failed'> {
  const owner = captureProfileOwner();
  const loaded = await ensureFamilyLoaded();
  if (!isProfileOwner(owner)) return 'failed';
  const s = state ?? loaded;
  if (!taskId || !Number.isInteger(amount) || amount <= 0) return 'failed';
  // Noted as given: make sure the record holding the note and the credit really is saved (a write that failed earlier is retried here), so "already"
  // is only reported for a credit that is on storage.
  if ((s.householdRewards ?? []).includes(taskId)) return (await persistNow()) ? 'already' : 'failed';
  setState({ ...s, wallet: { pawTokens: s.wallet.pawTokens + amount }, householdRewards: [...(s.householdRewards ?? []), taskId] });
  return (await writeChain) ? 'paid' : 'failed';
}

export function addToWallet(amount: number): void {
  if (!state || !(amount > 0)) return;
  setState({ ...state, wallet: { pawTokens: state.wallet.pawTokens + amount } });
}

// Number of living pets right now (for the token reward tier).
export function getLivingPetCount(): number {
  return state ? getLivingPets(state).length : 1;
}

// Shares `taskCount` newly completed tasks' growth between the living pets.
// Each healthy living pet receives an equal part of every task (kept as
// exact whole units, so nothing is lost to rounding); sick, critical and
// deceased pets receive none and their part is not given to anyone else.
// Also records when an Egg hatches and keeps each pet's peak stage.
export function awardGrowthForTasks(taskCount: number, now: Date = new Date()): void {
  if (!state || !(taskCount > 0)) return;
  const living = getLivingPets(state);
  if (living.length === 0) return;
  const share = Math.floor(GROWTH_UNITS_PER_TASK / living.length);
  const nowStamp = now.toISOString();

  const pets = state.pets.map((pet) => {
    if (!isLiving(pet)) return pet;
    let next: PetRecord = { ...pet, tasksCounted: pet.tasksCounted + taskCount };
    if (pet.lifecycle.state === 'healthy') {
      const beforeCount = Math.floor(pet.growthUnits / GROWTH_UNITS_PER_TASK);
      const units = pet.growthUnits + share * taskCount;
      next = { ...next, growthUnits: units };
      const afterCount = Math.floor(units / GROWTH_UNITS_PER_TASK);
      if (beforeCount < TASKS_PER_STAGE && afterCount >= TASKS_PER_STAGE && !next.profile.hatchedAt) {
        // The egg just hatched — record the moment (the pet's "Born On").
        next = addEvents(
          { ...next, profile: { ...next.profile, hatchedAt: nowStamp } },
          [makeEvent('hatched', nowStamp)]
        );
      }
      const peak = getPeakFor(units, next.profile.paidStageIndex);
      next = {
        ...next,
        peak: {
          stageIndex: Math.max(next.peak.stageIndex, peak.stageIndex),
          level: Math.max(next.peak.level, peak.level),
        },
      };
    }
    return next;
  });
  setState({ ...state, pets });
}

// Called after a paid growth upgrade so the peak stays current.
export function refreshPeak(petId: string): void {
  if (!state) return;
  const pets = state.pets.map((pet) => {
    if (pet.id !== petId) return pet;
    const peak = getPeakFor(pet.growthUnits, pet.profile.paidStageIndex);
    if (peak.stageIndex <= pet.peak.stageIndex && peak.level <= pet.peak.level) return pet;
    return {
      ...pet,
      peak: {
        stageIndex: Math.max(pet.peak.stageIndex, peak.stageIndex),
        level: Math.max(pet.peak.level, peak.level),
      },
    };
  });
  setState({ ...state, pets });
}

// ----- adoption -----

export type AdoptResult =
  | { ok: true; petId: string }
  | { ok: false; reason: 'limit' | 'busy' | 'storage' };

let adopting = false;

// Adds a new Egg to the family and selects it. Existing pets, tasks, tokens
// and history are untouched. Safe against repeated taps; if the save fails the
// new pet is removed again.
export function adoptNewEgg(): Promise<AdoptResult> {
  return trackOperation(doAdoptNewEgg());
}

async function doAdoptNewEgg(): Promise<AdoptResult> {
  if (adopting) return { ok: false, reason: 'busy' };
  adopting = true;
  try {
    const before = await ensureFamilyLoaded();
    const current = state ?? before;
    if (!canAdoptMore(current)) return { ok: false, reason: 'limit' };
    const now = nowIso();
    const profile = createDefaultPetProfile();
    const pet: PetRecord = {
      id: newPetId(),
      name: null,
      profile: { ...profile, pawTokens: 0, adoptionDate: now, lastUpdatedAt: now },
      growthUnits: 0,
      tasksCounted: 0,
      lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: now },
      equipped: { hat: null, bow: null },
      events: [makeEvent('adopted', now)],
      peak: { stageIndex: 0, level: 1 },
      createdAt: now,
    };
    const previous = current;
    state = { ...current, pets: [...current.pets, pet], selectedPetId: pet.id };
    const saved = await persistNow();
    if (!saved) {
      state = previous;
      notify();
      return { ok: false, reason: 'storage' };
    }
    notify();
    return { ok: true, petId: pet.id };
  } finally {
    adopting = false;
  }
}

// ----- resurrection -----

export type ResurrectResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'busy' | 'not-deceased' | 'no-slot' | 'insufficient' | 'storage';
      missing?: number;
    };

const resurrecting = new Set<string>();

// Brings a deceased pet back for exactly RESURRECTION_COST Paw Tokens. The
// charge and the revival are ONE atomic save: either both happen or neither.
// The pet keeps its identity, name, birthday, stage, level, accessories and
// history; needs are restored to 75; the sickness clocks are cleared; no
// growth is granted for the time it was gone. The truck animation that
// follows is purely visual (see `revival`) and can never affect the payment.
export function resurrectPet(petId: string): Promise<ResurrectResult> {
  return trackOperation(doResurrectPet(petId));
}

async function doResurrectPet(petId: string): Promise<ResurrectResult> {
  if (resurrecting.has(petId)) return { ok: false, reason: 'busy' };
  resurrecting.add(petId);
  try {
    const before = await ensureFamilyLoaded();
    const current = state ?? before;
    const pet = current.pets.find((p) => p.id === petId);
    if (!pet || pet.lifecycle.state !== 'deceased') return { ok: false, reason: 'not-deceased' };
    if (!canAdoptMore(current)) return { ok: false, reason: 'no-slot' };
    if (current.wallet.pawTokens < RESURRECTION_COST) {
      return { ok: false, reason: 'insufficient', missing: RESURRECTION_COST - current.wallet.pawTokens };
    }

    const now = nowIso();
    const restored = RESURRECTION_RESTORED_NEED_VALUE;
    let revived: PetRecord = {
      ...pet,
      profile: {
        ...pet.profile,
        hunger: restored,
        cleanliness: restored,
        happiness: restored,
        energy: restored,
        isSleeping: false,
        isSick: false,
        poopPiles: [],
        needsBath: false,
        lastUpdatedAt: now,
      },
      lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: now },
      revival: { startedAt: now, done: false },
      alerts: undefined,
    };
    revived = addEvents(revived, [makeEvent('resurrected', now)]);

    const previous = current;
    state = {
      ...current,
      wallet: { pawTokens: current.wallet.pawTokens - RESURRECTION_COST },
      pets: current.pets.map((p) => (p.id === petId ? revived : p)),
    };
    const saved = await persistNow();
    if (!saved) {
      // Nothing was stored, so nothing was charged: undo the in-memory change too.
      state = previous;
      notify();
      return { ok: false, reason: 'storage' };
    }
    emitNotices([pet], [revived], true);
    notify();
    return { ok: true };
  } finally {
    resurrecting.delete(petId);
  }
}

// Marks the truck animation as finished (or skipped). Safe to call twice.
export function completeRevivalAnimation(petId: string): void {
  if (!state) return;
  const pet = state.pets.find((p) => p.id === petId);
  if (!pet?.revival || pet.revival.done) return;
  setState({
    ...state,
    pets: state.pets.map((p) => (p.id === petId ? { ...p, revival: { ...pet.revival!, done: true } } : p)),
  });
}

// ----- Pet Pawadise: retiring a pet and bringing it home -----

export type PawadiseResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'busy' | 'not-found' | 'not-healthy' | 'egg' | 'last-pet' | 'already-retired' | 'not-retired' | 'no-slot' | 'storage';
    };

const pawadiseBusy = new Set<string>();

// Sends a HEALTHY, hatched pet to Pet Pawadise. It only sets a flag and adds a history event: the pet's
// identity, species, name, stage, accessories, growth, needs and history stay on the same record, so
// nothing can be duplicated or lost, and everything is ONE atomic save (rolled back if storage fails).
// While retired the pet is frozen (see PetRecord.retired) and its active slot is freed. The player must
// keep at least one other active pet at home so Home always has a pet to show.
export function retirePet(petId: string): Promise<PawadiseResult> {
  return trackOperation(doRetirePet(petId));
}

async function doRetirePet(petId: string): Promise<PawadiseResult> {
  if (pawadiseBusy.has(petId)) return { ok: false, reason: 'busy' };
  pawadiseBusy.add(petId);
  try {
    const before = await ensureFamilyLoaded();
    const current = state ?? before;
    const found = current.pets.find((p) => p.id === petId);
    if (!found) return { ok: false, reason: 'not-found' };
    if (found.retired) return { ok: false, reason: 'already-retired' };
    if (found.revival && !found.revival.done) return { ok: false, reason: 'busy' };
    const now = new Date();
    // Settle the pet at this exact moment first, so "healthy" really is healthy right now.
    const pet = advancePet(found, now);
    if (pet.lifecycle.state !== 'healthy') return { ok: false, reason: 'not-healthy' };
    if (!isPetHatched(pet)) return { ok: false, reason: 'egg' };
    const others = current.pets.filter((p) => p.id !== petId && isLiving(p));
    if (others.length === 0) return { ok: false, reason: 'last-pet' };

    const stamp = now.toISOString();
    const retired = addEvents({ ...pet, retired: { since: stamp } }, [makeEvent('retired', stamp)]);
    const previous = current;
    state = {
      ...current,
      selectedPetId: current.selectedPetId === petId ? others[0].id : current.selectedPetId,
      pets: current.pets.map((p) => (p.id === petId ? retired : p)),
    };
    const saved = await persistNow();
    if (!saved) {
      state = previous;
      notify();
      return { ok: false, reason: 'storage' };
    }
    endToySession(petId);
    emitNotices([found], [retired], true);
    notify();
    return { ok: true };
  } finally {
    pawadiseBusy.delete(petId);
  }
}

// Brings a retired pet home for free when an active slot is free. Timers resume from the preserved
// state: the time spent in Pawadise is never counted (needs and health clocks restart at this moment,
// and the poop schedule is re-rolled), and the pet is selected so the player sees it.
export function returnPetHome(petId: string): Promise<PawadiseResult> {
  return trackOperation(doReturnPetHome(petId));
}

async function doReturnPetHome(petId: string): Promise<PawadiseResult> {
  if (pawadiseBusy.has(petId)) return { ok: false, reason: 'busy' };
  pawadiseBusy.add(petId);
  try {
    const before = await ensureFamilyLoaded();
    const current = state ?? before;
    const pet = current.pets.find((p) => p.id === petId);
    if (!pet) return { ok: false, reason: 'not-found' };
    if (!pet.retired) return { ok: false, reason: 'not-retired' };
    if (!canAdoptMore(current)) return { ok: false, reason: 'no-slot' };

    const stamp = nowIso();
    const { retired: _retired, ...rest } = pet;
    const home: PetRecord = addEvents(
      {
        ...rest,
        profile: { ...pet.profile, lastUpdatedAt: stamp, nextPoopEventAt: '' },
        lifecycle: { ...pet.lifecycle, lastEvaluatedAt: stamp },
      },
      [makeEvent('returned', stamp)]
    );
    const previous = current;
    state = { ...current, selectedPetId: petId, pets: current.pets.map((p) => (p.id === petId ? home : p)) };
    const saved = await persistNow();
    if (!saved) {
      state = previous;
      notify();
      return { ok: false, reason: 'storage' };
    }
    emitNotices([pet], [home], true);
    notify();
    return { ok: true };
  } finally {
    pawadiseBusy.delete(petId);
  }
}

// ----- alert bookkeeping (see pet-alerts.ts) -----

export function markAlertSent(petId: string, kind: 'sick' | 'critical', episodeKey: string): void {
  if (!state) return;
  const pet = state.pets.find((p) => p.id === petId);
  if (!pet) return;
  const alerts = { ...(pet.alerts ?? {}) };
  if (kind === 'sick') alerts.sickNotifiedFor = episodeKey;
  else alerts.criticalNotifiedFor = episodeKey;
  // Bookkeeping only: persist, but don't re-render screens.
  state = { ...state, pets: state.pets.map((p) => (p.id === petId ? { ...p, alerts } : p)) };
  void persistNow();
}

// ----- developer test helpers (see DEV_ENABLE_LIFECYCLE_TEST_CONTROLS) -----

export function devSetSelectedNeed(need: 'hunger' | 'cleanliness' | 'happiness' | 'energy', value: number): void {
  if (!state || !GAMEPLAY_CHEATS_ALLOWED) return;
  const selected = getSelectedPet(state);
  if (!isLiving(selected)) return;
  const now = new Date();
  let updated: PetRecord = {
    ...selected,
    profile: { ...selected.profile, [need]: value, lastUpdatedAt: now.toISOString() },
  };
  updated = reevaluatePet(updated, now);
  emitNotices([selected], [updated], true);
  setState({ ...state, pets: state.pets.map((p) => (p.id === selected.id ? updated : p)) });
}

// Moves the sickness start earlier so the 24h / 96h deadlines can be tested
// without waiting. Only affects a pet that is already sick or critical.
export function devShiftSicknessBack(hours: number): void {
  if (!state || !GAMEPLAY_CHEATS_ALLOWED) return;
  const selected = getSelectedPet(state);
  if (!selected.lifecycle.sickSince || !isLiving(selected)) return;
  const earlier = new Date(new Date(selected.lifecycle.sickSince).getTime() - hours * 3600 * 1000).toISOString();
  const shifted: PetRecord = {
    ...selected,
    lifecycle: { ...selected.lifecycle, sickSince: earlier, state: 'sick', criticalSince: undefined },
  };
  const now = new Date();
  const advanced = advancePet({ ...shifted, lifecycle: { ...shifted.lifecycle, lastEvaluatedAt: now.toISOString() } }, now);
  emitNotices([selected], [advanced], true);
  setState({ ...state, pets: state.pets.map((p) => (p.id === selected.id ? advanced : p)) });
}

export type DevHealthState = 'healthy' | 'sick' | 'critical' | 'deceased';
export type DevHealthStateResult = { ok: true } | { ok: false; reason: string };

// Developer test helper (development builds only; see DEV_ENABLE_LIFECYCLE_TEST_CONTROLS and the
// Alerts -> Developer Tools -> Health and Lifecycle Testing -> "Developer Health State" section).
// Sets the SELECTED pet's REAL, saved health state in any direction (including Deceased -> Sick /
// Critical / Healthy) without waiting for the timers. It never charges Paw Tokens, never starts the
// resurrection animation (`revival` is left exactly as it was) and never sends alerts; the pet's
// identity, name, stage, growth, accessories, history and every other saved field are kept. The
// normal sickness / death / paid-resurrection rules are untouched: from here the pet follows them
// again (a Sick pet turns Critical after 24h, a Critical one passes away 96h after it fell sick).
export function devSetSelectedHealthState(target: DevHealthState): DevHealthStateResult {
  if (!__DEV__ || !state || !GAMEPLAY_CHEATS_ALLOWED) return { ok: false, reason: 'Developer tools are only available in development builds.' };
  const selected = getSelectedPet(state);
  const now = new Date();
  const nowStamp = now.toISOString();
  const isEgg = Math.floor(selected.growthUnits / GROWTH_UNITS_PER_TASK) < TASKS_PER_STAGE && !selected.profile.hatchedAt;

  if (target !== 'healthy' && isEgg) {
    return { ok: false, reason: "An Egg can't get sick or pass away — hatch it first with \"+10 growth\" or Set Actual Stage." };
  }
  if (target !== 'deceased' && !isLiving(selected) && !canAdoptMore(state)) {
    return { ok: false, reason: 'No free pet slot: three other pets are already living.' };
  }
  if (selected.lifecycle.state === target) return { ok: true };

  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600 * 1000).toISOString();
  const profile = { ...selected.profile, lastUpdatedAt: nowStamp };
  let lifecycle: PetRecord['lifecycle'];
  let event: PetEventType | null = null;

  if (target === 'healthy') {
    // A healthy pet has comfortable needs; clear the old illness timers and any pending alert.
    profile.hunger = 100;
    profile.cleanliness = 100;
    profile.happiness = 100;
    profile.energy = 100;
    profile.isSleeping = false;
    profile.isSick = false;
    profile.nextPoopEventAt = '';
    lifecycle = { state: 'healthy', exhausted: false, lastEvaluatedAt: nowStamp };
    event = selected.lifecycle.state === 'deceased' ? null : 'recovered';
  } else {
    // A sick / critical pet that already has Hunger, Cleanliness and Happiness all at 50+ would
    // simply recover on the next check, so make sure at least one need is low enough to stay ill.
    if (target !== 'deceased' && profile.hunger >= 50 && profile.cleanliness >= 50 && profile.happiness >= 50) {
      profile.happiness = 25;
    }
    if (target === 'sick') {
      lifecycle = { state: 'sick', sickSince: nowStamp, exhausted: false, lastEvaluatedAt: nowStamp };
      event = 'sick';
    } else if (target === 'critical') {
      // 24h in, so Critical's countdown (72h to go) is consistent with the real rules.
      const sickSince = hoursAgo(SICK_TO_CRITICAL_HOURS);
      lifecycle = {
        state: 'critical',
        sickSince,
        criticalSince: nowStamp,
        exhausted: false,
        lastEvaluatedAt: nowStamp,
      };
      event = 'critical';
    } else {
      lifecycle = {
        state: 'deceased',
        sickSince: selected.lifecycle.sickSince,
        criticalSince: selected.lifecycle.criticalSince,
        diedAt: nowStamp,
        exhausted: false,
        lastEvaluatedAt: nowStamp,
      };
      event = 'died';
    }
  }

  let updated: PetRecord = { ...selected, profile, lifecycle, alerts: undefined };
  if (event) updated = addEvents(updated, [makeEvent(event, nowStamp)]);
  // No emitNotices: a state set by hand must not raise alerts or flashes.
  setState({ ...state, pets: state.pets.map((p) => (p.id === selected.id ? updated : p)) });
  return { ok: true };
}

// ----- pet care supplies (Shop -> Pet Care Supplies) -----

export type CareSupplies = { washcloth: number; medicine: number };
export type CareSupplyKind = keyof CareSupplies;
export type CareSupplyResult =
  | { ok: true }
  | { ok: false; reason: 'insufficient' | 'deceased' | 'not-eligible' | 'none-left' | 'not-needed' | 'unavailable' };

const NO_SUPPLIES: CareSupplies = { washcloth: 0, medicine: 0 };

export function getCareSupplies(s: FamilyState | null = state): CareSupplies {
  return s?.supplies ?? NO_SUPPLIES;
}

function withSupplies(s: FamilyState, next: CareSupplies): FamilyState {
  return { ...s, supplies: { washcloth: Math.max(0, next.washcloth), medicine: Math.max(0, next.medicine) } };
}

// Buys one care supply: Paw Tokens are deducted and the item added in ONE save, so both
// happen exactly once or not at all. Not available while the selected pet has passed away.
export function buyCareSupply(kind: CareSupplyKind): CareSupplyResult {
  if (!state) return { ok: false, reason: 'unavailable' };
  if (!isLiving(getSelectedPet(state))) return { ok: false, reason: 'deceased' };
  const price = kind === 'washcloth' ? WASHCLOTH_PRICE : MEDICINE_PRICE;
  if (state.wallet.pawTokens < price) return { ok: false, reason: 'insufficient' };
  const have = getCareSupplies(state);
  setState({
    ...withSupplies(state, { ...have, [kind]: have[kind] + 1 }),
    wallet: { pawTokens: state.wallet.pawTokens - price },
  });
  return { ok: true };
}

// Uses up ONE washcloth after a COMPLETED wipe-down of `petId` (never on cancel / leaving early).
export function consumeWashcloth(petId: string): CareSupplyResult {
  if (!state) return { ok: false, reason: 'unavailable' };
  const pet = state.pets.find((p) => p.id === petId);
  if (!pet || state.selectedPetId !== petId || !isLiving(pet)) return { ok: false, reason: 'not-eligible' };
  const have = getCareSupplies(state);
  if (have.washcloth < 1) return { ok: false, reason: 'none-left' };
  setState(withSupplies(state, { ...have, washcloth: have.washcloth - 1 }));
  return { ok: true };
}

// Pet Medicine for the SELECTED pet: +25 Hunger and +25 Happiness (capped at 100), one item used.
// Only a Sick or Critical, hatched pet can take it. It does not cure anything itself — the normal
// recovery rule (Hunger, Cleanliness and Happiness all 50+) is simply re-checked afterwards.
export function giveMedicine(petId: string): CareSupplyResult {
  if (!state) return { ok: false, reason: 'unavailable' };
  const selected = getSelectedPet(state);
  if (selected.id !== petId) return { ok: false, reason: 'not-eligible' };
  if (!isLiving(selected)) return { ok: false, reason: 'deceased' };
  const have = getCareSupplies(state);
  if (have.medicine < 1) return { ok: false, reason: 'none-left' };
  const now = new Date();
  const current = advancePet(selected, now);
  const ill = current.lifecycle.state === 'sick' || current.lifecycle.state === 'critical';
  const egg = Math.floor(current.growthUnits / GROWTH_UNITS_PER_TASK) < TASKS_PER_STAGE && !current.profile.hatchedAt;
  if (!ill || egg) return { ok: false, reason: 'not-needed' };
  const profile = {
    ...current.profile,
    hunger: Math.min(100, current.profile.hunger + MEDICINE_NEED_BOOST),
    happiness: Math.min(100, current.profile.happiness + MEDICINE_NEED_BOOST),
    lastUpdatedAt: now.toISOString(),
  };
  const updated = reevaluatePet({ ...current, profile }, now);
  emitNotices([selected], [updated], true);
  setState({
    ...withSupplies(state, { ...have, medicine: have.medicine - 1 }),
    pets: state.pets.map((p) => (p.id === selected.id ? updated : p)),
  });
  return { ok: true };
}

// ----- toys (Shop -> Toys) -----

export type ToyResult =
  | { ok: true; happiness?: number }
  | { ok: false; reason: 'insufficient' | 'deceased' | 'egg' | 'unknown-toy' | 'none-left' | 'busy' | 'not-eligible' | 'unavailable' };

const NO_TOYS: Record<string, number> = {};

export function getToyCounts(s: FamilyState | null = state): Record<string, number> {
  return s?.toys ?? NO_TOYS;
}

export function isPetHatched(pet: PetRecord): boolean {
  return Math.floor(pet.growthUnits / GROWTH_UNITS_PER_TASK) >= TASKS_PER_STAGE || !!pet.profile.hatchedAt;
}

// Buys one toy: Paw Tokens are deducted and the toy added in ONE save (exactly once, or not at all).
// Healthy, Sick and Critical pets can shop for toys; a passed-away pet cannot.
export function buyToy(toyId: string): ToyResult {
  if (!state) return { ok: false, reason: 'unavailable' };
  const toy = getToy(toyId);
  if (!toy) return { ok: false, reason: 'unknown-toy' };
  if (!isLiving(getSelectedPet(state))) return { ok: false, reason: 'deceased' };
  if (state.wallet.pawTokens < toy.price) return { ok: false, reason: 'insufficient' };
  const have = getToyCounts(state);
  setState({
    ...state,
    toys: { ...have, [toyId]: (have[toyId] ?? 0) + 1 },
    wallet: { pawTokens: state.wallet.pawTokens - toy.price },
  });
  return { ok: true };
}

// Uses ONE toy on the SELECTED pet: +Happiness (capped at 100), one toy used up and a temporary
// 30-second toy session started — all decided up front, so a repeat tap while a session is running
// (or with none left) changes nothing. Allowed for Healthy, Sick and Critical hatched pets only.
export function playWithToy(petId: string, toyId: string): ToyResult {
  if (!state) return { ok: false, reason: 'unavailable' };
  const toy = getToy(toyId);
  if (!toy) return { ok: false, reason: 'unknown-toy' };
  const selected = getSelectedPet(state);
  if (selected.id !== petId) return { ok: false, reason: 'not-eligible' };
  if (!isLiving(selected)) return { ok: false, reason: 'deceased' };
  if (!isPetHatched(selected)) return { ok: false, reason: 'egg' };
  const have = getToyCounts(state);
  if ((have[toyId] ?? 0) < 1) return { ok: false, reason: 'none-left' };
  if (getToySession(petId)) return { ok: false, reason: 'busy' };
  const now = new Date();
  const current = advancePet(selected, now);
  const profile = {
    ...current.profile,
    happiness: Math.min(100, current.profile.happiness + toy.happiness),
    lastUpdatedAt: now.toISOString(),
  };
  const updated = reevaluatePet({ ...current, profile }, now);
  emitNotices([selected], [updated], true);
  const left = { ...have, [toyId]: have[toyId] - 1 };
  if (left[toyId] < 1) delete left[toyId];
  setState({ ...state, toys: left, pets: state.pets.map((p) => (p.id === selected.id ? updated : p)) });
  startToySession(petId, toyId);
  return { ok: true, happiness: toy.happiness };
}

// ----- display helper -----

// "Kitty 1", "Kitty 2"... in adoption order, or the pet's name if it has one.
// A UI label only — it is not stored, so no name is ever invented.
export function getPetLabel(pet: PetRecord, all: PetRecord[]): string {
  if (pet.name) return pet.name;
  const order = [...all].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return tr('petLabelKitty', { n: order.findIndex((p) => p.id === pet.id) + 1 });
}

// Developer test helper: adds REAL growth (as completed-task credit) to the
// SELECTED pet only — for example to take a new Egg past the Egg stage so its
// care, sickness and death rules can be tested. Unlike the Pet Stage Preview
// this changes the pet's actual growth, so it is only offered as an explicit,
// labelled button on the Pet Care & Alerts page's Developer Tools. Records the
// hatch date if the Egg hatches, exactly like a real task would.
export function devAddGrowthToSelectedPet(tasks: number): void {
  if (!state || !GAMEPLAY_CHEATS_ALLOWED || !(tasks > 0)) return;
  const selected = getSelectedPet(state);
  if (!isLiving(selected) || selected.lifecycle.state !== 'healthy') return;
  const now = new Date();
  const beforeCount = Math.floor(selected.growthUnits / GROWTH_UNITS_PER_TASK);
  const units = selected.growthUnits + tasks * GROWTH_UNITS_PER_TASK;
  const afterCount = Math.floor(units / GROWTH_UNITS_PER_TASK);
  let next: PetRecord = { ...selected, growthUnits: units };
  if (beforeCount < TASKS_PER_STAGE && afterCount >= TASKS_PER_STAGE && !next.profile.hatchedAt) {
    next = addEvents(
      { ...next, profile: { ...next.profile, hatchedAt: now.toISOString() } },
      [makeEvent('hatched', now.toISOString())]
    );
  }
  const peak = getPeakFor(units, next.profile.paidStageIndex);
  next = {
    ...next,
    peak: {
      stageIndex: Math.max(next.peak.stageIndex, peak.stageIndex),
      level: Math.max(next.peak.level, peak.level),
    },
  };
  setState({ ...state, pets: state.pets.map((p) => (p.id === selected.id ? next : p)) });
}

// Developer test helper ("Dev: Set Actual Stage"): changes the SELECTED pet's
// REAL growth stage, unlike the display-only Pet Stage Preview. It uses the
// normal stage rules instead of a separate override: the pet's growth credit
// is set to the stage's task threshold (Egg 0, Hatchling 10, Baby 20, Young
// 30, Adult 40 completed tasks) and, for Young/Adult, the paid stage is set
// to match (it is reset to 0 for lower stages, as for an unpaid pet), so every
// screen and every age check derives the same stage. No Paw Tokens, completed
// tasks or award records are created or removed; the pet's id, needs, health,
// equipment, purchases and event history are untouched. Records a hatch date
// (and the "hatched" album event) only if the pet has never hatched; the
// "highest stage reached" never goes down. Persists like any other save.
export function devSetSelectedPetActualStage(stageIndex: number): void {
  if (!state || !GAMEPLAY_CHEATS_ALLOWED || !Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex > 4) return;
  const selected = getSelectedPet(state);
  if (!isLiving(selected)) return;
  const now = new Date();
  const units = stageIndex * TASKS_PER_STAGE * GROWTH_UNITS_PER_TASK;
  let next: PetRecord = {
    ...selected,
    growthUnits: units,
    profile: { ...selected.profile, paidStageIndex: stageIndex >= 3 ? stageIndex : 0 },
  };
  if (stageIndex >= 1 && !next.profile.hatchedAt) {
    next = addEvents(
      { ...next, profile: { ...next.profile, hatchedAt: now.toISOString() } },
      [makeEvent('hatched', now.toISOString())]
    );
  }
  const peak = getPeakFor(units, next.profile.paidStageIndex);
  next = {
    ...next,
    peak: {
      stageIndex: Math.max(next.peak.stageIndex, peak.stageIndex),
      level: Math.max(next.peak.level, peak.level),
    },
  };
  setState({ ...state, pets: state.pets.map((p) => (p.id === selected.id ? next : p)) });
}

// Profile switching (see @/utils/profiles.ts): wait for the family's queued saves, then drop everything held in
// memory so the next profile loads its own record. Toy sessions are per pet id, so they are cleared too.
registerProfileStore({
  name: 'pet-family',
  settle: () => writeChain,
  reset: () => {
    state = null;
    loadPromise = null;
    resetToySessions();
  },
});
