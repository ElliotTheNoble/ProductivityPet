import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PawTokenCoin } from '@/components/paw-token-coin';
import { PetAvatar } from '@/components/pet-avatar';
import { SpriteCrop } from '@/components/sprite-crop';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP } from '@/utils/dev-flags';
import {
  getDevPreviewStageIndex,
  subscribeToDevPreviewStageIndex,
} from '@/utils/dev-stage-preview';
import { PET_ACCESSORY_ART } from '@/utils/pet-accessories';
import type { AccessorySlot } from '@/utils/pet-accessory-placement';
import { equipAccessory, getEquippedAccessoryId, unequipAccessory } from '@/utils/pet-equipment';
import { getRenderedStage } from '@/utils/pet-growth';
import { getPetProfile, subscribeToPetProfile } from '@/utils/pet-profile';
import { PET_STAGES } from '@/utils/pet-stage';
import { getOwnedShopItemIds, purchaseShopItem } from '@/utils/shop-inventory';
import { getCachedTasks } from '@/utils/task-storage';
import { getCompletedTaskCount, type Task } from '@/utils/tasks';

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
// The illustrated banner (title, subtitle, and an empty "Your Balance"
// card with a Paw Token coin already drawn in) replaces the old plain
// ThemedView hero entirely — see bannerWrap/bannerBalanceOverlay below.
// Its real pixel dimensions (2170x725) give the exact aspect ratio the
// responsive wrapper is locked to, so the banner can stretch to fill the
// available width at any screen size without ever cropping or stretching
// out of proportion.
const SHOP_BANNER = require('@/assets/images/shop/Shop_Banner.png');
const SHOP_BANNER_ASPECT_RATIO = 2170 / 725;
// Where the empty space beside the coin sits, as a fraction of the
// banner's own width/height — measured directly off Shop_Banner.png.
// Deliberately generous (taller/wider than the coin alone) so the number
// stays comfortably clear of the coin and the card's rounded right edge
// even for a 4-digit balance, and recenters itself correctly at every
// banner size since it's computed from the same measured bannerWidth the
// Image itself renders at (see the onLayout handler below) rather than a
// fixed pixel position.
const BANNER_BALANCE_LEFT_FRACTION = 0.87;
const BANNER_BALANCE_TOP_FRACTION = 0.47;
const BANNER_BALANCE_WIDTH_FRACTION = 0.115;
const BANNER_BALANCE_HEIGHT_FRACTION = 0.2;
// Dark purple matching the "Your Balance" label already painted into the
// banner art, so the overlaid number reads as part of the same design
// rather than a mismatched patch.
const BANNER_BALANCE_TEXT_COLOR = '#6D4C91';

// Wider than the app's usual MaxContentWidth (800) — the item grid and
// the wide banner both need more breathing room than a single reading-
// width column gives, same reasoning RoomHubScreen uses for its own,
// similarly wide ROOMS_MAX_WIDTH.
const SHOP_MAX_WIDTH = 1180;
// Narrowed from 246 so 3 cards fit per row (up from 2) within
// mainColumn's own width, now that the Kitty Preview sidebar
// (PREVIEW_PANEL_WIDTH) shares the row with the grid — comfortably at
// mainColumn's typical/maximum width (~768px, i.e. most real desktop
// windows, which are wider than SHOP_MAX_WIDTH and so keep mainColumn
// pinned at its cap); a desktop browser window narrower than roughly
// 1050px may still wrap to 2, the same kind of responsive reflow every
// grid on this page already does at small sizes.
const CARD_WIDTH = 228;
// Below this width (web only — see isDesktopPreview below), the Kitty
// Preview becomes a collapsible inline section instead of a docked
// sidebar, same "desktop two-column vs. stacked" boundary idea as
// DESKTOP_MIN_WIDTH in room-hub-screen.tsx/stats-screen.tsx, just a touch
// wider since this page also needs room for a sidebar (PREVIEW_PANEL_WIDTH,
// below) next to the item grid, not just more grid columns.
const DESKTOP_PREVIEW_BREAKPOINT = 900;
// Widened from 280 to comfortably fit PREVIEW_KITTY_SIZE (315 — see
// below) plus a little breathing room on each side, now that the Kitty
// is wider than the old sidebar column; previewKittyFrame has no
// overflow: 'hidden' of its own, so a column narrower than the frame
// would let it visibly spill out toward the product grid/screen edge.
const PREVIEW_PANEL_WIDTH = 340;
// Large enough that a worn hat/bow's shape and color actually read
// clearly (unlike the old 76px header circle, which only needed to
// confirm an accessory was equipped, not show it off). 180 * 1.75 = 315,
// per the player's explicit "75% bigger" request.
const PREVIEW_KITTY_SIZE = 315;
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
// explicitly out of scope for this step. Exactly 8 per category, purely
// for a tidy placeholder count — unlike Pet Accessories below, this isn't
// tuned to any particular column count.
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

// --- How this screen fits together (plain-language overview) ---
// - Background & banner: the Shop's pastel background and illustrated
//   banner are just images layered behind/above the page's own content —
//   see shop_background.png (rendered in src/app/_layout.tsx, the same
//   way every other screen's background works) and SHOP_BANNER
//   (bannerWrap/bannerImage below). Title/subtitle/"Your Balance" are
//   painted directly into the banner picture, not separate text.
// - Live balance: a small number is drawn on top of the banner, in the
//   empty spot next to the coin art, showing the real pawTokens value
//   (bannerBalanceOverlay/bannerBalanceNumber below).
// - Kitty preview: a big picture of the player's actual pet (PetAvatar),
//   shown on the right side of the page. It always matches whatever
//   stage/accessory is really saved — see displayedStage and
//   previewDisplayAccessoryId below for exactly how.
// - Try-on: tapping an accessory's picture in the grid shows it on the
//   preview Kitty temporarily, without buying or equipping it — see
//   previewAccessoryId.
// - Staying in view while scrolling: on a wide screen, the Kitty preview
//   uses CSS "sticky" positioning so it stays on screen as the player
//   scrolls past the long item grid — see previewPanelSticky.
// - The accessory grid: cards wrap onto new rows automatically based on
//   how many fit — narrowing/widening CARD_WIDTH is what changes how
//   many columns show.
export function ShopScreen() {
  const theme = useTheme();
  const [selectedCategory, setSelectedCategory] = useState<ShopCategory>('Pet Accessories');

  // The banner's own actually-rendered width (it's width: '100%' of
  // mainColumn, so this varies with screen size/sidebar presence) — used
  // to compute both the balance-number overlay's position and its font
  // size as fractions of this real measured value (see
  // BANNER_BALANCE_*_FRACTION above and bannerBalanceOverlay's inline
  // style below), so the overlay tracks the image exactly at every size
  // instead of a fixed-pixel position/font that would drift out of place
  // the moment the banner itself scales up or down.
  const [bannerWidth, setBannerWidth] = useState(0);

  // The real pawTokens value from the persistent Pet Profile (see
  // @/utils/pet-profile.ts) — same reactive pattern AppHeader uses, so
  // this stays current without polling or a page refresh. Purely a
  // display here; nothing on this page reads or writes it otherwise.
  const [pawTokens, setPawTokens] = useState<number | null>(null);
  // paidStageIndex from that same profile — needed, together with tasks
  // below, to compute the pet's real growth stage for the header mascot
  // (see petStage/PetAvatar further down). Same "once true, never revert"
  // floor Home itself reads this for (see getRenderedStage in
  // @/utils/pet-growth.ts); defaults to 0 (no paid upgrade) until the
  // real profile loads, exactly like Home's own `petProfile?.paidStageIndex
  // ?? 0` fallback.
  const [paidStageIndex, setPaidStageIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPetProfile().then((profile) => {
      if (!cancelled) {
        setPawTokens(profile.pawTokens);
        setPaidStageIndex(profile.paidStageIndex);
      }
    });
    const unsubscribe = subscribeToPetProfile((profile) => {
      if (!cancelled) {
        setPawTokens(profile.pawTokens);
        setPaidStageIndex(profile.paidStageIndex);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // The same task list Home reads completedTaskCount from (see
  // @/utils/task-storage.ts's shared in-memory cache) — loaded here purely
  // to compute the mascot's real growth stage below; this screen doesn't
  // otherwise read or write tasks at all.
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    let cancelled = false;
    getCachedTasks().then((cached) => {
      if (!cancelled) setTasks(cached);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The pet's real, saved growth stage — identical computation to Home's
  // own petStage (see src/app/index.tsx) — so the Shop preview is never a
  // separate guess at progression. NOT what gets rendered directly below
  // though — see displayedStage.
  const completedTaskCount = getCompletedTaskCount(tasks);
  const petStage = getRenderedStage(completedTaskCount, paidStageIndex);

  // Pet Stage Preview (see @/utils/dev-stage-preview.ts) — a shared,
  // in-memory (never persisted) override set from Home's Pet Progress
  // panel, specifically so it survives navigating to a different
  // route/component (plain component-local state can't, since Home
  // itself unmounts on navigation) — this is the exact same module Home
  // reads from for its own displayedStage, imported directly rather than
  // reimplemented, so Shop can never drift out of sync with whatever
  // Home is actually showing. BUG-FIX: previously Shop only ever read
  // petStage (the real stage), so it kept showing the real stage (Adult,
  // for the player who reported this) regardless of an active preview —
  // this subscription is what was missing.
  const [devPreviewStageIndex, setDevPreviewStageIndexState] = useState<number | null>(() =>
    getDevPreviewStageIndex()
  );
  useEffect(() => subscribeToDevPreviewStageIndex(setDevPreviewStageIndexState), []);

  // What actually gets rendered on the preview Kitty — identical formula
  // to Home's own displayedStage (src/app/index.tsx): the previewed stage
  // when one is active, the real stage otherwise. Deliberately does NOT
  // account for Home's separate "Dev: Replay Hatching Animation" feature
  // (devHatchReplayShowingEgg/devHatchIntroPreviewAt in index.tsx) — that
  // one simulates a real hatch event in progress and is scoped tightly to
  // Home's own hatch-intro animation, not a general stage preview, so it
  // isn't part of what the player asked Shop to reuse here.
  const displayedStage = devPreviewStageIndex !== null ? PET_STAGES[devPreviewStageIndex] : petStage;

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

  // Desktop browsers only (native Android/iOS always gets the compact
  // collapsible treatment below, regardless of device/tablet width) — see
  // DESKTOP_PREVIEW_BREAKPOINT above. `position: 'sticky'` (used by
  // previewPanelSticky further down) is a web-only CSS feature with no
  // native equivalent, so gating on Platform.OS here keeps native from
  // ever receiving it.
  const { width } = useWindowDimensions();
  const isDesktopPreview = Platform.OS === 'web' && width >= DESKTOP_PREVIEW_BREAKPOINT;
  // Mobile/narrow only — starts collapsed so the preview never covers the
  // item grid by default (see requirement in the panel's own JSX below).
  const [isMobilePreviewExpanded, setIsMobilePreviewExpanded] = useState(false);

  // Which accessory (if any) is being temporarily "tried on" the preview
  // kitty instead of its real equippedId — set by tapping an item's own
  // artwork thumbnail below, never persisted and never equips/purchases
  // anything by itself (see handleEquipToggle/handlePurchase above, both
  // completely separate actions). Cleared by the "Remove Preview" button,
  // or automatically on a category switch (a previewed accessory from a
  // tab that's no longer showing would otherwise linger invisibly).
  const [previewAccessoryId, setPreviewAccessoryId] = useState<string | null>(null);

  useEffect(() => {
    setPreviewAccessoryId(null);
  }, [selectedCategory]);

  // What the preview kitty actually shows right now: the tried-on item if
  // one is active, otherwise whatever's really equipped — same Egg-stage
  // "no accessories" rule as the rest of the app (see BUG-006 in bugs.md
  // and PetAvatar's own equippedAccessoryId doc comment). Gated on
  // displayedStage (not petStage) — same reasoning as Home's own
  // isDisplayedEgg (src/app/index.tsx): while a Pet Stage Preview is
  // showing Egg, accessories should hide here too, even if the REAL
  // stage (petStage) is already past Egg.
  const previewDisplayAccessoryId = displayedStage === 'Egg' ? null : previewAccessoryId ?? equippedId;

  const items = SAMPLE_ITEMS[selectedCategory];

  // Shared between the desktop sticky sidebar and the mobile collapsible
  // section below so the two never drift into two different-looking
  // previews — only their surrounding container/trigger differs. Just the
  // Kitty sprite itself now — no card background/border, title, or
  // instruction text (removed per the player's request; the old "Remove
  // Preview" button is gone too, replaced by tapping the Kitty itself —
  // see the Pressable below — so there's no extra UI chrome, just the
  // sprite). PetAvatar is pointerEvents="none" by design (it's meant to
  // be purely decorative everywhere else it's used, e.g. the Shop
  // header's old mascot slot), so the tap target here is this wrapping
  // Pressable, not PetAvatar itself — disabled whenever there's nothing
  // to clear, so it's inert (not just invisibly clickable) once the
  // preview already matches the real equipped accessory.
  const previewPanelContent = (
    <Pressable
      disabled={!previewAccessoryId}
      onPress={() => setPreviewAccessoryId(null)}
      style={styles.previewKittyFrame}>
      <PetAvatar stage={displayedStage} equippedAccessoryId={previewDisplayAccessoryId} size={PREVIEW_KITTY_SIZE} />
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, isDesktopPreview && styles.scrollContentRow]}
          showsVerticalScrollIndicator={false}>
          {/* Everything except the preview sidebar — on desktop this is the
              flex:1 left column (see mainColumnDesktop) that scrolls
              underneath the sticky sidebar to its right; on mobile it's
              simply the whole page, full width. */}
          <View style={[styles.mainColumn, isDesktopPreview && styles.mainColumnDesktop]}>
          {/* Illustrated banner — replaces the old plain pastel hero
              entirely (title, subtitle, and the "Your Balance" card are
              all painted into Shop_Banner.png itself now). width: '100%'
              of mainColumn + a fixed aspectRatio (the image's own real
              2170x725 proportions) is what lets this fill the available
              column width at any screen size with zero cropping/
              distortion or overflow — it can never be wider than its own
              parent, so it's always fully visible and correctly centered
              by construction. contentFit="contain" is a second guarantee
              of the same "never crop/distort" rule, though with the
              aspect ratio already matched exactly it never actually needs
              to add letterboxing. (A previous version of this tried to
              enlarge the banner past 100% via a negative left margin —
              reverted: the ScrollView clips horizontal overflow, so that
              bled portion was actually just getting cut off rather than
              rendered, which is what cropped the kitty on the left.) The
              real pet used to live in a small circle in the old hero; it
              now has its own much larger "Try It On!" preview panel (see
              previewPanelContent above and its desktop/mobile placement
              below) so its accessories can actually be seen clearly. */}
          <View style={styles.bannerWrap} onLayout={(e) => setBannerWidth(e.nativeEvent.layout.width)}>
            <Image source={SHOP_BANNER} style={styles.bannerImage} contentFit="contain" />
            {/* The banner art already draws the coin and the empty card
                around it — this only adds the live number beside it, kept
                in sync with the real pawTokens state above (same source
                AppHeader's own balance pill reads from). Position/size are
                both computed from the real measured bannerWidth (not a
                fixed pixel guess) so the number tracks the coin exactly
                as the banner itself scales up or down. */}
            <View
              pointerEvents="none"
              style={[
                styles.bannerBalanceOverlay,
                {
                  left: bannerWidth * BANNER_BALANCE_LEFT_FRACTION,
                  top: (bannerWidth / SHOP_BANNER_ASPECT_RATIO) * BANNER_BALANCE_TOP_FRACTION,
                  width: bannerWidth * BANNER_BALANCE_WIDTH_FRACTION,
                  height: (bannerWidth / SHOP_BANNER_ASPECT_RATIO) * BANNER_BALANCE_HEIGHT_FRACTION,
                },
              ]}>
              <ThemedText
                numberOfLines={1}
                style={[styles.bannerBalanceNumber, { fontSize: Math.max(14, bannerWidth * 0.032) }]}>
                {pawTokens ?? '—'}
              </ThemedText>
            </View>
          </View>

          {!isDesktopPreview ? (
            <>
              <Pressable
                onPress={() => setIsMobilePreviewExpanded((prev) => !prev)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={styles.mobilePreviewToggle}>
                  <ThemedText type="smallBold">
                    🐾 Kitty Preview {isMobilePreviewExpanded ? '▾' : '▸'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
              {/* No card background here (per the player's request — see
                  previewPanelContent's own comment) — a plain View purely
                  for layout (centers the Kitty), the toggle pill above it
                  is still the only visible "chrome" on mobile. The
                  bottom-anchored sticky treatment below is desktop-only
                  (see previewPanelSticky) — mobile's Kitty just sits at
                  its natural position inside this expanded section. */}
              {isMobilePreviewExpanded ? (
                <View style={styles.mobilePreviewPanel}>{previewPanelContent}</View>
              ) : null}
            </>
          ) : null}

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
                  {/* Tapping the artwork itself (separate from Buy/Equip
                      below) temporarily previews this accessory on the
                      Kitty Preview panel — see previewAccessoryId above.
                      Only wired for equippable items; Room Decor/
                      Backgrounds items don't render on the pet at all, so
                      pressing theirs would do nothing anyway. */}
                  <Pressable
                    disabled={!item.equippable}
                    onPress={() => setPreviewAccessoryId(item.id)}
                    style={[
                      styles.artPlaceholder,
                      item.equippable && previewAccessoryId === item.id && [
                        styles.artPlaceholderPreviewing,
                        { borderColor: theme.accent },
                      ],
                    ]}>
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
                  </Pressable>
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
          </View>

          {isDesktopPreview ? (
            // position: 'sticky' — see previewPanelSticky's own comment for
            // why this needs a type cast, and why it's safe to apply
            // unconditionally here (isDesktopPreview already guarantees
            // Platform.OS === 'web'). Sticks within THIS ScrollView's own
            // scroll container (not the whole window), per the "within the
            // actual Shop scrolling container" requirement — anchored to
            // `bottom` now (see previewPanelSticky), so the Kitty sits low
            // in the viewport, near the bottom-right, instead of near the
            // top — alignSelf: 'flex-start' (on previewPanel) keeps it
            // from being stretched to mainColumn's full height, which
            // would otherwise throw off that bottom anchoring.
            <View style={[styles.previewPanel, styles.previewPanelSticky]}>
              {previewPanelContent}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // Transparent so the shared Shop background rendered in
  // src/app/_layout.tsx (behind the now-transparent header too — see
  // app-header.tsx's isImmersiveRoute) shows through as one continuous
  // image, instead of ThemedView's own default opaque fill (theme.background,
  // applied whenever no `type` prop is given) hiding it. Same technique
  // Home/Tasks/Stats/Mini-Games already use for their own backgrounds.
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: SHOP_MAX_WIDTH,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    // No top padding — keeps the banner as close to the navigation header
    // as this layout can safely get it without a negative margin (an
    // earlier attempt at pulling it up further, past this, via a negative
    // marginTop on bannerWrap was reverted along with the equivalent
    // horizontal version — see bannerWrap's own comment). The banner's
    // own art still has some transparent padding baked into the top of
    // the image itself, which this can't remove — only trimming the
    // source PNG could do that.
    paddingTop: 0,
    paddingBottom: Spacing.four,
  },
  // Desktop only (see isDesktopPreview) — turns the ScrollView's content
  // into a row of two columns (mainColumn + the sticky previewPanel
  // sibling added in the JSX) instead of one stacked column. alignItems:
  // 'flex-start' keeps the sticky sidebar from being stretched to
  // mainColumn's full height.
  scrollContentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.four,
  },
  // The vertical gap between hero/the mobile preview toggle/categoryRow/
  // grid now lives here (moved off scrollContent above) so it applies the
  // same way whether mainColumn is the page's only column (mobile) or the
  // left column of a desktop row (mainColumnDesktop below).
  mainColumn: {
    width: '100%',
    gap: Spacing.three,
  },
  // minWidth: 0 matters on web: a flex: 1 row child otherwise refuses to
  // shrink below its content's intrinsic width (the grid's natural
  // width), which would push the sticky sidebar out past the row's own
  // bounds at in-between window sizes instead of letting the grid reflow
  // to fewer columns first.
  mainColumnDesktop: {
    flex: 1,
    minWidth: 0,
  },
  // Locked to the banner art's own real aspect ratio (see
  // SHOP_BANNER_ASPECT_RATIO) so width: '100%' scales it to fill
  // mainColumn at any screen size with the height following
  // proportionally — never cropped, never stretched out of shape.
  // position: 'relative' is what lets bannerBalanceOverlay below position
  // itself against this box specifically, not the whole page.
  // Deliberately no margin/left offset of any kind: width: '100%' always
  // exactly fills mainColumn (never more, never bled past it), which both
  // guarantees the whole image stays visible — it's physically impossible
  // for a 100%-of-parent box to overflow its own parent — and centers it
  // correctly for free, since mainColumn itself is already centered on
  // the page. aspectRatio (the image's own real 2170x725 proportions) is
  // what turns that one width into the correct height automatically, so
  // it's never stretched or distorted either.
  bannerWrap: {
    width: '100%',
    aspectRatio: SHOP_BANNER_ASPECT_RATIO,
    position: 'relative',
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  // Positioned/sized via inline style (computed from the real measured
  // bannerWidth — see the JSX above), not here; this just supplies the
  // parts that don't change with that measurement.
  bannerBalanceOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerBalanceNumber: {
    color: BANNER_BALANCE_TEXT_COLOR,
    fontWeight: '700',
    textAlign: 'center',
  },
  // Desktop sticky sidebar (see isDesktopPreview/scrollContentRow above).
  // alignSelf: 'flex-start' is the other half of scrollContentRow's own
  // alignItems: 'flex-start' — without both, this panel would stretch to
  // match mainColumn's full height, which would throw off the bottom
  // anchoring below (a stretched box's own bottom edge sits at the very
  // end of that huge height, not snugly around the Kitty). No background/
  // border/shadow/padding (removed per the player's request — see
  // previewPanelContent's own comment) — purely a positioning box: fixed
  // width so the sticky sidebar has a stable column to sit in,
  // alignItems: 'center' to center the Kitty inside it (unchanged by the
  // marginTop below, so the Kitty's horizontal position doesn't move).
  //
  // marginTop — this panel's own un-stuck/static position starts at the
  // very top of the row (same y as the banner, next to mainColumn); this
  // pushes that static starting point down before anything else
  // (previewPanelSticky's own bottom offset, computed independently) gets
  // applied on top of it, so the Kitty ends up visibly lower regardless
  // of how sticky's own threshold math resolves — not dependent on the
  // ScrollView's scroll position, and not something any surrounding
  // container clips: nothing between this panel and the ScrollView sets
  // overflow: 'hidden' or a fixed/max height that would cut it off (the
  // row's own height is governed by mainColumn, which is far taller than
  // this panel either way), and mainColumn/scrollContentRow are confirmed
  // not to.
  //
  // Was 500 (tuned for the old 180px Kitty, paws landing on the rug).
  // previewKittyFrame grows straight down from this same top-anchored
  // point (normal flow — height added below the top, not above it), so
  // growing the Kitty to 315px (+135 — see PREVIEW_KITTY_SIZE) would have
  // pushed its paws 135px further down than before, off the rug, if this
  // weren't reduced by that same 135 (500 - 135 = 365) to compensate —
  // keeping the Kitty's BOTTOM edge (where the paws are) anchored at the
  // same vertical position as before, with the extra height added above
  // it instead of below.
  previewPanel: {
    width: PREVIEW_PANEL_WIDTH,
    alignSelf: 'flex-start',
    alignItems: 'center',
    marginTop: 365,
  },
  // position: 'sticky' is a web-only CSS value (react-native-web passes
  // it straight through to the DOM) with no equivalent in React Native's
  // own ViewStyle type (which only allows 'absolute' | 'relative' |
  // 'static') — the `as any` is scoped to just this one literal so it
  // doesn't weaken type-checking anywhere else. Only ever applied when
  // isDesktopPreview is true, which already requires Platform.OS ===
  // 'web', so this never reaches native.
  //
  // `bottom` instead of `top`: standard CSS sticky lets an element anchor
  // to either edge of its scroll container's viewport. Since this panel's
  // own normal (non-sticky) position is short and near the top of a much
  // taller page (the product grid below it), a bottom anchor keeps it
  // pinned low in the visible Shop area — "sitting on the rug" near the
  // bottom-right — from the moment the page loads and all the way through
  // scrolling, rather than pinned near the top the way `top` would.
  previewPanelSticky: {
    position: 'sticky' as any,
    bottom: Spacing.four,
  },
  previewKittyFrame: {
    width: PREVIEW_KITTY_SIZE,
    height: PREVIEW_KITTY_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Mobile/narrow only (see isMobilePreviewExpanded above) — a small,
  // tappable pill rather than the full panel, so the collapsed state
  // takes almost no vertical space and never crowds the item grid below.
  mobilePreviewToggle: {
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    alignSelf: 'flex-start',
  },
  // The expanded mobile panel sits inline in normal document flow (not
  // absolutely positioned/floating) specifically so it can never overlap
  // the item grid below it — expanding it simply pushes the grid further
  // down the page, exactly like any other section on this screen. No
  // background/border/padding anymore (see previewPanel's own comment) —
  // just centers the Kitty.
  mobilePreviewPanel: {
    alignItems: 'center',
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
  // Highlights whichever item's artwork is the one currently "tried on"
  // the Kitty Preview panel (see previewAccessoryId) — borderColor is set
  // inline (theme.accent), same pattern as every other hover/active state
  // on this screen.
  artPlaceholderPreviewing: {
    borderWidth: 3,
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
