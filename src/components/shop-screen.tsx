import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PawTokenCoin } from '@/components/paw-token-coin';
import { SpriteCrop } from '@/components/sprite-crop';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP } from '@/utils/dev-flags';
import { PET_ACCESSORY_ART } from '@/utils/pet-accessories';
import type { AccessorySlot } from '@/utils/pet-accessory-placement';
import { equipAccessory, getEquippedAccessoryId, unequipAccessory } from '@/utils/pet-equipment';
import { getPetProfile, subscribeToPetProfile } from '@/utils/pet-profile';
import { getOwnedShopItemIds, purchaseShopItem } from '@/utils/shop-inventory';

// How long the "Not enough Paw Tokens!" message stays visible on a card
// before clearing itself — same idea as Home's TEMPORARY_MESSAGE_DURATION_MS.
const INSUFFICIENT_FUNDS_MESSAGE_DURATION_MS = 2500;

// Lighter/brighter versions of each action button's own base color,
// shown only while that specific button (not just its card) is hovered —
// on top of the shared scale/lift + shadow every hoverable card already
// gets (styles.cardHovered), this makes the button itself visibly
// highlight, while keeping each one's color identity recognizable: Buy
// stays pink, Equip stays blue, ✓ Equipped stays purple.
// Buy and ✓ Equipped both use white text (buyButtonText/categoryLabelActive),
// so their hover colors are only modestly lightened — too close to white
// and the white text itself would lose contrast. Equip (unselected) uses
// the normal dark text color instead, so it can go lighter safely — and
// needs to, since theme.sky is already very pale: a small shift off of it
// is nearly invisible, unlike accent/purple which have more room to
// lighten from before going pale themselves.
const BUY_BUTTON_HOVER_COLOR = '#F6A8C3';
const EQUIP_BUTTON_HOVER_COLOR = '#D6EFF8';
const EQUIPPED_BUTTON_HOVER_COLOR = '#B299DF';
// Equip's hover border/glow specifically — NOT theme.sky. Buy/Equipped's
// hover borders already use their fully-saturated base color
// (theme.accent/theme.purple), which stands out against their lightened
// fill; theme.sky is itself already pale, so reusing it as the border
// gave almost no contrast against the (also pale) fill above. This is a
// more saturated blue, playing the same role Buy/Equipped's border colors
// already do.
const EQUIP_BUTTON_HOVER_BORDER = '#4FB3DB';

// Wider than the app's usual MaxContentWidth (800) — the 4-column item
// grid and the wide hero banner both need more breathing room than a
// single reading-width column gives, same reasoning RoomHubScreen uses
// for its own, similarly wide ROOMS_MAX_WIDTH.
const SHOP_MAX_WIDTH = 1180;
const CARD_WIDTH = 246;
// The art-placeholder square's actual pixel size — CARD_WIDTH minus the
// card's own left+right padding (Spacing.two each side) — so SpriteCrop
// (which needs a concrete size, not a percentage) fills exactly the same
// box the emoji placeholders already use (styles.artPlaceholder is 100%
// width, aspectRatio 1).
const ART_AREA_SIZE = CARD_WIDTH - Spacing.two * 2;

// All Pet Accessories crop data (bows, hats, bandanas) now lives in
// @/utils/pet-accessories.ts (PET_ACCESSORY_ART) now that every one of
// them is equippable — every entry below reads its `art` from there
// instead of a local per-sheet helper, so the Shop card and the on-pet
// overlay never risk drifting out of sync with two independently-
// maintained copies of the same crop numbers.

type ShopCategory = 'Pet Accessories' | 'Room Decor' | 'Backgrounds';

// Each category keeps its own soft pastel identity while unselected (icon
// + base color) — matching assets/images/shop_reference.png, where Room
// Decor stays peach and Backgrounds stays sky even when not the active
// tab. The selected tab always switches to the stronger purple treatment
// regardless of which category it is, per the earlier design direction.
const SHOP_CATEGORIES: { name: ShopCategory; icon: string; color: ThemeColor }[] = [
  { name: 'Pet Accessories', icon: '🐾', color: 'backgroundSelected' },
  { name: 'Room Decor', icon: '🛋️', color: 'peach' },
  { name: 'Backgrounds', icon: '🖼️', color: 'sky' },
];

// Visual placeholders only, for judging layout — not real items, not
// persisted anywhere, and never read or written by the Paw Token system
// (see @/utils/paw-tokens.ts). Purchasing, ownership, and equipping are
// explicitly out of scope for this step. Exactly 8 per category so the
// 4-column grid shows two full rows with nothing left dangling.
//
// Pet Accessories is the first category with real artwork and the first
// with real purchasing/equipping wired up. Every bow, hat, and bandana
// now reuses its `art` directly from PET_ACCESSORY_ART (see
// @/utils/pet-accessories.ts) instead of a local per-sheet helper, so the
// Shop card and the on-pet overlay always read the exact same crop data,
// never two independently-maintained copies of the same numbers. Room
// Decor and Backgrounds still use emoji placeholders until each of those
// gets the same treatment later.
type SpriteArt = {
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  // Optional — every real PET_ACCESSORY_ART entry already has this at
  // runtime (it's an AccessoryArt under the hood), just not previously
  // surfaced here since the Shop didn't need it. Only used right now to
  // identify hats for the temporary dev test-equip button below (see
  // @/utils/dev-flags.ts); remove if that's removed and nothing else
  // ends up needing it.
  slot?: AccessorySlot;
};

type SampleShopItem = {
  id: string;
  name: string;
  price: number;
  emoji?: string;
  art?: SpriteArt;
  // True for every item wired up to the real purchase system (see
  // @/utils/shop-inventory.ts) — currently every Pet Accessory (all bows,
  // hats, and bandanas); Room Decor and Backgrounds items still just
  // display, with no Buy control.
  purchasable?: boolean;
  // True for every item wired up to the real equip system (see
  // @/utils/pet-equipment.ts) — currently every Pet Accessory. The equip
  // system itself only ever tracks one equipped id at a time, so
  // equipping any item here automatically unequips whichever one (if any)
  // was equipped before — no extra bookkeeping needed for that. Whether
  // the equipped item actually renders anything on the pet depends on
  // whether it has a tuned placement yet (see pet-placeholder.tsx) — this
  // flag only controls whether the Shop shows an Equip control.
  equippable?: boolean;
};

const SAMPLE_ITEMS: Record<ShopCategory, SampleShopItem[]> = {
  'Pet Accessories': [
    {
      id: 'bow-1',
      name: 'Pink Bow',
      price: 40,
      art: PET_ACCESSORY_ART['bow-1'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow-2',
      name: 'Purple Bow',
      price: 40,
      art: PET_ACCESSORY_ART['bow-2'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow-3',
      name: 'Blue Striped Bow',
      price: 45,
      art: PET_ACCESSORY_ART['bow-3'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow-4',
      name: 'Red Bow',
      price: 40,
      art: PET_ACCESSORY_ART['bow-4'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow-5',
      name: 'Cherry Blossom Bow',
      price: 55,
      art: PET_ACCESSORY_ART['bow-5'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow-6',
      name: 'Black Cat-Ear Bow',
      price: 50,
      art: PET_ACCESSORY_ART['bow-6'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow-7',
      name: 'Holographic Rainbow Bow',
      price: 70,
      art: PET_ACCESSORY_ART['bow-7'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow-8',
      name: 'Blue Gingham Lace Bow',
      price: 50,
      art: PET_ACCESSORY_ART['bow-8'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-1',
      name: 'Mint Bow',
      price: 40,
      art: PET_ACCESSORY_ART['bow2-1'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-2',
      name: 'Yellow Bow',
      price: 40,
      art: PET_ACCESSORY_ART['bow2-2'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-3',
      name: 'Coral Bow',
      price: 40,
      art: PET_ACCESSORY_ART['bow2-3'],
      purchasable: true,
      equippable: true,
    },
    // Named "Sakura Pink Bow" here (rather than repeating "Cherry Blossom
    // Bow" from bow-5 above) for the same reason as "Pastel Holographic
    // Bow" below — avoids two identically-named cards in the same grid.
    {
      id: 'bow2-4',
      name: 'Sakura Pink Bow',
      price: 55,
      art: PET_ACCESSORY_ART['bow2-4'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-5',
      name: 'Starry Lavender Bow',
      price: 50,
      art: PET_ACCESSORY_ART['bow2-5'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-6',
      name: 'Navy Starlight Bow',
      price: 55,
      art: PET_ACCESSORY_ART['bow2-6'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-7',
      name: 'White Bow',
      price: 35,
      art: PET_ACCESSORY_ART['bow2-7'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-8',
      name: 'Brown Gingham Bow',
      price: 45,
      art: PET_ACCESSORY_ART['bow2-8'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-9',
      name: 'Brown Fur-Trim Bow',
      price: 60,
      art: PET_ACCESSORY_ART['bow2-9'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-10',
      name: 'Pink Lace Bow',
      price: 55,
      art: PET_ACCESSORY_ART['bow2-10'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-11',
      name: 'Blue Heart Bow',
      price: 45,
      art: PET_ACCESSORY_ART['bow2-11'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-12',
      name: 'Green Daisy Bow',
      price: 45,
      art: PET_ACCESSORY_ART['bow2-12'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-13',
      name: 'Red Fur-Trim Bow',
      price: 60,
      art: PET_ACCESSORY_ART['bow2-13'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-14',
      name: 'Green & Red Striped Bow',
      price: 50,
      art: PET_ACCESSORY_ART['bow2-14'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-15',
      name: 'Snowflake Bow',
      price: 55,
      art: PET_ACCESSORY_ART['bow2-15'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-16',
      name: 'Black & Pink Heart Bow',
      price: 50,
      art: PET_ACCESSORY_ART['bow2-16'],
      purchasable: true,
      equippable: true,
    },
    // Named "Pastel Holographic Bow" here (rather than repeating "Holographic
    // Rainbow Bow" from bow-7 above) so the two don't show up as identically-
    // named cards side by side — same bow family as bow-7, different sheet.
    {
      id: 'bow2-17',
      name: 'Pastel Holographic Bow',
      price: 70,
      art: PET_ACCESSORY_ART['bow2-17'],
      purchasable: true,
      equippable: true,
    },
    {
      id: 'bow2-18',
      name: 'Purple Lace Gingham Bow',
      price: 55,
      art: PET_ACCESSORY_ART['bow2-18'],
      purchasable: true,
      equippable: true,
    },
    // Every hat and bandana below now reuses its `art` directly from
    // PET_ACCESSORY_ART (see @/utils/pet-accessories.ts), same reasoning
    // as the bows above: the Shop card and the on-pet overlay always read
    // the exact same crop data, never two independently-maintained
    // copies. All are purchasable and equippable now; an item without its
    // own tuned placement yet just renders invisibly on the pet once
    // equipped (see pet-placeholder.tsx) rather than guessing.
    { id: 'hat-1', name: 'White Cat-Ear Beanie', price: 45, art: PET_ACCESSORY_ART['hat-1'], purchasable: true, equippable: true },
    { id: 'hat-2', name: 'Black Cat-Ear Beanie', price: 45, art: PET_ACCESSORY_ART['hat-2'], purchasable: true, equippable: true },
    { id: 'hat-3', name: 'Bunny Hat', price: 50, art: PET_ACCESSORY_ART['hat-3'], purchasable: true, equippable: true },
    { id: 'hat-4', name: 'Bear Hat', price: 50, art: PET_ACCESSORY_ART['hat-4'], purchasable: true, equippable: true },
    { id: 'hat-5', name: 'Frog Hat', price: 40, art: PET_ACCESSORY_ART['hat-5'], purchasable: true, equippable: true },
    { id: 'hat-6', name: 'Duck Hat', price: 40, art: PET_ACCESSORY_ART['hat-6'], purchasable: true, equippable: true },
    { id: 'hat-7', name: 'Strawberry Hat', price: 45, art: PET_ACCESSORY_ART['hat-7'], purchasable: true, equippable: true },
    { id: 'hat-8', name: 'Bee Hat', price: 45, art: PET_ACCESSORY_ART['hat-8'], purchasable: true, equippable: true },
    { id: 'hat-9', name: 'Mushroom Hat', price: 50, art: PET_ACCESSORY_ART['hat-9'], purchasable: true, equippable: true },
    { id: 'hat-10', name: 'Witch Hat', price: 55, art: PET_ACCESSORY_ART['hat-10'], purchasable: true, equippable: true },
    { id: 'hat-11', name: 'Wizard Hat', price: 60, art: PET_ACCESSORY_ART['hat-11'], purchasable: true, equippable: true },
    { id: 'hat-12', name: 'Rainbow Party Hat', price: 65, art: PET_ACCESSORY_ART['hat-12'], purchasable: true, equippable: true },
    { id: 'hat2-1', name: 'Pumpkin Hat', price: 45, art: PET_ACCESSORY_ART['hat2-1'], purchasable: true, equippable: true },
    { id: 'hat2-2', name: 'Reindeer Hat', price: 55, art: PET_ACCESSORY_ART['hat2-2'], purchasable: true, equippable: true },
    { id: 'hat2-3', name: 'Santa Hat', price: 55, art: PET_ACCESSORY_ART['hat2-3'], purchasable: true, equippable: true },
    { id: 'hat2-4', name: 'Christmas Bell Hat', price: 55, art: PET_ACCESSORY_ART['hat2-4'], purchasable: true, equippable: true },
    { id: 'hat2-5', name: 'Pink Heart Beret', price: 40, art: PET_ACCESSORY_ART['hat2-5'], purchasable: true, equippable: true },
    { id: 'hat2-6', name: 'Cream Paw Beret', price: 40, art: PET_ACCESSORY_ART['hat2-6'], purchasable: true, equippable: true },
    { id: 'hat2-7', name: 'Brown Plaid Beret', price: 45, art: PET_ACCESSORY_ART['hat2-7'], purchasable: true, equippable: true },
    { id: 'hat2-8', name: 'Yellow Sun Hat', price: 45, art: PET_ACCESSORY_ART['hat2-8'], purchasable: true, equippable: true },
    { id: 'hat2-9', name: 'Winter Beanie', price: 50, art: PET_ACCESSORY_ART['hat2-9'], purchasable: true, equippable: true },
    { id: 'hat2-10', name: 'Shark Hat', price: 60, art: PET_ACCESSORY_ART['hat2-10'], purchasable: true, equippable: true },
    { id: 'hat2-11', name: 'Cow Hat', price: 50, art: PET_ACCESSORY_ART['hat2-11'], purchasable: true, equippable: true },
    { id: 'hat2-12', name: 'Dino Hat', price: 55, art: PET_ACCESSORY_ART['hat2-12'], purchasable: true, equippable: true },
    { id: 'hat2-13', name: 'Unicorn Hat', price: 65, art: PET_ACCESSORY_ART['hat2-13'], purchasable: true, equippable: true },
    // Bandanas temporarily removed from the Shop catalog (postponed to
    // focus on other app features) — not deleted, just commented out, so
    // they're a one-line uncomment away from coming back. Their crop
    // data, the 'neckBandana' slot, and the equip/placement system in
    // @/utils/pet-accessories.ts and @/utils/pet-accessory-placement.ts
    // are all untouched and still reusable once redesigned bandanas are
    // ready to re-add here.
    // { id: 'bandana-1', name: 'Pink Heart Bandana', price: 40, art: PET_ACCESSORY_ART['bandana-1'], purchasable: true, equippable: true },
    // { id: 'bandana-2', name: 'Blue Gingham Cat Bandana', price: 45, art: PET_ACCESSORY_ART['bandana-2'], purchasable: true, equippable: true },
    // { id: 'bandana-3', name: 'Strawberry Bandana', price: 45, art: PET_ACCESSORY_ART['bandana-3'], purchasable: true, equippable: true },
    // { id: 'bandana-4', name: 'Daisy Bandana', price: 40, art: PET_ACCESSORY_ART['bandana-4'], purchasable: true, equippable: true },
    // { id: 'bandana-5', name: 'Red Polka Dot Bell Bandana', price: 50, art: PET_ACCESSORY_ART['bandana-5'], purchasable: true, equippable: true },
    // { id: 'bandana-6', name: 'Green Sprout Bandana', price: 35, art: PET_ACCESSORY_ART['bandana-6'], purchasable: true, equippable: true },
    // { id: 'bandana-7', name: 'Purple Moon & Star Bandana', price: 55, art: PET_ACCESSORY_ART['bandana-7'], purchasable: true, equippable: true },
    // { id: 'bandana-8', name: 'Pink Gingham Lace Heart Bandana', price: 50, art: PET_ACCESSORY_ART['bandana-8'], purchasable: true, equippable: true },
    // { id: 'bandana-9', name: 'Cow Print Bandana', price: 45, art: PET_ACCESSORY_ART['bandana-9'], purchasable: true, equippable: true },
    // { id: 'bandana-10', name: 'Blue Snowflake Bandana', price: 50, art: PET_ACCESSORY_ART['bandana-10'], purchasable: true, equippable: true },
    // { id: 'bandana-11', name: 'Black Paw Bandana', price: 45, art: PET_ACCESSORY_ART['bandana-11'], purchasable: true, equippable: true },
    // { id: 'bandana-12', name: 'Orange Gingham Pumpkin Bandana', price: 50, art: PET_ACCESSORY_ART['bandana-12'], purchasable: true, equippable: true },
  ],
  'Room Decor': [
    { id: 'rd-1', name: 'Cozy Rug', price: 80, emoji: '🟫' },
    { id: 'rd-2', name: 'Potted Plant', price: 45, emoji: '🪴' },
    { id: 'rd-3', name: 'Wall Clock', price: 55, emoji: '🕰️' },
    { id: 'rd-4', name: 'Little Bookshelf', price: 90, emoji: '📚' },
    { id: 'rd-5', name: 'Fairy Lights', price: 75, emoji: '✨' },
    { id: 'rd-6', name: 'Soft Pillow', price: 40, emoji: '🛏️' },
    { id: 'rd-7', name: 'Mini Fountain', price: 100, emoji: '⛲' },
    { id: 'rd-8', name: 'Toy Basket', price: 50, emoji: '🧺' },
  ],
  Backgrounds: [
    { id: 'bg-1', name: 'Starry Night', price: 120, emoji: '🌌' },
    { id: 'bg-2', name: 'Spring Garden', price: 100, emoji: '🌷' },
    { id: 'bg-3', name: 'Beach Sunset', price: 110, emoji: '🌅' },
    { id: 'bg-4', name: 'Snowy Village', price: 130, emoji: '❄️' },
    { id: 'bg-5', name: 'Cloud Kingdom', price: 125, emoji: '☁️' },
    { id: 'bg-6', name: 'Autumn Forest', price: 115, emoji: '🍂' },
    { id: 'bg-7', name: 'Candy Land', price: 140, emoji: '🍬' },
    { id: 'bg-8', name: 'Rainy Window', price: 90, emoji: '🌧️' },
  ],
};

export function ShopScreen() {
  const theme = useTheme();
  const [selectedCategory, setSelectedCategory] = useState<ShopCategory>('Pet Accessories');

  // The real pawTokens value from the persistent Pet Profile (see
  // @/utils/pet-profile.ts) — same reactive pattern AppHeader uses, so
  // this stays current without polling or a page refresh. Purely a
  // display here; nothing on this page reads or writes it otherwise.
  const [pawTokens, setPawTokens] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPetProfile().then((profile) => {
      if (!cancelled) setPawTokens(profile.pawTokens);
    });
    const unsubscribe = subscribeToPetProfile((profile) => {
      if (!cancelled) setPawTokens(profile.pawTokens);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Which items are already owned (see @/utils/shop-inventory.ts) —
  // loaded once on mount so a purchase made in an earlier session still
  // shows "Owned" after a refresh/reopen. Only bow-1 can actually trigger
  // a purchase right now, but this reads the whole owned set so it's
  // ready to drive every item's badge once more become purchasable.
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  // Which single item (by id) currently has a purchase in flight — used
  // to disable just that one Buy button, same guard shape as
  // isFeeding/isBathing/isPlaying/isResting on Home.
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  // Which single item (by id) should currently show the "Not enough Paw
  // Tokens!" message — cleared automatically after a few seconds.
  const [insufficientFundsId, setInsufficientFundsId] = useState<string | null>(null);
  const insufficientFundsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOwnedShopItemIds().then((ids) => {
      if (!cancelled) setOwnedIds(new Set(ids));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (insufficientFundsTimeoutRef.current) clearTimeout(insufficientFundsTimeoutRef.current);
    };
  }, []);

  // Calls the real persistent purchase action (see
  // @/utils/shop-inventory.ts) — no balance/ownership math lives here.
  // On success, updates local state so the card flips to "Owned"
  // immediately; the balance card at the top updates on its own via the
  // existing subscribeToPetProfile effect above, since purchaseShopItem
  // saves through the same savePetProfile every Pet Care action uses.
  function handlePurchase(item: SampleShopItem) {
    if (purchasingId) return;
    setPurchasingId(item.id);
    purchaseShopItem(item.id, item.price)
      .then((result) => {
        if (result.success) {
          setOwnedIds((prev) => new Set(prev).add(item.id));
          return;
        }
        if (result.reason === 'already-owned') {
          setOwnedIds((prev) => new Set(prev).add(item.id));
          return;
        }
        if (result.reason === 'insufficient-funds') {
          if (insufficientFundsTimeoutRef.current) clearTimeout(insufficientFundsTimeoutRef.current);
          setInsufficientFundsId(item.id);
          insufficientFundsTimeoutRef.current = setTimeout(() => {
            setInsufficientFundsId(null);
          }, INSUFFICIENT_FUNDS_MESSAGE_DURATION_MS);
        }
      })
      .catch(() => {})
      .finally(() => setPurchasingId(null));
  }

  // The single currently-equipped accessory id, if any (see
  // @/utils/pet-equipment.ts) — loaded once on mount so an equip choice
  // made in an earlier session still shows "Equipped" after a
  // refresh/reopen. Only bow-1 can actually be equipped right now, but
  // this reads the real (single-item) equipped value so it's ready for
  // more items later.
  const [equippedId, setEquippedId] = useState<string | null>(null);
  // Which single item (by id) currently has an equip/unequip call in
  // flight — same disable-while-busy guard shape as purchasingId.
  const [equipBusyId, setEquipBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEquippedAccessoryId().then((id) => {
      if (!cancelled) setEquippedId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Calls the real persistent equip/unequip actions (see
  // @/utils/pet-equipment.ts) — no equipped-state bookkeeping lives here.
  // This step only saves/reads the choice; nothing renders the accessory
  // on the pet yet.
  function handleEquipToggle(item: SampleShopItem) {
    if (equipBusyId) return;
    setEquipBusyId(item.id);
    if (equippedId === item.id) {
      unequipAccessory()
        .then(() => setEquippedId(null))
        .catch(() => {})
        .finally(() => setEquipBusyId(null));
    } else {
      equipAccessory(item.id)
        .then((result) => {
          if (result.success) setEquippedId(item.id);
        })
        .catch(() => {})
        .finally(() => setEquipBusyId(null));
    }
  }

  // Desktop-only hover state (mobile/touch never fires onHoverIn) — which
  // single item card, if any, currently has the mouse over it. Same
  // pattern as RoomHubScreen's hoveredRoom.
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  // Same idea, one level down: which single item's action button (Buy, or
  // Equip/✓ Equipped — never both at once for the same item, so one id is
  // enough) currently has the mouse over it specifically, separate from
  // just hovering the card around it.
  const [hoveredButtonId, setHoveredButtonId] = useState<string | null>(null);

  const items = SAMPLE_ITEMS[selectedCategory];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Hero banner — a flat pastel stand-in for the final illustrated
              shopfront scene (awning, shelves, window, mascot) shown in
              shop_reference.png; assets/images/shop_reference.png is a
              design reference only and is never rendered here. The circle
              on the left marks where the mascot illustration will go. */}
          <ThemedView type="peachOverlay" style={styles.hero}>
            <View style={styles.heroMascotPlaceholder}>
              <ThemedText style={styles.heroMascotEmoji}>🐱</ThemedText>
            </View>

            <View style={styles.heroText}>
              <View style={styles.heroTitleRow}>
                <ThemedText style={styles.heroTitle}>Pet Shop</ThemedText>
                <ThemedText style={styles.heroTitlePaw}>🐾</ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.heroSubtitle}>
                Use your Paw Tokens to get cute items for your pet, rooms, and more!
              </ThemedText>
            </View>

            <View style={[styles.balanceCard, { borderColor: theme.purple }]}>
              <ThemedText type="smallBold" themeColor="purple">
                Your Balance
              </ThemedText>
              <View style={styles.balanceRow}>
                <PawTokenCoin size={32} />
                <ThemedText style={styles.balanceNumber}>{pawTokens ?? '—'}</ThemedText>
              </View>
            </View>
          </ThemedView>

          <View style={styles.categoryRow}>
            {SHOP_CATEGORIES.map(({ name, icon, color }) => {
              const isSelected = name === selectedCategory;
              return (
                <Pressable
                  key={name}
                  onPress={() => setSelectedCategory(name)}
                  style={({ pressed }) => [styles.categoryTabWrap, pressed && styles.pressed]}>
                  <View
                    style={[
                      styles.categoryTab,
                      { backgroundColor: isSelected ? theme.purple : theme[color] },
                    ]}>
                    <View style={styles.categoryIconBadge}>
                      <ThemedText style={styles.categoryIconEmoji}>{icon}</ThemedText>
                    </View>
                    <ThemedText type="smallBold" style={isSelected ? styles.categoryLabelActive : undefined}>
                      {name}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.grid}>
            {items.map((item) => (
              <Pressable
                key={item.id}
                onHoverIn={() => setHoveredItemId(item.id)}
                onHoverOut={() => setHoveredItemId(null)}
                style={styles.cardWrap}>
                <ThemedView
                  type="backgroundElementOverlay"
                  style={[
                    styles.card,
                    { borderColor: theme.backgroundSelected },
                    hoveredItemId === item.id && [styles.cardHovered, { borderColor: theme.accent }],
                  ]}>
                  <View style={styles.artPlaceholder}>
                    {item.art ? (
                      <SpriteCrop
                        source={item.art.source}
                        sheetWidth={item.art.sheetWidth}
                        sheetHeight={item.art.sheetHeight}
                        cropX={item.art.cropX}
                        cropY={item.art.cropY}
                        cropWidth={item.art.cropWidth}
                        cropHeight={item.art.cropHeight}
                        size={ART_AREA_SIZE}
                      />
                    ) : (
                      <ThemedText style={styles.artEmoji}>{item.emoji}</ThemedText>
                    )}
                  </View>
                  <ThemedText type="smallBold" style={styles.itemName}>
                    {item.name}
                  </ThemedText>
                  <View style={styles.priceRow}>
                    <PawTokenCoin size={16} />
                    <ThemedText type="smallBold">{item.price}</ThemedText>
                  </View>

                  {item.purchasable ? (
                    ownedIds.has(item.id) ? (
                      <>
                        <View style={[styles.ownedBadge, { backgroundColor: theme.mint }]}>
                          <ThemedText type="smallBold">✓ Owned</ThemedText>
                        </View>
                        {item.equippable ? (
                          <Pressable
                            onPress={() => handleEquipToggle(item)}
                            onHoverIn={() => setHoveredButtonId(item.id)}
                            onHoverOut={() => setHoveredButtonId(null)}
                            disabled={equipBusyId === item.id}
                            style={({ pressed }) => [
                              pressed && styles.pressed,
                              equipBusyId === item.id && styles.buyButtonDisabled,
                            ]}>
                            <View
                              style={[
                                styles.equipButton,
                                {
                                  backgroundColor:
                                    hoveredButtonId === item.id
                                      ? equippedId === item.id
                                        ? EQUIPPED_BUTTON_HOVER_COLOR
                                        : EQUIP_BUTTON_HOVER_COLOR
                                      : equippedId === item.id
                                        ? theme.purple
                                        : theme.sky,
                                },
                                hoveredButtonId === item.id && [
                                  styles.cardHovered,
                                  styles.buttonHoverOutline,
                                  equippedId === item.id
                                    ? { borderColor: theme.purple }
                                    : { borderColor: EQUIP_BUTTON_HOVER_BORDER, shadowColor: EQUIP_BUTTON_HOVER_BORDER },
                                ],
                              ]}>
                              <ThemedText
                                type="smallBold"
                                style={equippedId === item.id ? styles.categoryLabelActive : undefined}>
                                {equipBusyId === item.id
                                  ? '…'
                                  : equippedId === item.id
                                    ? '✓ Equipped'
                                    : 'Equip'}
                              </ThemedText>
                            </View>
                          </Pressable>
                        ) : null}
                      </>
                    ) : insufficientFundsId === item.id ? (
                      <ThemedText type="small" themeColor="accent" style={styles.insufficientFundsText}>
                        Not enough Paw Tokens!
                      </ThemedText>
                    ) : (
                      <>
                        <Pressable
                          onPress={() => handlePurchase(item)}
                          onHoverIn={() => setHoveredButtonId(item.id)}
                          onHoverOut={() => setHoveredButtonId(null)}
                          disabled={purchasingId === item.id}
                          style={({ pressed }) => [
                            pressed && styles.pressed,
                            purchasingId === item.id && styles.buyButtonDisabled,
                          ]}>
                          <View
                            style={[
                              styles.buyButton,
                              { backgroundColor: hoveredButtonId === item.id ? BUY_BUTTON_HOVER_COLOR : theme.accent },
                              hoveredButtonId === item.id && [
                                styles.cardHovered,
                                styles.buttonHoverOutline,
                                { borderColor: theme.accent },
                              ],
                            ]}>
                            <ThemedText type="smallBold" style={styles.buyButtonText}>
                              {purchasingId === item.id ? 'Buying…' : 'Buy'}
                            </ThemedText>
                          </View>
                        </Pressable>
                        {/* TEMPORARY dev/testing control (see
                            @/utils/dev-flags.ts) — lets an unpurchased hat
                            be equipped for visually tuning its placement,
                            without buying it or touching Paw Tokens. Never
                            marks the item as owned. Remove this block
                            along with DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP
                            once hat placements are finished. */}
                        {DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP && item.art?.slot === 'headHat' ? (
                          <Pressable
                            onPress={() => handleEquipToggle(item)}
                            disabled={equipBusyId === item.id}
                            style={({ pressed }) => [
                              pressed && styles.pressed,
                              equipBusyId === item.id && styles.buyButtonDisabled,
                            ]}>
                            <View style={styles.devTestEquipButton}>
                              <ThemedText type="small" style={styles.devTestEquipText}>
                                {equipBusyId === item.id
                                  ? '…'
                                  : equippedId === item.id
                                    ? '🧪 Equipped (test)'
                                    : '🧪 Test Equip'}
                              </ThemedText>
                            </View>
                          </Pressable>
                        ) : null}
                      </>
                    )
                  ) : null}
                </ThemedView>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: SHOP_MAX_WIDTH,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  hero: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
  },
  heroMascotPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMascotEmoji: {
    fontSize: 44,
  },
  heroText: {
    flex: 1,
    minWidth: 220,
    gap: Spacing.one,
    alignItems: 'center',
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  heroTitle: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '700',
    color: '#B983CC',
  },
  heroTitlePaw: {
    fontSize: 26,
  },
  heroSubtitle: {
    textAlign: 'center',
    maxWidth: 360,
  },
  balanceCard: {
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: '#FFFFFF',
    borderRadius: Spacing.four,
    borderWidth: 2,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  balanceNumber: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  categoryTabWrap: {
    flex: 1,
    minWidth: 180,
  },
  categoryTab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  categoryIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIconEmoji: {
    fontSize: 16,
  },
  categoryLabelActive: {
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.85,
  },
  grid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  cardWrap: {
    width: CARD_WIDTH,
  },
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.two,
    gap: Spacing.two,
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  // Subtle hover "lift" — same shape and values as RoomHubScreen's
  // cardHovered (a small scale/translate plus a stronger shadow), reused
  // here rather than inventing a different effect. borderColor itself is
  // set inline (theme-aware) alongside this, same as there.
  cardHovered: {
    transform: [{ scale: 1.03 }, { translateY: -3 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  // Extra "game UI" outline for a hovered action button specifically, on
  // top of cardHovered's shared lift/shadow — borderColor is set inline
  // per button (each button's own base color), since this is a plain
  // outline, not a color change by itself.
  buttonHoverOutline: {
    borderWidth: 2,
  },
  artPlaceholder: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artEmoji: {
    fontSize: 52,
  },
  itemName: {
    textAlign: 'center',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  buyButton: {
    marginTop: Spacing.half,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  buyButtonText: {
    color: '#FFFFFF',
  },
  buyButtonDisabled: {
    opacity: 0.6,
  },
  // TEMPORARY dev/testing button style (see @/utils/dev-flags.ts) —
  // deliberately distinct from buyButton/equipButton (dashed border,
  // transparent fill) so it reads as a test-only control, never confused
  // with a real purchase or equip action. Remove alongside the flag.
  devTestEquipButton: {
    marginTop: Spacing.half,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#B98900',
    backgroundColor: 'rgba(185, 137, 0, 0.1)',
  },
  devTestEquipText: {
    color: '#8A6600',
  },
  ownedBadge: {
    marginTop: Spacing.half,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  equipButton: {
    marginTop: Spacing.half,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  insufficientFundsText: {
    marginTop: Spacing.half,
    textAlign: 'center',
  },
});
