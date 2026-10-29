import { DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP } from '@/utils/dev-flags';
import { PET_ACCESSORY_ART } from '@/utils/pet-accessories';
import { getEquippedForSelectedPet, setSelectedPetEquipped } from '@/utils/pet-family';
import { getOwnedShopItemIds } from '@/utils/shop-inventory';

// Equip/unequip for Pet Accessories. Ownership (what the PLAYER has bought)
// is shared by the whole pet family (see shop-inventory.ts); what is WORN is
// per pet — each pet has its own hat and bow, saved with that pet in
// @/utils/pet-family.ts. Everything here acts on the SELECTED pet, and
// switching pets never copies one pet's accessories onto another.
//
// Two independent equipment slots: one HAT and one BOW (neck accessory).
// Equipping an item only ever replaces whatever is in ITS OWN slot, and either
// slot can be emptied on its own. Which slot an item belongs to comes from its
// own AccessoryArt.slot (see pet-accessories.ts): 'headHat' -> hat;
// 'neckCollar' (bows) and 'neckBandana' (both worn at the neck) -> bow.

export type EquipSlot = 'hat' | 'bow';

export type EquippedAccessories = { hat: string | null; bow: string | null };

// Which equipment slot an item would occupy, or null for an id that isn't a
// known accessory.
export function getEquipSlotForItem(itemId: string): EquipSlot | null {
  const art = PET_ACCESSORY_ART[itemId];
  if (!art) return null;
  return art.slot === 'headHat' ? 'hat' : 'bow';
}

// Read-only: the hat and bow the SELECTED pet is wearing.
export async function getEquippedAccessories(): Promise<EquippedAccessories> {
  return getEquippedForSelectedPet();
}

export type EquipResult =
  | { success: true; slot: EquipSlot }
  | { success: false; reason: 'not-owned' | 'unknown-item' };

// Serializes equip/unequip calls so two triggered close together can't
// race — same technique as purchaseShopItem in shop-inventory.ts.
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
// checked fresh against the real ownership record every time.
// DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP (see @/utils/dev-flags.ts) is a
// temporary escape hatch around that check, for visually testing accessory
// placements without buying every item first. Only the item's own slot is
// changed.
export function equipAccessory(itemId: string): Promise<EquipResult> {
  return chain(() => runEquip(itemId));
}

async function runEquip(itemId: string): Promise<EquipResult> {
  const slot = getEquipSlotForItem(itemId);
  if (slot === null) {
    return { success: false, reason: 'unknown-item' };
  }
  if (!DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP) {
    const owned = await getOwnedShopItemIds();
    if (!owned.has(itemId)) {
      return { success: false, reason: 'not-owned' };
    }
  }
  await setSelectedPetEquipped(slot, itemId);
  return { success: true, slot };
}

// Empties one slot; the other slot is left exactly as it was.
export function unequipAccessory(slot: EquipSlot): Promise<void> {
  return chain(async () => {
    await setSelectedPetEquipped(slot, null);
  });
}
