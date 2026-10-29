// Artwork for Pet Pawadise. All of it is the player's own pictures, only REFERENCED (never modified,
// cropped on disk or re-saved); crops are applied when drawing.
export const PAWADISE_SCENE = require('../../assets/images/rooms/backgrounds/pawadise/Pawadise_enterance.png') as number;
// The picture's real proportions (1672 x 941), so it is shown whole at any width.
export const PAWADISE_SCENE_ASPECT_RATIO = 1672 / 941;

// The mailbox that bounces around Home when a postcard arrives (the file is named "maill_box.png").
export const MAILBOX_ART = require('../../assets/images/rooms/backgrounds/pawadise/maill_box.png') as number;
export const MAILBOX_ASPECT_RATIO = 1443 / 1090;
// The envelope shown before a postcard is opened (1536 x 1024, transparent corners).
export const ENVELOPE_ART = require('../../assets/images/rooms/backgrounds/pawadise/Envelope.png') as number;
export const ENVELOPE_ASPECT_RATIO = 1536 / 1024;

// ---- Postcards ----
// Each postcard file is ONE picture holding TWO postcards side by side with a transparent gap between
// them: the LEFT one is the front (the "Greetings from Pawadise!" picture) and the RIGHT one is the back
// (the handwritten message). Their bounding boxes were measured from the files' transparent gaps, with a
// few pixels of padding that stay inside that gap, so a crop never shows the other side.
export type PostcardRegion = { x: number; y: number; width: number; height: number };

export type PostcardDesign = {
  // Saved on a postcard record as its `image` value (see pawadise-postcards.ts).
  key: string;
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  front: PostcardRegion;
  back: PostcardRegion;
};

const PAD = 5;

function region(sheetW: number, sheetH: number, box: [number, number, number, number]): PostcardRegion {
  const x0 = Math.max(0, box[0] - PAD);
  const y0 = Math.max(0, box[1] - PAD);
  const x1 = Math.min(sheetW, box[2] + 1 + PAD);
  const y1 = Math.min(sheetH, box[3] + 1 + PAD);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function design(
  key: string,
  source: number,
  w: number,
  h: number,
  front: [number, number, number, number],
  back: [number, number, number, number]
): PostcardDesign {
  return { key, source, sheetWidth: w, sheetHeight: h, front: region(w, h, front), back: region(w, h, back) };
}


// Cat postcards: kitty_card_1.png ... kitty_card_10.png.
export const CAT_POSTCARD_DESIGNS: PostcardDesign[] = [
  design('cat-postcard-1', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_1.png') as number, 1774, 887, [33, 42, 864, 846], [915, 42, 1742, 846]),
  design('cat-postcard-2', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_2.png') as number, 1774, 887, [37, 52, 865, 868], [909, 52, 1734, 868]),
  design('cat-postcard-3', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_3.png') as number, 1774, 887, [25, 31, 881, 864], [896, 31, 1749, 863]),
  design('cat-postcard-4', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_4.png') as number, 2017, 780, [71, 34, 922, 770], [1139, 34, 1931, 768]),
  design('cat-postcard-5', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_5.png') as number, 2019, 779, [32, 24, 888, 765], [1125, 24, 1993, 764]),
  design('cat-postcard-6', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_6.png') as number, 2019, 779, [52, 31, 891, 762], [1128, 31, 1945, 761]),
  design('cat-postcard-7', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_7.png') as number, 2019, 779, [36, 24, 910, 761], [1106, 23, 1983, 761]),
  design('cat-postcard-8', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_8.png') as number, 2018, 779, [44, 24, 920, 764], [1092, 25, 1966, 765]),
  design('cat-postcard-9', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_9.png') as number, 2019, 779, [44, 21, 941, 762], [1064, 21, 1950, 766]),
  design('cat-postcard-10', require('../../assets/images/rooms/backgrounds/pawadise/kitty_post_cards/kitty_card_10.png') as number, 2019, 779, [37, 21, 911, 758], [1106, 22, 1981, 757]),
];

// Postcard designs per pet species (a species' key in PetRecord.species; missing = 'cat'). To give another
// species postcards, add its designs here — delivery and the viewer read only this registry. A species with
// no entry never receives postcards.
export const POSTCARD_DESIGNS_BY_SPECIES: Record<string, PostcardDesign[]> = {
  cat: CAT_POSTCARD_DESIGNS,
};

export function getPostcardDesign(key: string | null): PostcardDesign | null {
  if (!key) return null;
  for (const list of Object.values(POSTCARD_DESIGNS_BY_SPECIES)) {
    const found = list.find((d) => d.key === key);
    if (found) return found;
  }
  return null;
}
