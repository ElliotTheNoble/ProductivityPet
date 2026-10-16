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
  //
  // Hatchling: replaced the old leftover placeholder (it was just a copy
  // of Egg/Young/Adult's own placeholder, never actually tuned for
  // Hatchling specifically) with a real first estimate, derived from
  // measuring pet_hatchling.png directly: her topmost art (a small heart
  // decoration above her head) sits only ~1.5% down her own picture —
  // almost no empty space above her head at all — compared to Baby's
  // picture, where the equivalent topmost content doesn't start until
  // ~29% down (Baby has much more empty canvas above her head). Scaled
  // proportionally against Baby's own confirmed marginTop (13%, i.e.
  // roughly 45% of the way down to where Baby's own content begins) gives
  // a Hatchling marginTop of only a few percent — she needs the hat to
  // sit almost immediately at the top of her own box, not partway down
  // it the way Baby's does. Width kept close to Baby's 76% as a starting
  // point (Hatchling's own head already spans a comparably large % of
  // her picture's width). Pending visual confirmation on the real Home
  // pet — same iterative process as Baby's and the bow's own placements.
  // Adjusted per direct visual feedback, several rounds now: width grew
  // ~10% per round (70% → 77% → 85% → 94%), then pulled back down 5%
  // and another 3% (94% → 89% → 86%, now holding steady); marginTop
  // moved up several rounds (3% → -2% → -7% → -12% → -15% → -17%), then
  // back down 2 (-17% → -15%) — still horizontally centered (no
  // marginLeft) and unrotated (no rotate), both unchanged from before.
  'hat-1': hatArt(31, 91, 308, 230, {
    home: {
      Egg: { width: '34%', marginTop: '2%' },
      Hatchling: { width: '86%', marginTop: '-15%' },
      Baby: { width: '76%', marginTop: '13%', marginLeft: '4%', rotate: '2deg' },
      Young: { width: '34%', marginTop: '2%' },
      Adult: { width: '34%', marginTop: '2%' },
    },
  }),
  // Approved Baby placement, reached through several rounds of visual
  // tuning (very different from hat-1's, confirming hats need their own
  // per-item placement) — do not alter these values.
  //
  // Hatchling placementOverride: no entry existed yet — created one by
  // copying Baby's own placement verbatim as a starting point (same width/
  // marginLeft/rotate), then moved up 15 points per direct visual
  // feedback (marginTop 14% → -1%), then 5 more points (-1% → -6%).
  // marginLeft then nudged 2 points left (10% → 8%) per direct visual
  // feedback. Pending visual confirmation, same as every other
  // Hatchling hat so far.
  'hat-12': hatArt(1208, 669, 285, 290, {
    home: {
      Hatchling: { width: '46%', marginTop: '-6%', marginLeft: '8%', rotate: '6deg' },
      Baby: { width: '46%', marginTop: '14%', marginLeft: '10%', rotate: '6deg' },
    },
  }),
  // Baby placementOverride: starting from hat-1's approved placement
  // since the Black Cat-Ear Beanie is essentially the same overall shape
  // as the White Cat-Ear Beanie — not yet independently visually
  // confirmed for hat-2 specifically.
  //
  // Hatchling placementOverride: same idea, starting from hat-1's own
  // current (several-rounds-tuned) Hatchling placement verbatim, as an
  // initial starting point — not yet independently visually confirmed
  // for hat-2 specifically.
  'hat-2': hatArt(409, 83, 320, 242, {
    home: {
      Hatchling: { width: '86%', marginTop: '-15%' },
      Baby: { width: '76%', marginTop: '13%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 8 points — horizontal position, vertical position, and rotation kept
  // the same as that starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: initial estimate, derived from hat-1's
  // own real, several-rounds-tuned Hatchling result rather than guessing
  // fresh — hat-1 (White Cat-Ear Beanie) went from Baby's 76%/13% to a
  // visually-confirmed-so-far 86%/-15% for Hatchling, i.e. roughly ×1.13
  // wider and marginTop shifted down ~28 points. Applying that same
  // scaling to this hat's own Baby values (120%/7%) gives 136%/-21% —
  // Bunny Hat needs more width than hat-1 to begin with since its tall
  // upward ears need more vertical reach too (height follows from width
  // via the sprite's own aspect ratio), and this keeps that same
  // proportionally-larger relationship for Hatchling. Started
  // horizontally centered per instructions (unlike Baby's slight 4%
  // offset), then nudged 2 points left per direct visual feedback
  // (marginLeft: none → '-2%') — width/marginTop/rotate all unchanged
  // from that starting point. Pending further visual confirmation, same
  // as every other Hatchling hat so far.
  'hat-3': hatArt(764, 88, 396, 242, {
    home: {
      Hatchling: { width: '136%', marginTop: '-21%', marginLeft: '-2%' },
      Baby: { width: '120%', marginTop: '7%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 8 points — horizontal position, vertical position, and rotation kept
  // the same as that starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: initial estimate was width 95%/marginTop
  // -15% (same hat-1-derived scaling used for hat-3's Bunny Hat). Several
  // rounds of width/scaleX/scaleY experimentation followed (width grew to
  // 105%, scaleX swung as high as 1.155 and as low as 0.982 before
  // settling at 1.137, scaleY settled at 0.9 to independently shrink the
  // rendered height — `width` alone always scales both dimensions
  // together via the sprite's own aspect ratio, which is why scaleX/
  // scaleY exist at all; see their own comments in
  // @/utils/pet-accessory-placement.ts). Per request, that width history
  // was then explicitly reverted: width restored to its very first value
  // (95%) and scaleX removed entirely (no horizontal stretch), leaving
  // marginTop (-23%, since nudged several times after the original -15%)
  // and scaleY (0.9) exactly as they were — scaleY is a HEIGHT control,
  // not part of the width/stretch history being undone here, so it still
  // applies on top of this smaller 95% base width; flag if that's not
  // wanted too. Horizontally centered (no marginLeft) and unrotated,
  // both unchanged throughout. marginTop nudged down 3 points four times
  // after the revert (-23% → -20% → -17% → -14% → -11%) per direct
  // visual feedback. scaleX reintroduced (1.05) to widen the rendered
  // width 5% horizontally-only, leaving base width (95%)/scaleY
  // (0.9)/marginTop untouched, so rendered height is unaffected. Pending
  // further visual confirmation.
  'hat-4': hatArt(1177, 88, 328, 237, {
    home: {
      Hatchling: { width: '95%', marginTop: '-11%', scaleX: 1.05, scaleY: 0.9 },
      Baby: { width: '84%', marginTop: '13%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved down
  // 4 points — width, horizontal position, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one by
  // copying Baby's own placement verbatim as a starting point (same width/
  // marginLeft/rotate), then moved up 5 points twice per direct visual
  // feedback (marginTop 20% → 15% → 10%), then sized up 10% overall via
  // `width` alone (76% → 84%, no scaleX/scaleY — this hat has never
  // needed independent-axis control, so a plain proportional width bump
  // is correct here, unlike hat-4/Bear Hat's history) — marginLeft/
  // rotate unchanged by that resize. marginTop then nudged up once more
  // (10% → 5%). Widened another 5% horizontally-only via `scaleX` three
  // times (1.05 → 1.1025 → 1.1576), then pulled back 10% per direct
  // visual feedback (1.1576 → 1.0418) — base width/marginTop/marginLeft/
  // rotate all unchanged throughout, so rendered height is unaffected —
  // same mechanism used on hat-4's Bear Hat. Pending visual confirmation,
  // same as every other Hatchling hat so far.
  'hat-5': hatArt(30, 413, 314, 220, {
    home: {
      Hatchling: { width: '84%', marginTop: '5%', marginLeft: '6%', rotate: '4deg', scaleX: 1.0418 },
      Baby: { width: '76%', marginTop: '20%', marginLeft: '6%', rotate: '4deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved up
  // 4 points — width, horizontal position, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one by
  // copying Baby's own placement verbatim as a starting point (same width/
  // marginLeft/rotate), then moved up 5 points four times per direct
  // visual feedback (marginTop 13% → 8% → 3% → -2% → -7%). Also widened
  // 5% horizontally-only via `scaleX` (1.05). Then sized up another 3%
  // overall (proportional, both axes) twice via base `width` alone
  // (81% → 83.43% → 85.93%) — scaleX (a fixed multiplier on top of base
  // width) scales along with it automatically, so the rendered
  // width/height both grow by exactly 3% together each time;
  // marginTop/marginLeft/rotate unchanged throughout. marginTop then
  // nudged up 2 more points (-7% → -9%) per direct visual feedback, and
  // scaleX nudged up another 2% horizontally-only twice (1.05 → 1.071 →
  // 1.0924) — base width/marginTop/marginLeft/rotate unchanged by either
  // step, so rendered height is unaffected. marginLeft then nudged 2
  // points left (8% → 6%) — width/height/marginTop/rotate unchanged.
  // Sized up another 2% overall (proportional, both axes) twice via base
  // `width` alone (85.93% → 87.65% → 89.4%) — scaleX (1.0924, a fixed
  // multiplier on base width) scales right along with it automatically;
  // marginTop/marginLeft (preserved at the just-nudged 6%)/rotate
  // unchanged through those steps. Then sized back down 3% overall
  // (proportional) via base `width` alone (89.4% → 86.72%) per direct
  // visual feedback — same marginTop/marginLeft/rotate preserved. Then
  // made 5% taller via the new `scaleY` (1.05) — vertical-only, so
  // rendered width (base width × scaleX) is completely unaffected; same
  // mechanism as hat-4/Bear Hat's own scaleY use, just stretching here
  // instead of squashing. rotate unchanged. marginLeft then nudged 1
  // more point left (6% → 5%); marginTop then nudged 1 more point up
  // (-9% → -10%) — both per direct visual feedback. Pending visual
  // confirmation, same as every other Hatchling hat so far.
  'hat-6': hatArt(435, 385, 305, 246, {
    home: {
      Hatchling: {
        width: '86.72%',
        marginTop: '-10%',
        marginLeft: '5%',
        rotate: '4deg',
        scaleX: 1.0924,
        scaleY: 1.05,
      },
      Baby: { width: '81%', marginTop: '13%', marginLeft: '8%', rotate: '4deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved
  // slightly right — width, marginTop, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one by
  // copying Baby's own placement verbatim as a starting point (same width/
  // marginLeft/rotate), then moved up 5 points three times per direct
  // visual feedback (marginTop 16% → 11% → 6% → 1%). Then sized up 10%
  // overall (proportional, both axes — no scaleX/scaleY needed here) via
  // base `width` alone (84% → 92.4%); marginLeft/rotate unchanged.
  // marginTop then nudged up 5 more points (1% → -4%), then 2 more
  // (-4% → -6%), then 3 more (-6% → -9%) — all per direct visual
  // feedback. Then widened 2% horizontally-only via `scaleX` (1.02),
  // leaving base width/marginTop/marginLeft/rotate unchanged, so
  // rendered height is unaffected. Then sized up another 5% overall
  // (proportional, both axes) via base `width` alone (92.4% → 97.02%) —
  // scaleX (1.02, a fixed multiplier on base width) is preserved and
  // scales right along with it automatically, so the horizontal stretch
  // isn't lost; marginTop/rotate unchanged. marginLeft then nudged 1
  // point left (5% → 4%) per direct visual feedback. Sized back down 1%
  // overall (proportional) via base `width` alone (97.02% → 96.05%) —
  // scaleX (1.02) preserved/unchanged, scales right along with it;
  // marginTop/marginLeft/rotate unchanged. Pending visual confirmation,
  // same as every other Hatchling hat so far.
  'hat-7': hatArt(803, 393, 325, 238, {
    home: {
      Hatchling: { width: '96.05%', marginTop: '-9%', marginLeft: '4%', rotate: '2deg', scaleX: 1.02 },
      Baby: { width: '84%', marginTop: '16%', marginLeft: '5%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 4 points — marginTop, marginLeft, and rotation kept the same as that
  // starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one by
  // copying Baby's own placement verbatim as a starting point (same width/
  // marginLeft/rotate), then moved up 15 points per direct visual
  // feedback (marginTop 10% → -5%). Then sized up 10% overall
  // (proportional, both axes — no scaleX/scaleY needed here) via base
  // `width` alone (80% → 88%); marginLeft/rotate unchanged. marginTop
  // then nudged up 5 more points (-5% → -10%) per direct visual
  // feedback. Pending visual confirmation, same as every other
  // Hatchling hat so far.
  'hat-8': hatArt(1196, 375, 301, 254, {
    home: {
      Hatchling: { width: '88%', marginTop: '-10%', marginLeft: '4%', rotate: '2deg' },
      Baby: { width: '80%', marginTop: '10%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved down
  // 8 points — width, horizontal position, and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one from
  // Baby's own placement as a starting point, then per instructions sized
  // up 10% overall (proportional, width 85% → 93.5%, no scaleX/scaleY
  // needed), centered horizontally (no marginLeft, unlike Baby's 4%
  // offset), with marginTop (22%) and rotate (2deg) kept the same as
  // Baby's. marginTop then nudged up per direct visual feedback several
  // times (22% → 17% → 12% → 2% → -1%). Then widened 2% horizontally-
  // only via `scaleX`, twice (1.02 → 1.0404), leaving base width/
  // marginTop/rotate unchanged, so rendered height is unaffected.
  // marginLeft then nudged 1 point right (previously centered, no
  // marginLeft, now '1%') per direct visual feedback. Pending visual
  // confirmation, same as every other Hatchling hat so far.
  'hat-9': hatArt(21, 714, 336, 219, {
    home: {
      Hatchling: { width: '93.5%', marginTop: '-1%', marginLeft: '1%', rotate: '2deg', scaleX: 1.0404 },
      Baby: { width: '85%', marginTop: '22%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved right
  // 4 points — width, marginTop, and rotation kept the same as that
  // starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one by
  // copying Baby's own placement verbatim as a starting point (same width/
  // marginLeft/rotate), then moved up 5 points three times per direct
  // visual feedback (marginTop 13% → 8% → 3% → -2%). Then widened 3%
  // horizontally-only via `scaleX` (1.03), leaving base width/marginTop/
  // marginLeft/rotate unchanged, so rendered height is unaffected.
  // Pending visual confirmation, same as every other Hatchling hat so
  // far.
  'hat-10': hatArt(398, 702, 355, 236, {
    home: {
      Hatchling: { width: '76%', marginTop: '-2%', marginLeft: '8%', rotate: '2deg', scaleX: 1.03 },
      Baby: { width: '76%', marginTop: '13%', marginLeft: '8%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved right
  // 4 points — width, marginTop, and rotation kept the same as that
  // starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one by
  // copying Baby's own placement verbatim as a starting point (same width/
  // marginLeft/rotate), then moved up 15 points per direct visual
  // feedback (marginTop 13% → -2%). Then widened 5% horizontally-only
  // via `scaleX`, four times now (1.05 → 1.1025 → 1.1576 → 1.2155),
  // leaving base width/marginLeft/rotate unchanged, so rendered height
  // is unaffected. marginTop then nudged up 3 more points (-2% → -5%),
  // then down 1 (-5% → -4%) — both per direct visual feedback — scaleX
  // preserved unchanged throughout. Pending visual confirmation, same as
  // every other Hatchling hat so far.
  'hat-11': hatArt(786, 699, 358, 252, {
    home: {
      Hatchling: { width: '76%', marginTop: '-4%', marginLeft: '8%', rotate: '2deg', scaleX: 1.2155 },
      Baby: { width: '76%', marginTop: '13%', marginLeft: '8%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 6 points and moved down 5 points — marginLeft and rotation kept the
  // same as that starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one by
  // copying Baby's own placement verbatim as a starting point (same width/
  // marginLeft/rotate), then moved up 15 points per direct visual
  // feedback (marginTop 11% → -4%). Then sized up 10% overall
  // (proportional, both axes — no scaleX/scaleY needed here) via base
  // `width` alone (85% → 93.5%); marginLeft/rotate unchanged. marginTop
  // then nudged up 5 more points (-4% → -9%) per direct visual feedback.
  // Then sized up another 5% overall (proportional) via base `width`
  // alone (93.5% → 98.18%); marginLeft/rotate unchanged. marginTop then
  // nudged up 5 more points (-9% → -14%) per direct visual feedback.
  // Pending visual confirmation, same as every other Hatchling hat so
  // far.
  'hat2-1': hat2Art(18, 18, 335, 249, {
    home: {
      Hatchling: { width: '98.18%', marginTop: '-14%', marginLeft: '4%', rotate: '2deg' },
      Baby: { width: '85%', marginTop: '11%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then widened by
  // 8 points and moved down 8 points — marginLeft and rotation kept the
  // same as that starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one by
  // copying Baby's own placement verbatim as a starting point (same width/
  // marginLeft/rotate), then moved up 15 points per direct visual
  // feedback (marginTop 11% → -4%). Then sized up 10% overall
  // (proportional, both axes — no scaleX/scaleY needed here) via base
  // `width` alone (96% → 105.6%); marginLeft/rotate unchanged. marginTop
  // then nudged up 5 more points (-4% → -9%) per direct visual feedback —
  // width (105.6%) preserved unchanged. Pending visual confirmation,
  // same as every other Hatchling hat so far.
  'hat2-2': hat2Art(382, 24, 358, 238, {
    home: {
      Hatchling: { width: '105.6%', marginTop: '-9%', marginLeft: '4%', rotate: '2deg' },
      Baby: { width: '96%', marginTop: '11%', marginLeft: '4%', rotate: '2deg' },
    },
  }),
  // Baby placementOverride: started from the dev-only testing fallback
  // (see @/utils/dev-flags.ts) it was being shown with, then moved right
  // 3 points and down 4 points — width and rotation kept the same as
  // that starting point. Not yet fully confirmed.
  //
  // Hatchling placementOverride: no entry existed yet — created one from
  // Baby's own placement as a starting point, then per instructions sized
  // up 10% overall (proportional, base width 96% → 105.6% — scaleX
  // (1.08), a fixed multiplier on base width, is preserved unchanged and
  // scales right along with it automatically), centered horizontally (no
  // marginLeft, unlike Baby's 19% offset), with marginTop (14%) and
  // rotate (2deg) kept the same as Baby's. marginTop then nudged up 15
  // points (14% → -1%) per direct visual feedback — width/scaleX
  // (105.6%/1.08) preserved unchanged. marginLeft then nudged 3 points
  // right (previously centered, no marginLeft, now '3%'), then 3 more
  // three times (3% → 6% → 9% → 12%); marginTop nudged 5 more points up
  // twice (-1% → -6% → -11%) — all per direct visual feedback. Pending
  // visual confirmation, same as every other Hatchling hat so far.
  'hat2-3': hat2Art(775, 35, 353, 224, {
    home: {
      Hatchling: { width: '105.6%', marginTop: '-11%', marginLeft: '12%', rotate: '2deg', scaleX: 1.08 },
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
