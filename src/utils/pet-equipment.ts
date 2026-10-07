import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP } from '@/utils/dev-flags';
import { getOwnedShopItemIds } from '@/utils/shop-inventory';

// Persistent equip/unequip state for Pet Accessories — the smallest safe
// extension of the purchase/ownership system (see shop-inventory.ts) to
// let an owned accessory be marked "currently worn". Deliberately its own
// file, separate from shop-inventory.ts (which still owns the purchase/
// ownership record itself) — this only ever READS that record (to refuse
// equipping something unowned) and owns a new, separate "what's currently
// equipped" record.
//
// Only one accessory can be equipped at a time in this system — a single
// id (or none), not a set. This step deliberately stops at saving that
// choice; nothing here renders the accessory on the pet yet.

const EQUIPPED_ACCESSORY_STORAGE_KEY = '@ProductivityPet:equippedPetAccessoryId';

// In-memory cache of the equipped id, loaded at most once per session —
// same pattern as cachedOwnedIds in shop-inventory.ts. `undefined` means
// "not loaded yet this session"; `null` (once loaded) means "nothing is
// currently equipped" — these are deliberately different states.
let cachedEquippedId: string | null | undefined = undefined;
let inFlightLoad: Promise<string | null> | null = null;

async function loadEquippedId(): Promise<string | null> {
  if (cachedEquippedId !== undefined) return cachedEquippedId;
  if (inFlightLoad) return inFlightLoad;

  inFlightLoad = (async () => {
    try {
      const stored = await AsyncStorage.getItem(EQUIPPED_ACCESSORY_STORAGE_KEY);
      cachedEquippedId = typeof stored === 'string' && stored.length > 0 ? stored : null;
      return cachedEquippedId;
    } catch {
      cachedEquippedId = null;
      return cachedEquippedId;
    } finally {
      inFlightLoad = null;
    }
  })();

  return inFlightLoad;
}

// Read-only: lets a screen (e.g. the Shop) know which single item, if
// any, is currently equipped, to render "Equipped" instead of "Equip".
export async function getEquippedAccessoryId(): Promise<string | null> {
  return loadEquippedId();
}

function saveEquippedId(id: string | null): void {
  cachedEquippedId = id;
  if (id === null) {
    AsyncStorage.removeItem(EQUIPPED_ACCESSORY_STORAGE_KEY).catch(() => {});
  } else {
    AsyncStorage.setItem(EQUIPPED_ACCESSORY_STORAGE_KEY, id).catch(() => {});
  }
}

export type EquipResult = { success: true } | { success: false; reason: 'not-owned' };

// Serializes equip/unequip calls so two triggered close together can't
// race on the same in-memory equipped-id snapshot — same technique as
// purchaseShopItem in shop-inventory.ts, generalized slightly here since
// equip and unequip share one queue (they mutate the same single value).
let pendingAction: Promise<void> = Promise.resolve();

function chain<T>(run: () => Promise<T>): Promise<T> {
  const result = pendingAction.then(run);
  pendingAction = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// Refuses to equip anything not already owned (see shop-inventory.ts) —
// checked fresh against the real ownership record every time, not just
// trusted from whatever the UI happens to be showing. DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP
// (see @/utils/dev-flags.ts) is a temporary escape hatch around that
// check, for visually testing accessory placements without buying every
// item first — it never touches the real ownership record itself, it
// only skips reading it.
export function equipAccessory(itemId: string): Promise<EquipResult> {
  return chain(() => runEquip(itemId));
}

async function runEquip(itemId: string): Promise<EquipResult> {
  if (!DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP) {
    const owned = await getOwnedShopItemIds();
    if (!owned.has(itemId)) {
      return { success: false, reason: 'not-owned' };
    }
  }
  saveEquippedId(itemId);
  return { success: true };
}

export function unequipAccessory(): Promise<void> {
  return chain(async () => {
    saveEquippedId(null);
  });
}
