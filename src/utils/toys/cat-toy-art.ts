// Artwork for the Cat Toys, kept apart from prices, inventory and Happiness (see toy-config.ts and
// cat-toys.ts) so a picture can be swapped without touching any game rule.
//
// assets/images/shop/toys/kitty_toys.png is ONE 1774 x 887 sheet of 24 toys in a 6-column x 4-row
// grid. Each slot is addressed by "r<row>c<col>" (1-based, left to right, top to bottom); its crop is
// in ROW_Y / COL_X below. To use a different picture for a toy, change its slot here (or point `source`
// at another file) — nothing else needs to change.
export type ToyArt = {
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
};

const SHEET_SOURCE = require('../../../assets/images/shop/toys/kitty_toys.png') as number;
const SHEET_WIDTH = 1774;
const SHEET_HEIGHT = 887;
// The toys are NOT evenly spaced: a plain 6 x 4 cell split clipped the bottoms of row 1 (mouse tail,
// fish fin, shadows reach past the cell) and pulled slivers of the row above into the next row. So each
// crop is the toy's real bounding box (found from the sheet's transparent gaps) plus a few pixels of
// padding. Rows and columns are separated by empty space, so no crop includes a neighbouring toy.
const ROW_Y: [number, number][] = [
  [23, 254],
  [260, 492],
  [491, 714],
  [715, 874],
];
const COL_X: [number, number][][] = [
  [[32, 292], [351, 582], [659, 866], [906, 1153], [1229, 1411], [1473, 1755]],
  [[16, 301], [346, 603], [656, 884], [960, 1146], [1232, 1426], [1503, 1744]],
  [[30, 271], [349, 531], [593, 843], [896, 1179], [1223, 1424], [1488, 1742]],
  [[27, 278], [347, 571], [646, 846], [933, 1135], [1212, 1458], [1548, 1735]],
];

function catToyArt(row: number, col: number): ToyArt {
  const [y0, y1] = ROW_Y[row - 1];
  const [x0, x1] = COL_X[row - 1][col - 1];
  return {
    source: SHEET_SOURCE,
    sheetWidth: SHEET_WIDTH,
    sheetHeight: SHEET_HEIGHT,
    cropX: x0,
    cropY: y0,
    cropWidth: x1 - x0,
    cropHeight: y1 - y0,
  };
}

// What each of the 24 slots shows (a plain description, NOT a product name — products are named in
// cat-toys.ts only once the player has approved them).
export const CAT_TOY_SHEET_SLOTS: Record<string, { row: number; col: number; shows: string }> = {
  r1c1: { row: 1, col: 1, shows: 'gray-and-white plush mouse with a pink tail' },
  r1c2: { row: 1, col: 2, shows: 'blue plush fish' },
  r1c3: { row: 1, col: 3, shows: 'pink ball of yarn' },
  r1c4: { row: 1, col: 4, shows: 'feather wand with a bow and bell' },
  r1c5: { row: 1, col: 5, shows: 'pastel crinkle ball' },
  r1c6: { row: 1, col: 6, shows: 'yellow chick plush with blue wings' },
  r2c1: { row: 2, col: 1, shows: 'pink paw-print tunnel with a dangling pom-pom' },
  r2c2: { row: 2, col: 2, shows: 'candy-shaped catnip toy with leaves' },
  r2c3: { row: 2, col: 3, shows: 'pink three-tier ball tower' },
  r2c4: { row: 2, col: 4, shows: 'paw on a spring, on a pink base' },
  r2c5: { row: 2, col: 5, shows: 'pink jingle bell ball with star eyes' },
  r2c6: { row: 2, col: 6, shows: 'mint pom-pom with a bow and bell' },
  r3c1: { row: 3, col: 1, shows: 'cream pillow/bolster with dots and a heart' },
  r3c2: { row: 3, col: 2, shows: 'pastel pom-pom ball' },
  r3c3: { row: 3, col: 3, shows: 'pink goldfish plush' },
  r3c4: { row: 3, col: 4, shows: 'cream cat-face bed' },
  r3c5: { row: 3, col: 5, shows: 'arched dangling-toy stand with a star and ball' },
  r3c6: { row: 3, col: 6, shows: 'pink cat-face cube house' },
  r4c1: { row: 4, col: 1, shows: 'pink plush shrimp' },
  r4c2: { row: 4, col: 2, shows: 'green fishbone plush' },
  r4c3: { row: 4, col: 3, shows: 'purple and pink butterfly' },
  r4c4: { row: 4, col: 4, shows: 'white daisy flower' },
  r4c5: { row: 4, col: 5, shows: 'rainbow on clouds' },
  r4c6: { row: 4, col: 6, shows: 'strawberry milk carton' },
};

export function getCatToyArt(slot: string): ToyArt | null {
  const s = CAT_TOY_SHEET_SLOTS[slot];
  return s ? catToyArt(s.row, s.col) : null;
}
