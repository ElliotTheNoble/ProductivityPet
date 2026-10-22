import AsyncStorage from '@react-native-async-storage/async-storage';

// Simple explanation: this file defines what a "Pet Profile" looks like
// (Hunger, Cleanliness, poop piles, etc.) and handles loading/saving it
// using AsyncStorage, which is like a small storage box built into the
// phone/browser that remembers data even after the app closes.

// This is the persistent data foundation for the upcoming virtual pet-care
// system (hunger/cleanliness/happiness/energy decay, sleep schedule,
// sickness, poop events, Paw Tokens). This file deliberately only creates
// and persists the profile shape itself — no decay, no earning, no
// schedule/sickness/poop rules live here yet; those are separate, later
// steps that will read/update this same profile via getPetProfile /
// savePetProfile below.

// Simple explanation: a poop pile is always one of these 3 sizes.
// The 3 sizes a random poop event can roll (see @/utils/pet-poop.ts) —
// each requires a different number of Clean Up clicks to fully clear
// (POOP_CLEANUP_ACTIONS there: Small=1, Medium=2, Large=3), and each has
// its own pre-cropped floor artwork (getPoopArt in
// @/components/pet-placeholder.tsx).
export type PoopSize = 'small' | 'medium' | 'large';

// Simple explanation: this describes ONE poop pile — its size, how many
// more clicks it needs before it's gone, when it was created, and where
// it sits on the floor (offsetXPx/offsetYPx).
// A single accumulated poop pile — Kitty can have several of these on the
// floor at once (see @/utils/pet-poop.ts's accumulation system), each
// cleaned up independently. `id` is stable for the pile's whole lifetime
// (used as its React key and as the target of a specific Clean Up click —
// cleaning one pile must never affect any other pile's own state).
// `createdAt` is only informational right now (not read by any decay/
// accumulation math — accumulation timing lives entirely in
// PetProfile.nextPoopEventAt instead) but is kept for future use (e.g. a
// "this pile has been here the longest" indicator) and for debugging.
//
// `offsetXPx`/`offsetYPx` are this pile's fully-resolved floor position (a
// plain translateX/translateY in px, relative to the Living Room pet
// box's own bottom-left anchor) — computed ONCE at creation time by
// @/utils/pet-poop.ts's collision-aware placement logic (which already
// factors in the pet's growth stage, which side of Kitty it landed on,
// and every other current pile's own real rendered footprint) and never
// recomputed afterward. This is what makes a pile's position stable
// across rerenders/app reopens while still giving each new pile a fresh,
// collision-checked random spot — @/components/pet-placeholder.tsx just
// renders these two numbers directly, with no positioning logic of its
// own left to apply.
export type PoopPile = {
  id: string;
  size: PoopSize;
  cleanupRemaining: number;
  createdAt: string;
  offsetXPx: number;
  offsetYPx: number;
};

// Simple explanation: the most poop piles Kitty can ever have at once.
// Piles stop accumulating once there are this many on the floor — kept
// here (the data-model file) rather than in pet-poop.ts so
// normalizePetProfile below can clamp a corrupted/oversized saved array
// to the same real cap, without pet-poop.ts and pet-profile.ts needing to
// import from each other in both directions.
export const MAX_POOP_PILES = 5;

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
  // Simple explanation: the list of poop piles on the floor right now.
  // Empty list = no poop.
  // Every poop pile currently on the floor (0 to MAX_POOP_PILES) — see
  // @/utils/pet-poop.ts for how these accumulate over time and get
  // cleaned up individually. [] means the floor is currently clean of
  // poop (though Kitty herself may still show Dirty Kitty art via
  // needsBath/low Cleanliness below). Replaces the single hasPoop/
  // poopSize/poopCleanupRemaining fields an earlier version of this
  // profile used — normalizePetProfile below migrates any profile saved
  // in that older shape into an equivalent single-pile array here, so no
  // existing saved poop state is lost by this change.
  poopPiles: PoopPile[];
  // Simple explanation: a saved date/time telling the game WHEN the next
  // poop pile is allowed to appear.
  // ISO datetime of the next scheduled poop-pile event (see
  // @/utils/pet-poop.ts) — covers BOTH "when the first pile of a new
  // mess may appear" (while poopPiles is empty) AND "when the next
  // additional pile may accumulate" (while poopPiles is non-empty but
  // under MAX_POOP_PILES) — one shared field, since only one of those two
  // situations is ever true at a time. '' means "not yet scheduled",
  // which that module treats as "schedule one starting now" the next
  // time it checks, rather than treating a profile saved before this
  // field existed as already overdue. Only ever written by pet-poop.ts's
  // own scheduling/cleanup logic.
  nextPoopEventAt: string;
  // Simple explanation: true means "Kitty still needs a bath." Cleaning
  // up the poop on the floor does NOT turn this back to false — only a
  // completed Bathroom wash/rinse/dry sequence does.
  // True once ANY poop pile has ever appeared since Kitty was last fully
  // bathed, independent of poopPiles itself — poopPiles is just "what's
  // on the floor right now" (cleared pile-by-pile by the Clean Up
  // button, see @/utils/pet-poop.ts), while needsBath tracks "has Kitty
  // herself been dirtied by a poop event and still needs an actual
  // bath", independent of Cleanliness. Set true the moment the FIRST
  // pile of a mess appears; NOT cleared by cleaning up any/all piles,
  // and NOT cleared by bathePet()'s own partial +25 top-up
  // (@/utils/pet-bathing.ts, which only ever raises cleanliness, never
  // touches this) — only completeBathing() (same file), called once the
  // real animated Soap→Rinse→Dry sequence in the Bathroom finishes,
  // clears it. See isPetDirty in @/utils/pet-needs.ts, which treats this
  // exactly like poopPiles/low-Cleanliness for deciding whether Dirty
  // Kitty art should show.
  needsBath: boolean;
  // Highest pet-stage index (see @/utils/pet-stage.ts's PET_STAGES) ever
  // unlocked via a PAID growth upgrade (see @/utils/pet-growth.ts) — 0
  // means "no paid upgrade yet". Egg/Hatchling/Baby never need this field
  // to be set; they still advance automatically for free purely from
  // completed-task count, exactly as before. Only growPet() ever writes
  // this, after a successful, already-charged upgrade — never set
  // optimistically before payment succeeds.
  paidStageIndex: number;
  // Simple explanation: the exact moment the Egg hatched into a
  // Hatchling, used to show a short 5-second "just hatched" animation
  // once, right after it happens.
  //
  // ISO datetime of the moment the real stage first crossed from Egg into
  // Hatchling, or '' if that hasn't happened yet (or happened before this
  // field existed — old saved profiles normalize to '', not an invented
  // past date, which is what correctly keeps them from ever showing the
  // intro). Only ever set ONCE, the moment the crossing is actually
  // detected live (see src/app/index.tsx) — never backfilled or reset.
  // @/components/pet-placeholder.tsx compares real elapsed time since this
  // timestamp to decide whether to still show the temporary hatching
  // artwork (assets/images/pets/kitten_nest.png) or the normal, permanent
  // Hatchling artwork (assets/images/pets/pet_hatchling.png) — the same
  // "compare elapsed real time against a stored timestamp" approach used
  // everywhere else in this app, so closing/reopening the app mid-animation
  // correctly resumes as "already past the 5 seconds" rather than
  // replaying it.
  hatchedAt: string;
  // Simple explanation: the exact moment Kitty's last real bath finished
  // (reached her final Dry pose), used to keep showing that Dry picture
  // for a short window afterward instead of snapping straight back to her
  // normal picture.
  //
  // ISO datetime set ONCE per bath, by completeBathing()
  // (@/utils/pet-bathing.ts), the moment the real animated Soap→Rinse→Dry
  // sequence in the Bathroom actually finishes — '' means "never bathed
  // (yet), or bathed before this field existed," which correctly never
  // shows the Dry hold. @/components/pet-placeholder.tsx and
  // @/components/room-pet.tsx both compare real elapsed time since this
  // timestamp against BATH_DRY_HOLD_MS (same file) to decide whether to
  // still show the final Dry picture — the same "compare elapsed real
  // time against a stored timestamp" approach hatchedAt above already
  // uses, so closing/reopening the app or navigating away and back mid-
  // hold correctly resumes rather than restarting or losing the hold.
  lastBathCompletedAt: string;
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
    poopPiles: [],
    nextPoopEventAt: '',
    needsBath: false,
    paidStageIndex: 0,
    hatchedAt: '',
    lastBathCompletedAt: '',
  };
}

// Simple explanation: checks one poop pile loaded from storage and fixes
// anything missing or broken, so saved data that's old or damaged doesn't
// crash the app.
// Repairs one raw stored pile into a valid PoopPile, or null if it's too
// malformed to recover (missing/invalid size) — an individual bad pile is
// simply dropped rather than discarding the whole poopPiles array, same
// "repair field by field, never discard everything over one bad part"
// philosophy as normalizePetProfile below. `fallbackId`/`fallbackCreatedAt`/
// `fallbackOffsetXPx`/`fallbackOffsetYPx` let the caller supply something
// stable-ish for a pile that's missing its own id/createdAt/position (e.g.
// one migrated from the older single-poop fields, or genuinely corrupted
// data) — the fallback offsets should vary per pile when repairing several
// at once (see its call site) so they don't all land in the exact same
// spot; they're never collision-checked against siblings the way a freshly
// CREATED pile's position is (see @/utils/pet-poop.ts), since this path
// only runs for already-broken/legacy data, not normal gameplay.
function normalizePoopPile(
  raw: unknown,
  fallbackId: string,
  fallbackCreatedAt: string,
  fallbackOffsetXPx: number,
  fallbackOffsetYPx: number
): PoopPile | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const size: PoopSize | null =
    value.size === 'small' || value.size === 'medium' || value.size === 'large' ? value.size : null;
  if (!size) return null;
  const cleanupRemaining =
    typeof value.cleanupRemaining === 'number' && value.cleanupRemaining > 0 ? Math.floor(value.cleanupRemaining) : 1;
  const offsetXPx =
    typeof value.offsetXPx === 'number' && Number.isFinite(value.offsetXPx) ? value.offsetXPx : fallbackOffsetXPx;
  const offsetYPx =
    typeof value.offsetYPx === 'number' && Number.isFinite(value.offsetYPx) ? value.offsetYPx : fallbackOffsetYPx;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : fallbackId,
    size,
    cleanupRemaining,
    createdAt: typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : fallbackCreatedAt,
    offsetXPx,
    offsetYPx,
  };
}

// Simple explanation: takes the raw data loaded from storage (which could
// be old, missing fields, or broken) and turns it into a safe, complete
// PetProfile. This also upgrades old save data — for example, a profile
// saved before poop piles existed gets converted into the new format
// automatically, instead of losing that player's progress.
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

  const lastUpdatedAt =
    typeof value.lastUpdatedAt === 'string' && value.lastUpdatedAt ? value.lastUpdatedAt : fallback.lastUpdatedAt;

  // poopPiles — the new multi-pile list (see @/utils/pet-poop.ts's
  // accumulation system). A profile saved in the CURRENT shape has its
  // own poopPiles array, validated/repaired pile by pile and capped at
  // MAX_POOP_PILES in case of corruption. A profile saved in the OLDER,
  // single-poop shape (hasPoop/poopSize/poopCleanupRemaining, no
  // poopPiles array at all) is migrated into an equivalent one-pile array
  // here instead, so upgrading to accumulation never silently loses an
  // existing uncleaned poop. A profile with neither (hasPoop false/absent
  // and no poopPiles) simply has no piles.
  let poopPiles: PoopPile[];
  if (Array.isArray(value.poopPiles)) {
    poopPiles = value.poopPiles
      .map((rawPile, index) => {
        // Alternates sides and nudges each one a little further out, so a
        // handful of repaired piles (an edge case — normal piles always
        // already have valid offsets) don't all land in the exact same
        // spot. Not collision-checked against real pile footprints the
        // way a freshly created pile is — good enough for a rare repair
        // path, not worth importing pet-poop.ts's placement logic here.
        const fallbackOffsetXPx = (index % 2 === 0 ? -1 : 1) * (120 + index * 20);
        const fallbackOffsetYPx = (index % 3) * 30;
        return normalizePoopPile(
          rawPile,
          `migrated-pile-${index}-${Date.now()}`,
          lastUpdatedAt,
          fallbackOffsetXPx,
          fallbackOffsetYPx
        );
      })
      .filter((pile): pile is PoopPile => pile !== null)
      .slice(0, MAX_POOP_PILES);
  } else if (value.hasPoop === true) {
    const legacySize: PoopSize =
      value.poopSize === 'small' || value.poopSize === 'medium' || value.poopSize === 'large' ? value.poopSize : 'small';
    const legacyRemaining =
      typeof value.poopCleanupRemaining === 'number' && value.poopCleanupRemaining > 0
        ? Math.floor(value.poopCleanupRemaining)
        : 1;
    // A migrated single-poop profile has no saved position at all (that
    // concept didn't exist yet) — a small fixed offset to one side is a
    // perfectly fine, stable starting spot; it's still a real pile the
    // player can see and clean, just not randomly placed the way a fresh
    // pile would be. Nothing deletes or resets this pile's progress.
    poopPiles = [
      {
        id: `legacy-pile-${Date.now()}`,
        size: legacySize,
        cleanupRemaining: legacyRemaining,
        createdAt: lastUpdatedAt,
        offsetXPx: -120,
        offsetYPx: 0,
      },
    ];
  } else {
    poopPiles = [];
  }

  return {
    hunger: typeof value.hunger === 'number' ? clampNeedValue(value.hunger) : fallback.hunger,
    cleanliness: typeof value.cleanliness === 'number' ? clampNeedValue(value.cleanliness) : fallback.cleanliness,
    happiness: typeof value.happiness === 'number' ? clampNeedValue(value.happiness) : fallback.happiness,
    energy: typeof value.energy === 'number' ? clampNeedValue(value.energy) : fallback.energy,
    pawTokens: typeof value.pawTokens === 'number' && value.pawTokens >= 0 ? value.pawTokens : fallback.pawTokens,
    adoptionDate: typeof value.adoptionDate === 'string' && value.adoptionDate ? value.adoptionDate : fallback.adoptionDate,
    lastUpdatedAt,
    isSleeping: typeof value.isSleeping === 'boolean' ? value.isSleeping : false,
    isSick: typeof value.isSick === 'boolean' ? value.isSick : false,
    poopPiles,
    nextPoopEventAt: typeof value.nextPoopEventAt === 'string' ? value.nextPoopEventAt : fallback.nextPoopEventAt,
    needsBath: typeof value.needsBath === 'boolean' ? value.needsBath : false,
    paidStageIndex:
      typeof value.paidStageIndex === 'number' && value.paidStageIndex >= 0
        ? value.paidStageIndex
        : fallback.paidStageIndex,
    // A profile saved before this field existed normalizes to '' (never
    // hatched, as far as the hatching-intro animation is concerned) —
    // deliberately NOT backfilled to "now" or any other guessed date, so
    // an existing Hatchling-or-later pet never wrongly replays the intro.
    hatchedAt: typeof value.hatchedAt === 'string' ? value.hatchedAt : '',
    // Same reasoning as hatchedAt just above — a profile saved before this
    // field existed normalizes to '' (no active Dry hold), never
    // backfilled to "now" or any other guessed timestamp.
    lastBathCompletedAt: typeof value.lastBathCompletedAt === 'string' ? value.lastBathCompletedAt : '',
  };
}

// In-memory cache, same reasoning as src/utils/task-storage.ts's
// cachedTasks: avoids a fresh AsyncStorage read + parse from every screen
// that ends up needing the pet profile. `null` means "not loaded yet this
// session" (distinct from a real profile object).
let cachedProfile: PetProfile | null = null;
// De-dupes concurrent first-reads into a single AsyncStorage call.
let inFlightRead: Promise<PetProfile> | null = null;

// Simple explanation: reads the saved pet data from AsyncStorage (the
// phone/browser's storage). If this is the very first time the app has
// run, it creates a brand-new profile instead.
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

// Simple explanation: saves the pet data to AsyncStorage so it's still
// there the next time the app opens. This is called every time something
// about the pet changes — poop piles, needs bars, everything.
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
