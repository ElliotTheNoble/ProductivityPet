import AsyncStorage from '@react-native-async-storage/async-storage';

import { getPetProfile, savePetProfile } from '@/utils/pet-profile';

// Persistent Shop purchase/ownership — the smallest safe piece of what
// will eventually be the full purchasing system for every Shop item.
// Deliberately its own file, separate from pet-profile.ts (which still
// owns the pawTokens field itself) and from paw-tokens.ts (task/
// appointment earning) — this only ever SPENDS pawTokens, through the
// same getPetProfile/savePetProfile every other Pet Care action already
// uses, and owns a new, separate "what has been bought" record.

const OWNED_SHOP_ITEMS_STORAGE_KEY = '@ProductivityPet:ownedShopItems';

// In-memory cache of owned item ids, loaded at most once per session —
// same pattern as cachedProfile/cachedTasks/cachedAwardedKeys elsewhere.
// `null` means "not loaded yet this session".
let cachedOwnedIds: Set<string> | null = null;
let inFlightLoad: Promise<Set<string>> | null = null;

async function loadOwnedIds(): Promise<Set<string>> {
  if (cachedOwnedIds !== null) return cachedOwnedIds;
  if (inFlightLoad) return inFlightLoad;

  inFlightLoad = (async () => {
    try {
      const stored = await AsyncStorage.getItem(OWNED_SHOP_ITEMS_STORAGE_KEY);
      if (!stored) {
        cachedOwnedIds = new Set();
        return cachedOwnedIds;
      }
      const parsed = JSON.parse(stored) as unknown;
      cachedOwnedIds = new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
      return cachedOwnedIds;
    } catch {
      cachedOwnedIds = new Set();
      return cachedOwnedIds;
    } finally {
      inFlightLoad = null;
    }
  })();

  return inFlightLoad;
}

// Read-only: lets a screen (e.g. the Shop) know which items are already
// owned, to render "Owned" instead of a Buy control.
export async function getOwnedShopItemIds(): Promise<Set<string>> {
  return loadOwnedIds();
}

function saveOwnedIds(ids: Set<string>): void {
  cachedOwnedIds = ids;
  AsyncStorage.setItem(OWNED_SHOP_ITEMS_STORAGE_KEY, JSON.stringify(Array.from(ids))).catch(() => {});
}

export type PurchaseResult =
  | { success: true }
  | { success: false; reason: 'already-owned' | 'insufficient-funds' };

// Serializes the whole read-check-spend-write cycle so two purchases
// triggered close together (e.g. a double-click before the button
// disables, or two different items bought in quick succession once more
// items become purchasable) can't both read the same pre-purchase balance
// and double-spend it — same technique as reconcilePawTokenEarnings in
// paw-tokens.ts: each call is chained onto the previous one's completion
// rather than running concurrently.
let pendingPurchase: Promise<PurchaseResult> = Promise.resolve({ success: true });

export function purchaseShopItem(itemId: string, price: number): Promise<PurchaseResult> {
  const next = pendingPurchase.then(() => runPurchase(itemId, price));
  pendingPurchase = next;
  return next;
}

async function runPurchase(itemId: string, price: number): Promise<PurchaseResult> {
  const owned = await loadOwnedIds();
  if (owned.has(itemId)) {
    return { success: false, reason: 'already-owned' };
  }

  // pawTokens isn't a decaying need (unlike Hunger/Cleanliness/Happiness/
  // Energy) — it only ever changes via earning or spending — so reading
  // the plain current profile here is correct; no need-decay catch-up
  // like loadPetProfileWithNeedsUpdate is needed before a purchase.
  const profile = await getPetProfile();
  if (profile.pawTokens < price) {
    return { success: false, reason: 'insufficient-funds' };
  }

  savePetProfile({ ...profile, pawTokens: profile.pawTokens - price });

  const updatedOwned = new Set(owned);
  updatedOwned.add(itemId);
  saveOwnedIds(updatedOwned);

  return { success: true };
}
