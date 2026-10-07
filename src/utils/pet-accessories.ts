// Shared sprite-crop data for Pet Accessories that can be equipped and
// shown on the pet — kept separate from the Shop's own full item catalog
// (see @/components/shop-screen.tsx) specifically so the Shop's card
// artwork and the on-pet overlay (@/components/pet-placeholder.tsx) read
// the exact same crop from the exact same file, rather than two
// independently-maintained copies of the same numbers. Only entries for
// accessories that are actually equippable belong here — the Shop's full
// catalog (63 items) is not duplicated here, just the ones wired up to
// equipping so far: all 26 bows, all 25 hats_1.png/hats_2.png hats, and
// all 12 bandanas_1.png bandanas, as of this file.

import type { AccessoryPlacement, AccessorySlot, PetSurface } from '@/utils/pet-accessory-placement';
import type { PetStage } from '@/utils/pet-stage';

export type AccessoryArt = {
  // Which placement rule this accessory uses (see
  // @/utils/pet-accessory-placement.ts) — e.g. every bow is worn at the
  // neck/collar, so every bow entry here uses 'neckCollar', regardless of
  // which specific bow it is.
  slot: AccessorySlot;
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  // Optional: per-ITEM placement overrides, keyed [surface][stage], that
  // take precedence over the shared slot placement from
  // @/utils/pet-accessory-placement.ts for this one item only. Most items
  // in a slot (e.g. most hats) share that slot's placement exactly and
  // never need this — it only exists for an item whose own shape doesn't
  // fit the slot's shared placement well once visually tested. Partial at
  // both levels, same convention as the shared table: "no override for
  // this surface/stage" just falls back to the shared placement, it's
  // never an error or a guess.
  placementOverrides?: Partial<Record<PetSurface, Partial<Record<PetStage, AccessoryPlacement>>>>;
};

// assets/images/shop/accessories/bows_1.png — an 8-bow sprite sheet
// (4x2); assets/images/shop/accessories/bows_2.png — the replacement
// 18-bow sprite sheet (5x4, last row centered with 3). Both already
// measured via an alpha-channel bounding-box scan (never guessed/
// re-measured here) — these are the exact same crop coordinates
// shop-screen.tsx's own catalog already uses for each bow's card art.
const BOWS_1_SOURCE = require('@/assets/images/shop/accessories/bows_1.png');
const BOWS_1_SHEET_WIDTH = 1810;
const BOWS_1_SHEET_HEIGHT = 869;

const BOWS_2_SOURCE = require('@/assets/images/shop/accessories/bows_2.png');
const BOWS_2_SHEET_WIDTH = 1448;
const BOWS_2_SHEET_HEIGHT = 1086;

function bowArt(cropX: number, cropY: number, cropWidth: number, cropHeight: number): AccessoryArt {
  return {
    slot: 'neckCollar',
    source: BOWS_1_SOURCE,
    sheetWidth: BOWS_1_SHEET_WIDTH,
    sheetHeight: BOWS_1_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

function bow2Art(cropX: number, cropY: number, cropWidth: number, cropHeight: number): AccessoryArt {
  return {
    slot: 'neckCollar',
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
// (4x3). Replaced with a corrected version where the unwanted inside/
// lining visible on the old White Cat-Ear Beanie art no longer appears —
// these are the crop bounds measured fresh via an alpha-channel
// bounding-box scan of the new file, not the old file's coordinates. The
// exact same crop coordinates shop-screen.tsx's own catalog uses for each
// hat's card art.
const HATS_1_SOURCE = require('@/assets/images/shop/accessories/hats_1.png');
const HATS_1_SHEET_WIDTH = 1536;
const HATS_1_SHEET_HEIGHT = 1024;

function hatArt(
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
  placementOverrides?: AccessoryArt['placementOverrides']
): AccessoryArt {
  return {
    slot: 'headHat',
    source: HATS_1_SOURCE,
    sheetWidth: HATS_1_SHEET_WIDTH,
    sheetHeight: HATS_1_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    placementOverrides,
  };
}

// assets/images/shop/accessories/hats_2.png — the replacement 13-hat
// sprite sheet (4x3, plus a 4th row with just the Unicorn Hat), same crop
// coordinates shop-screen.tsx's own catalog uses for each hat's card art.
const HATS_2_SOURCE = require('@/assets/images/shop/accessories/hats_2.png');
const HATS_2_SHEET_WIDTH = 1536;
const HATS_2_SHEET_HEIGHT = 1024;

function hat2Art(
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
  placementOverrides?: AccessoryArt['placementOverrides']
): AccessoryArt {
  return {
    slot: 'headHat',
    source: HATS_2_SOURCE,
    sheetWidth: HATS_2_SHEET_WIDTH,
    sheetHeight: HATS_2_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    placementOverrides,
  };
}

// assets/images/shop/accessories/bandanas_1.png — a 12-bandana sprite
// sheet (4x3); unchanged/not replaced, so these are the same crop
// coordinates shop-screen.tsx's own catalog already uses for each
// bandana's card art. Worn at the neck, but kept as its own 'neckBandana'
// slot rather than reusing 'neckCollar' — a bandana ties differently than
// a bow and may need different placement math once tuned, and sharing a
// slot would also force it to share bows' placement table, which isn't
// appropriate for a differently-shaped accessory.
const BANDANAS_1_SOURCE = require('@/assets/images/shop/accessories/bandanas_1.png');
const BANDANAS_1_SHEET_WIDTH = 1448;
const BANDANAS_1_SHEET_HEIGHT = 1086;

function bandanaArt(
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
  placementOverrides?: AccessoryArt['placementOverrides']
): AccessoryArt {
  return {
    slot: 'neckBandana',
    source: BANDANAS_1_SOURCE,
    sheetWidth: BANDANAS_1_SHEET_WIDTH,
    sheetHeight: BANDANAS_1_SHEET_HEIGHT,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    placementOverrides,
  };
}

// Keyed by the same SampleShopItem id used in shop-screen.tsx (e.g.
// 'bow-1'), so a given equippedAccessoryId (see @/utils/pet-equipment.ts)
// can be looked up here directly. All 26 bows share the 'neckCollar' slot
// and read their placement from the shared table in
// @/utils/pet-accessory-placement.ts (via bowArt/bow2Art above) — bows are
// similar enough in shape that this works well for all of them. Every
// headHat and neckBandana item instead needs its own placementOverrides
// (see pet-placeholder.tsx's gating) — an item with none equips fine but
// renders nothing on the pet until it gets one.
export const PET_ACCESSORY_ART: Record<string, AccessoryArt> = {
  'bow-1': bowArt(56, 126, 394, 309),
  'bow-2': bowArt(506, 129, 378, 300),
  'bow-3': bowArt(913, 126, 412, 311),
  'bow-4': bowArt(1358, 121, 395, 310),
  'bow-5': bowArt(55, 477, 395, 304),
  'bow-6': bowArt(510, 472, 365, 299),
  'bow-7': bowArt(914, 482, 403, 305),
  'bow-8': bowArt(1360, 475, 394, 313),
  'bow2-1': bow2Art(31, 58, 255, 193),
  'bow2-2': bow2Art(318, 56, 258, 196),
  'bow2-3': bow2Art(600, 58, 255, 193),
  'bow2-4': bow2Art(881, 57, 257, 193),
  'bow2-5': bow2Art(1160, 55, 263, 196),
  'bow2-6': bow2Art(27, 284, 261, 199),
  'bow2-7': bow2Art(317, 284, 259, 199),
  'bow2-8': bow2Art(599, 287, 258, 196),
  'bow2-9': bow2Art(875, 283, 266, 200),
  'bow2-10': bow2Art(1157, 281, 270, 201),
  'bow2-11': bow2Art(29, 529, 259, 204),
  'bow2-12': bow2Art(318, 527, 258, 204),
  'bow2-13': bow2Art(595, 525, 265, 210),
  'bow2-14': bow2Art(880, 528, 258, 205),
  'bow2-15': bow2Art(1162, 529, 259, 202),
  'bow2-16': bow2Art(235, 788, 282, 211),
  'bow2-17': bow2Art(589, 790, 275, 209),
  'bow2-18': bow2Art(926, 790, 300, 214),
  // Approved Baby placement, reached through many rounds of visual
  // tuning — do not alter these values. Previously lived in the shared
  // headHat table in pet-accessory-placement.ts; moved here verbatim
  // (same numbers, same rendered result) now that headHat items each
  // need their own override instead of a shared default.
  'hat-1': hatArt(31, 91, 308, 230, {
    home: {
      Egg: { width: '34%', marginTop: '2%' },
      Hatchling: { width: '34%', marginTop: '2%' },
      Baby: { width: '76%', marginTop: '13%', marginLeft: '4%', rotate: '2deg' },
      Young: { width: '34%', marginTop: '2%' },
      Adult: { width: '34%', marginTop: '2%' },
    },
  }),
  // Approved Baby placement, reached through several rounds of visual
  // tuning (very different from hat-1's, confirming hats need their own
  // per-item placement) — do not alter these values.
  'hat-12': hatArt(1208, 669, 285, 290, {
    home: {
      Baby: { width: '46%', marginTop: '14%', marginLeft: '10%', rotate: '6deg' },
    },
  }),
  // Baby placementOverride: starting from hat-1's approved placement
  // since the Black Cat-Ear Beanie is essentially the same overall shape
  // as the White Cat-Ear Beanie — not yet independently visually
  // confirmed for hat-2 specifically.
  'hat-2': hatArt(409, 83, 320, 242, {
    home: {
      Baby: { width: '76%', marginTop: '13%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 8 points — horizontal position, vertical position, and rotation kept
  // the same as that starting point. Not yet fully confirmed.
  'hat-3': hatArt(764, 88, 396, 242, {
    home: {
      Baby: { width: '120%', marginTop: '7%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 8 points — horizontal position, vertical position, and rotation kept
  // the same as that starting point. Not yet fully confirmed.
  'hat-4': hatArt(1177, 88, 328, 237, {
    home: {
      Baby: { width: '84%', marginTop: '13%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved down
  // 4 points — width, horizontal position, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  'hat-5': hatArt(30, 413, 314, 220, {
    home: {
      Baby: { width: '76%', marginTop: '20%', marginLeft: '6%', rotate: '4deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved up
  // 4 points — width, horizontal position, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  'hat-6': hatArt(435, 385, 305, 246, {
    home: {
      Baby: { width: '81%', marginTop: '13%', marginLeft: '8%', rotate: '4deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved
  // slightly right — width, marginTop, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  'hat-7': hatArt(803, 393, 325, 238, {
    home: {
      Baby: { width: '84%', marginTop: '16%', marginLeft: '5%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 4 points — marginTop, marginLeft, and rotation kept the same as that
  // starting point. Not yet fully confirmed.
  'hat-8': hatArt(1196, 375, 301, 254, {
    home: {
      Baby: { width: '80%', marginTop: '10%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved down
  // 8 points — width, horizontal position, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  'hat-9': hatArt(21, 714, 336, 219, {
    home: {
      Baby: { width: '85%', marginTop: '22%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved right
  // 4 points — width, marginTop, and rotation kept the same as that
  // starting point. Not yet fully confirmed.
  'hat-10': hatArt(398, 702, 355, 236, {
    home: {
      Baby: { width: '76%', marginTop: '13%', marginLeft: '8%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved right
  // 4 points — width, marginTop, and rotation kept the same as that
  // starting point. Not yet fully confirmed.
  'hat-11': hatArt(786, 699, 358, 252, {
    home: {
      Baby: { width: '76%', marginTop: '13%', marginLeft: '8%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 6 points and moved down 5 points — marginLeft and rotation kept the
  // same as that starting point. Not yet fully confirmed.
  'hat2-1': hat2Art(18, 18, 335, 249, {
    home: {
      Baby: { width: '85%', marginTop: '11%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 8 points and moved down 8 points — marginLeft and rotation kept the
  // same as that starting point. Not yet fully confirmed.
  'hat2-2': hat2Art(382, 24, 358, 238, {
    home: {
      Baby: { width: '96%', marginTop: '11%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved right
  // 3 points and down 4 points — width and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  'hat2-3': hat2Art(775, 35, 353, 224, {
    home: {
      Baby: { width: '96%', marginTop: '14%', marginLeft: '19%', rotate: '2deg', scaleX: 1.08 },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then given an 8%
  // horizontal-only stretch via scaleX — width, marginTop, marginLeft,
  // and rotation kept the same as that starting point. Not yet fully
  // confirmed.
  'hat2-4': hat2Art(1166, 30, 327, 233, {
    home: {
      Baby: { width: '76%', marginTop: '13%', marginLeft: '7%', rotate: '2deg', scaleX: 1.08 },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved down
  // 4 points — width, horizontal position, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  'hat2-5': hat2Art(22, 295, 327, 194, {
    home: {
      Baby: { width: '76%', marginTop: '17%', marginLeft: '10%', rotate: '8deg', scaleX: 1.08 },
    },
  }),
  // Baby placementOverride: copied verbatim from the approved Pink Heart
  // Beret (hat2-5) placement, since this hat should sit in the exact
  // same position/size/stretch/angle as that one.
  'hat2-6': hat2Art(400, 292, 336, 199, {
    home: {
      Baby: { width: '73%', marginTop: '19%', marginLeft: '10%', rotate: '8deg', scaleX: 1.08 },
    },
  }),
  // Baby placementOverride: copied verbatim from the approved Pink Heart
  // Beret (hat2-5) placement, since this hat should sit in the exact
  // same position/size/stretch/angle as that one.
  'hat2-7': hat2Art(775, 305, 341, 196, {
    home: {
      Baby: { width: '76%', marginTop: '23%', marginLeft: '12%', rotate: '8deg', scaleX: 1.08 },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved down
  // 8 points — width, horizontal position, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  'hat2-8': hat2Art(1151, 307, 365, 186, {
    home: {
      Baby: { width: '76%', marginTop: '25%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved up
  // 4 points — width, horizontal position, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  'hat2-9': hat2Art(34, 515, 287, 244, {
    home: {
      Baby: { width: '76%', marginTop: '6%', marginLeft: '4%', rotate: '2deg', scaleX: 1.08 },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 6 points and moved down 5 points — marginLeft and rotation kept the
  // same as that starting point. Not yet fully confirmed.
  'hat2-10': hat2Art(393, 520, 338, 239, {
    home: {
      Baby: { width: '91%', marginTop: '13%', marginLeft: '4%', rotate: '2deg', scaleX: 1.11 },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 6 points and moved down 5 points — marginLeft and rotation kept the
  // same as that starting point. Not yet fully confirmed.
  'hat2-11': hat2Art(787, 531, 338, 227, {
    home: {
      Baby: { width: '88%', marginTop: '18%', marginLeft: '4%', rotate: '2deg', scaleX: 1.15 },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 6 points — marginTop, marginLeft, and rotation kept the same as that
  // starting point. Not yet fully confirmed.
  'hat2-12': hat2Art(1188, 522, 301, 236, {
    home: {
      Baby: { width: '82%', marginTop: '13%', marginLeft: '7%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 6 points and moved down 5 points — marginLeft and rotation kept the
  // same as that starting point. Not yet fully confirmed.
  'hat2-13': hat2Art(591, 760, 326, 231, {
    home: {
      Baby: { width: '82%', marginTop: '19%', marginLeft: '1%', rotate: '2deg', scaleX: 1.05 },
    },
  }),
  'bandana-1': bandanaArt(25, 113, 346, 211),
  'bandana-2': bandanaArt(394, 125, 316, 197),
  'bandana-3': bandanaArt(735, 111, 328, 216),
  'bandana-4': bandanaArt(1090, 119, 334, 216),
  'bandana-5': bandanaArt(25, 397, 345, 216),
  'bandana-6': bandanaArt(392, 391, 322, 220),
  'bandana-7': bandanaArt(738, 403, 333, 207),
  'bandana-8': bandanaArt(1087, 397, 335, 219),
  'bandana-9': bandanaArt(21, 695, 346, 216),
  'bandana-10': bandanaArt(387, 681, 328, 229),
  'bandana-11': bandanaArt(729, 693, 342, 218),
  'bandana-12': bandanaArt(1086, 686, 344, 225),
};
