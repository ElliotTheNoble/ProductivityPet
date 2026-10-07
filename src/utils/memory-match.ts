// Pure game-mechanics constants/calculations for Kitty Memory Match — no
// storage, no React, no side effects. Deliberately separate from
// memory-match-rewards.ts (which owns the persistent Best Moves records +
// Paw Token/Happiness reward logic), and deliberately independent of
// kitty-catch.ts/kitty-catch-rewards.ts — the two games share no code, so
// nothing about this one can affect Kitty Catch.

export type MemoryMatchDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

export const MEMORY_MATCH_DIFFICULTIES: MemoryMatchDifficulty[] = ['easy', 'medium', 'hard', 'expert'];

export type DifficultyInfo = { pairs: number; label: string };

// Pairs selected (out of the 24 unique faces below) and total cards
// (pairs * 2) per difficulty.
export const MEMORY_MATCH_DIFFICULTY_INFO: Record<MemoryMatchDifficulty, DifficultyInfo> = {
  easy: { pairs: 8, label: 'Easy' },
  medium: { pairs: 12, label: 'Medium' },
  hard: { pairs: 16, label: 'Hard' },
  expert: { pairs: 24, label: 'Expert' },
};

export type SpriteArt = {
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
};

// assets/images/mini-games/memory_match_icons.png — a 1774x887 sheet: 24
// numbered card illustrations (3 rows of 8/8/8, with row 3's 9th slot
// being the separate card-back design) plus reference number labels
// printed BELOW each card (outside the card's own colored rounded-rect
// background). Every crop below is the card's own rect ONLY — measured
// via an alpha-channel bounding-box scan of just the card-background rows
// (never guessed), stopping well above where the number labels start, so
// no reference number ever appears as part of the playable card face.
const MEMORY_MATCH_ICONS_SOURCE = require('@/assets/images/mini-games/memory_match_icons.png');
const MEMORY_MATCH_ICONS_SHEET_WIDTH = 1774;
const MEMORY_MATCH_ICONS_SHEET_HEIGHT = 887;

function icon(cropX: number, cropY: number, cropWidth: number, cropHeight: number): SpriteArt {
  return {
    source: MEMORY_MATCH_ICONS_SOURCE,
    sheetWidth: MEMORY_MATCH_ICONS_SHEET_WIDTH,
    sheetHeight: MEMORY_MATCH_ICONS_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

// Cards 1-24, in the sheet's own left-to-right, top-to-bottom reading
// order (index 0 = card "1" = sleepy kitty face, ... index 23 = card "24"
// = sleeping kitty). Only the index into this array is ever used
// elsewhere (as a card's faceIndex) — the specific picture each index
// shows is purely cosmetic, same as Kitty Catch's falling-object variety.
export const MEMORY_MATCH_CARD_FACES: SpriteArt[] = [
  icon(22, 24, 183, 232), // 1 kitty face
  icon(216, 24, 184, 232), // 2 paw print
  icon(409, 24, 184, 233), // 3 fish (blue)
  icon(602, 25, 184, 232), // 4 yarn ball
  icon(796, 24, 183, 233), // 5 fish cracker
  icon(988, 24, 184, 232), // 6 heart
  icon(1182, 24, 183, 233), // 7 star
  icon(1377, 24, 186, 232), // 8 bow (pink)
  icon(22, 304, 183, 228), // 9 daisy
  icon(215, 304, 184, 228), // 10 cherry blossom
  icon(408, 304, 184, 228), // 11 sunflower
  icon(602, 304, 184, 228), // 12 tulip
  icon(794, 304, 184, 228), // 13 butterfly
  icon(988, 304, 184, 228), // 14 bee
  icon(1182, 304, 185, 228), // 15 strawberry
  icon(1380, 304, 185, 228), // 16 cherries
  icon(20, 579, 181, 233), // 17 crescent moon
  icon(209, 579, 180, 233), // 18 cloud
  icon(398, 579, 182, 233), // 19 crown
  icon(588, 579, 182, 234), // 20 bow (purple)
  icon(776, 579, 176, 233), // 21 boba tea
  icon(961, 579, 184, 234), // 22 cake slice
  icon(1154, 579, 191, 233), // 23 books
  icon(1354, 579, 203, 234), // 24 sleeping kitty
];

// The one shared face-down design, used for every card until it's flipped.
// Re-measured via an alpha bounding-box scan restricted to just this
// sprite's own column (x 1572-1758): unlike the row-3 face cards (whose
// content starts flush at y=578, matching the row), the card-back artwork
// itself extends about 27px higher — its rounded top edge and both top
// hearts sit above y=578 — so the original crop (cropY 578) sliced
// straight through them. This crop's bottom edge (813) is unchanged, it
// was already correct.
export const MEMORY_MATCH_CARD_BACK: SpriteArt = icon(1572, 551, 186, 263);

// Card art is a portrait rectangle, not square — representative of the 24
// crops above (they vary by a few px each from natural illustration
// bounds, but are all close to this). Used by computeMemoryMatchGridLayout
// below to size cards without stretching/distorting them.
export const MEMORY_MATCH_CARD_ASPECT_RATIO = 183 / 232;

function shuffle<T>(items: T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

export type MemoryMatchCard = {
  id: string;
  // Index into MEMORY_MATCH_CARD_FACES — two cards with the same
  // faceIndex are a matching pair.
  faceIndex: number;
};

// Builds one freshly-shuffled board for a difficulty: randomly selects
// `pairs` of the 24 faces, duplicates each into a pair, then shuffles the
// full set — called once per round (including "Play Again"), so no two
// rounds show the same layout. Easy=8 random faces, Medium=12, Hard=16,
// Expert=24 (all of them, so Expert's selection step is a no-op, only the
// shuffle varies).
export function createMemoryMatchBoard(difficulty: MemoryMatchDifficulty): MemoryMatchCard[] {
  const { pairs } = MEMORY_MATCH_DIFFICULTY_INFO[difficulty];
  const allFaceIndices = MEMORY_MATCH_CARD_FACES.map((_, index) => index);
  const chosenFaceIndices = shuffle(allFaceIndices).slice(0, pairs);

  const cards: MemoryMatchCard[] = chosenFaceIndices.flatMap((faceIndex) => [
    { id: `${faceIndex}-a`, faceIndex },
    { id: `${faceIndex}-b`, faceIndex },
  ]);

  return shuffle(cards);
}

export type MemoryMatchGridLayout = {
  columns: number;
  rows: number;
  cardWidth: number;
  cardHeight: number;
};

// Picks how many grid columns to use and how big each card is, given the
// REAL measured space available (not a fixed per-difficulty layout) — for
// every possible column count (1 up to totalCards), computes how big an
// aspect-ratio-preserving card could be while fitting both the available
// width AND the available height, then picks whichever column count
// yields the LARGEST card. This is what makes the grid automatically use
// more columns when width is abundant (landscape/desktop) and fewer
// columns when height is scarce (portrait), and what keeps Expert's 48
// cards shrinking to fit instead of overflowing/forcing a scroll — no
// per-difficulty or per-orientation branching needed, it all falls out of
// this one calculation against whatever box it's actually given.
//
// `forcedColumns` opts out of that search and locks the column count to
// one specific value (still solving for the largest aspect-ratio-correct
// card that fits within it) — used only for Easy, which always wants a
// 4x4 board rather than whichever column count the generic search would
// otherwise prefer (e.g. 8x2, which maximizes card size on a wide screen
// but isn't the 4x4 layout requested for Easy specifically).
export function computeMemoryMatchGridLayout(
  totalCards: number,
  availableWidth: number,
  availableHeight: number,
  gap: number,
  forcedColumns?: number
): MemoryMatchGridLayout | null {
  if (totalCards <= 0 || availableWidth <= 0 || availableHeight <= 0) return null;

  const candidateColumns = forcedColumns
    ? [forcedColumns]
    : Array.from({ length: totalCards }, (_, index) => index + 1);

  let best: MemoryMatchGridLayout | null = null;
  for (const columns of candidateColumns) {
    const rows = Math.ceil(totalCards / columns);
    const widthPerCard = (availableWidth - gap * (columns - 1)) / columns;
    const heightPerCard = (availableHeight - gap * (rows - 1)) / rows;
    if (widthPerCard <= 0 || heightPerCard <= 0) continue;

    const cardWidth = Math.min(widthPerCard, heightPerCard * MEMORY_MATCH_CARD_ASPECT_RATIO);
    const cardHeight = cardWidth / MEMORY_MATCH_CARD_ASPECT_RATIO;

    if (!best || cardWidth > best.cardWidth) {
      best = { columns, rows, cardWidth, cardHeight };
    }
  }
  return best;
}
