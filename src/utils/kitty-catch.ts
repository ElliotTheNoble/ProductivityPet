// Pure game-mechanics constants/calculations for the Kitty Catch mini-game
// — no storage, no React, no side effects. Deliberately separate from
// kitty-catch-rewards.ts (which owns the persistent high score + Paw
// Token/Happiness reward logic) the same way pet-needs.ts (pure decay
// math) is kept separate from pet-profile.ts (persistence) elsewhere in
// this app. kitty-catch-game.tsx (the actual game component) is the only
// thing that should need both.

export type FallingObjectType =
  | 'yarn'
  | 'mouse'
  | 'fish'
  | 'feather'
  | 'pawTreat'
  | 'star'
  | 'catnip'
  | 'ball'
  | 'fishTreat'
  | 'milk';

export type SpriteArt = {
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
};

// assets/images/mini-games/kitty_catch_icons.png — a 1536x1024 sheet with
// 3 kitty poses (top row) and 10 falling toys/treats (bottom two rows).
// Every crop below was measured via an alpha-channel bounding-box scan of
// the actual file (never guessed), same methodology used for every other
// sprite sheet in this app.
const KITTY_CATCH_ICONS_SOURCE = require('@/assets/images/mini-games/kitty_catch_icons.png');
const KITTY_CATCH_ICONS_SHEET_WIDTH = 1536;
const KITTY_CATCH_ICONS_SHEET_HEIGHT = 1024;

function icon(cropX: number, cropY: number, cropWidth: number, cropHeight: number): SpriteArt {
  return {
    source: KITTY_CATCH_ICONS_SOURCE,
    sheetWidth: KITTY_CATCH_ICONS_SHEET_WIDTH,
    sheetHeight: KITTY_CATCH_ICONS_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

// The 3 kitty poses — see kitty-catch-game.tsx for how movement direction
// picks between these each frame: idle while not moving, the matching
// walk pose while moving left/right. Movement/collision math itself never
// reads these; they're purely which art gets drawn.
export const KITTY_SPRITE_IDLE: SpriteArt = icon(90, 61, 402, 403);
// Swapped from the sheet's left-to-right order — confirmed by actual
// gameplay that the sheet's middle kitty pose reads as facing/walking
// RIGHT on-screen, and the third pose reads as facing/walking LEFT.
export const KITTY_SPRITE_WALK_LEFT: SpriteArt = icon(1070, 66, 432, 407);
export const KITTY_SPRITE_WALK_RIGHT: SpriteArt = icon(560, 75, 468, 398);

export const FALLING_OBJECTS: { type: FallingObjectType; art: SpriteArt; label: string }[] = [
  { type: 'yarn', label: 'Yarn Ball', art: icon(39, 502, 257, 208) },
  { type: 'mouse', label: 'Toy Mouse', art: icon(316, 520, 313, 209) },
  { type: 'fish', label: 'Fish Toy', art: icon(648, 523, 312, 186) },
  { type: 'feather', label: 'Feather Toy', art: icon(980, 485, 269, 243) },
  { type: 'pawTreat', label: 'Paw Treat', art: icon(1274, 506, 220, 211) },
  { type: 'star', label: 'Star Toy', art: icon(42, 730, 244, 247) },
  { type: 'catnip', label: 'Catnip Bag', art: icon(307, 729, 296, 249) },
  { type: 'ball', label: 'Jingle Ball', art: icon(652, 749, 230, 224) },
  { type: 'fishTreat', label: 'Fish Treat', art: icon(938, 770, 285, 186) },
  { type: 'milk', label: 'Milk Carton', art: icon(1270, 729, 212, 253) },
];

export function getFallingObjectArt(type: FallingObjectType): SpriteArt {
  return FALLING_OBJECTS.find((object) => object.type === type)?.art ?? KITTY_SPRITE_IDLE;
}

// Picks one of the 10 falling-object types uniformly at random — which
// specific object appears has no effect on scoring or difficulty, it's
// purely visual variety.
export function getRandomFallingObjectType(): FallingObjectType {
  const index = Math.floor(Math.random() * FALLING_OBJECTS.length);
  return FALLING_OBJECTS[index].type;
}

// Falling speed, in "percent of the game area's height per second" (not
// pixels) — so the same curve plays identically regardless of how tall the
// actual game area renders on a given screen. Starts easy and increases
// gradually: +DIFFICULTY_SPEED_INCREMENT for every DIFFICULTY_CATCH_STEP
// successful catches, capped at KITTY_CATCH_MAX_FALL_SPEED so the game
// never becomes unplayably fast.
export const KITTY_CATCH_BASE_FALL_SPEED = 28; // %/sec
export const KITTY_CATCH_DIFFICULTY_CATCH_STEP = 5;
export const KITTY_CATCH_DIFFICULTY_SPEED_INCREMENT = 6; // %/sec, added per step
export const KITTY_CATCH_MAX_FALL_SPEED = 85; // %/sec

export function getFallSpeedForScore(score: number): number {
  const steps = Math.floor(score / KITTY_CATCH_DIFFICULTY_CATCH_STEP);
  const speed = KITTY_CATCH_BASE_FALL_SPEED + steps * KITTY_CATCH_DIFFICULTY_SPEED_INCREMENT;
  return Math.min(speed, KITTY_CATCH_MAX_FALL_SPEED);
}

// A new saved high score only becomes eligible for the Paw Token bonus
// once it's at least this many points — see kitty-catch-rewards.ts. Kept
// here (not there) since it's really a property of what counts as a
// "real" score in this game, not of the reward system itself.
export const KITTY_CATCH_MIN_SCORE_FOR_BONUS = 5;
