// The data model for bathing tools (soap bars, and later the shower hose
// too) used by the interactive bathing mini-game
// (@/components/bathing-mini-game.tsx, driven from
// @/components/room-detail-screen.tsx). Deliberately its own small file,
// separate from that rendering code, so a future Shop screen can list/sell
// SoapItems without needing to know anything about drag targets, progress
// bars, or PanResponder — same "data model lives apart from the screen
// that renders it" split already used for Shop accessories
// (@/utils/pet-accessories.ts) vs. the Shop screen itself.
//
// Future Shop integration (not implemented yet, by instruction): a later
// step can add real alternate SoapItems here (different icon/name/price),
// list them in the Shop UI the same way hats/bows already are (see
// shop-screen.tsx), track ownership through the EXISTING generic
// ownership system in @/utils/shop-inventory.ts (getOwnedShopItemIds/
// purchaseShopItem — already works for any item id, not just
// accessories), and add a small "equipped soap id" (persisted the same
// way @/utils/pet-equipment.ts already persists the equipped accessory
// id) so the player can pick which owned soap the mini-game uses. None of
// that exists yet — today there is exactly one soap, it's free, and it's
// always the one used — but the shape below (id/name/icon/price) is
// already exactly what each of those later pieces would need, so adding
// real purchasable soaps later is additive, not a redesign.
export type SoapItem = {
  id: string;
  name: string;
  // Stands in for real artwork — shown as the drag cursor/finger-follow
  // icon and on the tool-select button. Plain text/emoji rather than a
  // sprite for now, since no dedicated soap-bar artwork exists yet (the
  // existing soap_1.png–soap_4.png files are Kitty's own bathing POSES,
  // not a tool icon — see @/utils/bathing-stage-art.ts — and are left
  // completely untouched by this file).
  icon: string;
  // In Paw Tokens, same currency/unit as every other Shop item
  // (@/utils/pet-accessories.ts, shop-screen.tsx) — 0 for the one free
  // default below. Not actually charged anywhere yet (no purchase flow
  // exists for soaps yet).
  price: number;
};

// The one soap every player already has, free, with no purchase step —
// what the mini-game uses today since no Shop UI/ownership exists for
// soaps yet.
export const DEFAULT_SOAP_ITEM: SoapItem = {
  id: 'soap-default',
  name: 'Basic Soap Bar',
  icon: '🧼',
  price: 0,
};

// Every soap that exists right now — just the one free default. A future
// Shop step appends real purchasable SoapItems here (each with its own
// id/name/icon/price); nothing else in this file needs to change for that.
export const SOAP_ITEMS: SoapItem[] = [DEFAULT_SOAP_ITEM];

// What the mini-game actually uses today, until an "equipped soap id"
// concept (see the module comment above) exists to let the player choose
// among several owned soaps.
export function getActiveSoapItem(): SoapItem {
  return DEFAULT_SOAP_ITEM;
}
