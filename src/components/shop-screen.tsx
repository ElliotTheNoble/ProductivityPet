import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PawTokenCoin } from '@/components/paw-token-coin';
import { SpriteCrop } from '@/components/sprite-crop';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getPetProfile, subscribeToPetProfile } from '@/utils/pet-profile';
import { getOwnedShopItemIds, purchaseShopItem } from '@/utils/shop-inventory';

// How long the "Not enough Paw Tokens!" message stays visible on a card
// before clearing itself — same idea as Home's TEMPORARY_MESSAGE_DURATION_MS.
const INSUFFICIENT_FUNDS_MESSAGE_DURATION_MS = 2500;

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

// assets/images/shop/accessories/bows_1.png — an 8-bow sprite sheet (4x2),
// each already measured via an alpha-channel bounding-box scan (never
// guessed) before this file was touched. Crop coordinates are in the
// sheet's own pixel space.
const BOWS_1_SOURCE = require('@/assets/images/shop/accessories/bows_1.png');
const BOWS_1_SHEET_WIDTH = 1810;
const BOWS_1_SHEET_HEIGHT = 869;

function bowArt(cropX: number, cropY: number, cropWidth: number, cropHeight: number): SpriteArt {
  return {
    source: BOWS_1_SOURCE,
    sheetWidth: BOWS_1_SHEET_WIDTH,
    sheetHeight: BOWS_1_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

// assets/images/shop/accessories/bows_2.png — the replacement 18-bow
// sprite sheet (5x4, last row centered with 3), also already measured via
// an alpha-channel bounding-box scan after the file was replaced with a
// transparent, well-separated version.
const BOWS_2_SOURCE = require('@/assets/images/shop/accessories/bows_2.png');
const BOWS_2_SHEET_WIDTH = 1448;
const BOWS_2_SHEET_HEIGHT = 1086;

function bow2Art(cropX: number, cropY: number, cropWidth: number, cropHeight: number): SpriteArt {
  return {
    source: BOWS_2_SOURCE,
    sheetWidth: BOWS_2_SHEET_WIDTH,
    sheetHeight: BOWS_2_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

// assets/images/shop/accessories/hats_1.png — a 12-hat sprite sheet
// (4x3), also already measured via an alpha-channel bounding-box scan
// before this file was touched.
const HATS_1_SOURCE = require('@/assets/images/shop/accessories/hats_1.png');
const HATS_1_SHEET_WIDTH = 1448;
const HATS_1_SHEET_HEIGHT = 1086;

function hatArt(cropX: number, cropY: number, cropWidth: number, cropHeight: number): SpriteArt {
  return {
    source: HATS_1_SOURCE,
    sheetWidth: HATS_1_SHEET_WIDTH,
    sheetHeight: HATS_1_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

// assets/images/shop/accessories/hats_2.png — the REPLACEMENT 13-hat
// sprite sheet (4x3, plus a 4th row with just the Unicorn Hat), measured
// fresh after the file was replaced with a version spaced farther apart
// so every hat (including the four that used to overlap) now crops
// cleanly. These are the new crop bounds, not the original ones.
const HATS_2_SOURCE = require('@/assets/images/shop/accessories/hats_2.png');
const HATS_2_SHEET_WIDTH = 1448;
const HATS_2_SHEET_HEIGHT = 1086;

function hat2Art(cropX: number, cropY: number, cropWidth: number, cropHeight: number): SpriteArt {
  return {
    source: HATS_2_SOURCE,
    sheetWidth: HATS_2_SHEET_WIDTH,
    sheetHeight: HATS_2_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

// assets/images/shop/accessories/bandanas_1.png — a 12-bandana sprite
// sheet (4x3), also already measured via an alpha-channel bounding-box
// scan before this file was touched.
const BANDANAS_1_SOURCE = require('@/assets/images/shop/accessories/bandanas_1.png');
const BANDANAS_1_SHEET_WIDTH = 1448;
const BANDANAS_1_SHEET_HEIGHT = 1086;

function bandanaArt(cropX: number, cropY: number, cropWidth: number, cropHeight: number): SpriteArt {
  return {
    source: BANDANAS_1_SOURCE,
    sheetWidth: BANDANAS_1_SHEET_WIDTH,
    sheetHeight: BANDANAS_1_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

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
// Pet Accessories is the first category with real artwork (the 8 bows
// from bows_1.png, via `art`) — Room Decor and Backgrounds still use the
// emoji placeholders (`emoji`) until their own real art arrives.
type SpriteArt = {
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
};

type SampleShopItem = {
  id: string;
  name: string;
  price: number;
  emoji?: string;
  art?: SpriteArt;
  // True only for the one test item currently wired up to the real
  // purchase system (see @/utils/shop-inventory.ts) — every other item
  // still just displays, with no Buy control, until purchasing is rolled
  // out to the rest of the Shop in a later step.
  purchasable?: boolean;
};

const SAMPLE_ITEMS: Record<ShopCategory, SampleShopItem[]> = {
  'Pet Accessories': [
    { id: 'bow-1', name: 'Pink Bow', price: 40, art: bowArt(56, 126, 394, 309), purchasable: true },
    { id: 'bow-2', name: 'Purple Bow', price: 40, art: bowArt(506, 129, 378, 300), purchasable: true },
    { id: 'bow-3', name: 'Blue Striped Bow', price: 45, art: bowArt(913, 126, 412, 311), purchasable: true },
    { id: 'bow-4', name: 'Red Bow', price: 40, art: bowArt(1358, 121, 395, 310), purchasable: true },
    { id: 'bow-5', name: 'Cherry Blossom Bow', price: 55, art: bowArt(55, 477, 395, 304), purchasable: true },
    { id: 'bow-6', name: 'Black Cat-Ear Bow', price: 50, art: bowArt(510, 472, 365, 299), purchasable: true },
    { id: 'bow-7', name: 'Holographic Rainbow Bow', price: 70, art: bowArt(914, 482, 403, 305), purchasable: true },
    { id: 'bow-8', name: 'Blue Gingham Lace Bow', price: 50, art: bowArt(1360, 475, 394, 313), purchasable: true },
    { id: 'bow2-1', name: 'Mint Bow', price: 40, art: bow2Art(31, 58, 255, 193), purchasable: true },
    { id: 'bow2-2', name: 'Yellow Bow', price: 40, art: bow2Art(318, 56, 258, 196), purchasable: true },
    { id: 'bow2-3', name: 'Coral Bow', price: 40, art: bow2Art(600, 58, 255, 193), purchasable: true },
    // Named "Sakura Pink Bow" here (rather than repeating "Cherry Blossom
    // Bow" from bow-5 above) for the same reason as "Pastel Holographic
    // Bow" below — avoids two identically-named cards in the same grid.
    { id: 'bow2-4', name: 'Sakura Pink Bow', price: 55, art: bow2Art(881, 57, 257, 193), purchasable: true },
    { id: 'bow2-5', name: 'Starry Lavender Bow', price: 50, art: bow2Art(1160, 55, 263, 196), purchasable: true },
    { id: 'bow2-6', name: 'Navy Starlight Bow', price: 55, art: bow2Art(27, 284, 261, 199), purchasable: true },
    { id: 'bow2-7', name: 'White Bow', price: 35, art: bow2Art(317, 284, 259, 199), purchasable: true },
    { id: 'bow2-8', name: 'Brown Gingham Bow', price: 45, art: bow2Art(599, 287, 258, 196), purchasable: true },
    { id: 'bow2-9', name: 'Brown Fur-Trim Bow', price: 60, art: bow2Art(875, 283, 266, 200), purchasable: true },
    { id: 'bow2-10', name: 'Pink Lace Bow', price: 55, art: bow2Art(1157, 281, 270, 201), purchasable: true },
    { id: 'bow2-11', name: 'Blue Heart Bow', price: 45, art: bow2Art(29, 529, 259, 204), purchasable: true },
    { id: 'bow2-12', name: 'Green Daisy Bow', price: 45, art: bow2Art(318, 527, 258, 204), purchasable: true },
    { id: 'bow2-13', name: 'Red Fur-Trim Bow', price: 60, art: bow2Art(595, 525, 265, 210), purchasable: true },
    { id: 'bow2-14', name: 'Green & Red Striped Bow', price: 50, art: bow2Art(880, 528, 258, 205), purchasable: true },
    { id: 'bow2-15', name: 'Snowflake Bow', price: 55, art: bow2Art(1162, 529, 259, 202), purchasable: true },
    { id: 'bow2-16', name: 'Black & Pink Heart Bow', price: 50, art: bow2Art(235, 788, 282, 211), purchasable: true },
    // Named "Pastel Holographic Bow" here (rather than repeating "Holographic
    // Rainbow Bow" from bow-7 above) so the two don't show up as identically-
    // named cards side by side — same bow family as bow-7, different sheet.
    { id: 'bow2-17', name: 'Pastel Holographic Bow', price: 70, art: bow2Art(589, 790, 275, 209), purchasable: true },
    { id: 'bow2-18', name: 'Purple Lace Gingham Bow', price: 55, art: bow2Art(926, 790, 300, 214), purchasable: true },
    { id: 'hat-1', name: 'White Cat-Ear Beanie', price: 45, art: hatArt(26, 64, 307, 249), purchasable: true },
    { id: 'hat-2', name: 'Black Cat-Ear Beanie', price: 45, art: hatArt(390, 66, 302, 246), purchasable: true },
    { id: 'hat-3', name: 'Bunny-Ear Hat', price: 50, art: hatArt(721, 73, 370, 242), purchasable: true },
    { id: 'hat-4', name: 'Bear-Ear Hat', price: 50, art: hatArt(1115, 81, 314, 232), purchasable: true },
    { id: 'hat-5', name: 'Frog Hat', price: 40, art: hatArt(25, 418, 313, 235), purchasable: true },
    { id: 'hat-6', name: 'Duck Hat', price: 40, art: hatArt(392, 401, 298, 249), purchasable: true },
    { id: 'hat-7', name: 'Strawberry Hat', price: 45, art: hatArt(751, 407, 309, 240), purchasable: true },
    { id: 'hat-8', name: 'Bee Hat', price: 45, art: hatArt(1121, 392, 297, 258), purchasable: true },
    { id: 'hat-9', name: 'Mushroom Hat', price: 50, art: hatArt(16, 750, 331, 220), purchasable: true },
    { id: 'hat-10', name: 'Witch Hat', price: 55, art: hatArt(371, 740, 331, 226), purchasable: true },
    { id: 'hat-11', name: 'Wizard Hat', price: 60, art: hatArt(732, 739, 344, 246), purchasable: true },
    { id: 'hat-12', name: 'Rainbow Party Hat', price: 65, art: hatArt(1139, 717, 260, 271), purchasable: true },
    { id: 'hat2-1', name: 'Pumpkin Hat', price: 45, art: hat2Art(25, 25, 330, 244), purchasable: true },
    { id: 'hat2-2', name: 'Reindeer Antler Headband', price: 55, art: hat2Art(412, 34, 328, 227), purchasable: true },
    { id: 'hat2-3', name: 'Santa Hat', price: 55, art: hat2Art(773, 46, 333, 217), purchasable: true },
    { id: 'hat2-4', name: 'Christmas Bell Hat', price: 55, art: hat2Art(1137, 43, 294, 216), purchasable: true },
    { id: 'hat2-5', name: 'Pink Heart Beret', price: 40, art: hat2Art(25, 336, 305, 188), purchasable: true },
    { id: 'hat2-6', name: 'Cream Paw Beret', price: 40, art: hat2Art(380, 324, 310, 199), purchasable: true },
    { id: 'hat2-7', name: 'Brown Plaid Beret', price: 45, art: hat2Art(731, 339, 316, 188), purchasable: true },
    { id: 'hat2-8', name: 'Yellow Sun Hat', price: 45, art: hat2Art(1077, 340, 354, 189), purchasable: true },
    { id: 'hat2-9', name: 'Winter Beanie', price: 50, art: hat2Art(47, 568, 266, 241), purchasable: true },
    { id: 'hat2-10', name: 'Shark Hat', price: 60, art: hat2Art(383, 581, 302, 236), purchasable: true },
    { id: 'hat2-11', name: 'Cow Hat', price: 50, art: hat2Art(734, 595, 317, 214), purchasable: true },
    { id: 'hat2-12', name: 'Dino Hat', price: 55, art: hat2Art(1127, 581, 280, 230), purchasable: true },
    { id: 'hat2-13', name: 'Unicorn Hat', price: 65, art: hat2Art(571, 824, 282, 231), purchasable: true },
    { id: 'bandana-1', name: 'Pink Heart Bandana', price: 40, art: bandanaArt(25, 113, 346, 211), purchasable: true },
    { id: 'bandana-2', name: 'Blue Gingham Cat Bandana', price: 45, art: bandanaArt(394, 125, 316, 197), purchasable: true },
    { id: 'bandana-3', name: 'Strawberry Bandana', price: 45, art: bandanaArt(735, 111, 328, 216), purchasable: true },
    { id: 'bandana-4', name: 'Daisy Bandana', price: 40, art: bandanaArt(1090, 119, 334, 216), purchasable: true },
    { id: 'bandana-5', name: 'Red Polka Dot Bell Bandana', price: 50, art: bandanaArt(25, 397, 345, 216), purchasable: true },
    { id: 'bandana-6', name: 'Green Sprout Bandana', price: 35, art: bandanaArt(392, 391, 322, 220), purchasable: true },
    { id: 'bandana-7', name: 'Purple Moon & Star Bandana', price: 55, art: bandanaArt(738, 403, 333, 207), purchasable: true },
    { id: 'bandana-8', name: 'Pink Gingham Lace Heart Bandana', price: 50, art: bandanaArt(1087, 397, 335, 219), purchasable: true },
    { id: 'bandana-9', name: 'Cow Print Bandana', price: 45, art: bandanaArt(21, 695, 346, 216), purchasable: true },
    { id: 'bandana-10', name: 'Blue Snowflake Bandana', price: 50, art: bandanaArt(387, 681, 328, 229), purchasable: true },
    { id: 'bandana-11', name: 'Black Paw Bandana', price: 45, art: bandanaArt(729, 693, 342, 218), purchasable: true },
    { id: 'bandana-12', name: 'Orange Gingham Pumpkin Bandana', price: 50, art: bandanaArt(1086, 686, 344, 225), purchasable: true },
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

  // Desktop-only hover state (mobile/touch never fires onHoverIn) — which
  // single item card, if any, currently has the mouse over it. Same
  // pattern as RoomHubScreen's hoveredRoom.
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

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
                      <View style={[styles.ownedBadge, { backgroundColor: theme.mint }]}>
                        <ThemedText type="smallBold">✓ Owned</ThemedText>
                      </View>
                    ) : insufficientFundsId === item.id ? (
                      <ThemedText type="small" themeColor="accent" style={styles.insufficientFundsText}>
                        Not enough Paw Tokens!
                      </ThemedText>
                    ) : (
                      <Pressable
                        onPress={() => handlePurchase(item)}
                        disabled={purchasingId === item.id}
                        style={({ pressed }) => [
                          pressed && styles.pressed,
                          purchasingId === item.id && styles.buyButtonDisabled,
                        ]}>
                        <View style={[styles.buyButton, { backgroundColor: theme.accent }]}>
                          <ThemedText type="smallBold" style={styles.buyButtonText}>
                            {purchasingId === item.id ? 'Buying…' : 'Buy'}
                          </ThemedText>
                        </View>
                      </Pressable>
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
  ownedBadge: {
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
