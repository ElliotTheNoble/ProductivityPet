import type { RoomPetStage } from '@/utils/room-pet-art';

// Simple explanation: this file just prepares the artwork for the future
// multi-step bathing sequence (Soap → Rinse → Dry) — it maps each step's
// sheet + growth stage to the exact rectangle of that sheet to show, using
// the project's existing SpriteCrop component (@/components/sprite-crop.tsx)
// to reveal it. Nothing in this file is wired into the Bathroom's actual
// rendering/interaction yet — @/components/room-detail-screen.tsx's "Wash
// Kitty" button still uses the separate, already-cropped clean_kitty.png
// art from @/utils/room-pet-art.ts's getWashingKittyArt, completely
// untouched by this file. A later step will build the real Rinse/Dry
// interaction and call getBathingStepArt below to display it.
//
// Why SpriteCrop (crop at DISPLAY time from the original sheet) instead of
// pre-cropping each pose into its own standalone file (the technique used
// for clean_kitty.png → washing_*.png): all 14 sheets in
// assets/images/pets/bathing/ needed to stay byte-for-byte unmodified (per
// instructions — a lot of design time went into them), and one of them —
// dry_5.png — has only a 3px gap between its 2nd and 3rd poses, far too
// tight to safely cut into a new standalone file with any real margin.
// SpriteCrop never cuts anything; it loads the original sheet at full size
// and uses a plain `overflow: 'hidden'` window (sized/positioned from the
// cropX/cropY/cropWidth/cropHeight numbers below) to reveal only one
// rectangle of it, so even a razor-thin boundary is completely safe — it's
// just numbers, not a destructive pixel cut, and can be nudged later with
// zero risk if a boundary ever needs adjusting.
//
// How every crop rectangle below was measured: same alpha-channel
// bounding-box methodology used throughout this project — for each sheet,
// a column-by-column opacity scan found the 4 separated poses (confirmed
// left to right: Hatchling, Baby, Young, Adult, per instructions), then a
// row scan within each pose's own column range found its real top/bottom
// extent. A small margin (up to 5px) was added on each side, but ALWAYS
// clamped to at most half the real transparent gap to that pose's nearest
// neighbor (and to the sheet's own edge) — so no margin can ever reach
// into a neighboring pose or off the sheet, regardless of how tight that
// particular gap is. This is what made dry_5.png's 3px Baby/Young gap safe
// to handle the exact same way as every other, far more generous gap: its
// margin there was automatically clamped down to just 1px on each side
// (1 + 1 = 2, strictly less than the 3px available), leaving the two
// poses with a real 1px gap between their crop rectangles — never
// touching, never overlapping, never clipping either pose's own artwork.
// Every number below was independently verified against the sheet's own
// measured pixel dimensions before being written here — never guessed.
//
// Canvas sizes are NOT identical across all 14 files (most are 2172x724,
// matching every other sprite sheet in this project, but rinse_3.png is
// 2171x724 and soap_4.png is 2170x725) — sheetWidth/sheetHeight below are
// each file's own real measured size, not a shared assumption, since
// SpriteCrop's scale math depends on knowing the sheet's true dimensions.
//
// soap_4.png intentionally shows Kitty fully hidden under a pile of
// bubbles for all 4 stages (no visible cat at all) — this is correct,
// expected art per instructions, not a missing/broken asset.
//
// One filename note: the 5th rinse sheet is saved on disk as
// "rince_5.png" (a typo — not renamed here, since instructions were to
// leave the original 14 files completely unchanged) — the require() call
// below simply references it by its real, current filename.
//
// Update: the Hatchling pose (only) in rinse_2–4.png, rince_5.png, and
// dry_2–4.png was replaced on-disk with new matching art from two new
// source sheets (hatchling_rinse.png — 4 poses, hatchling_dry.png — 3
// poses), each scaled to fit within (never exceed) the original
// Hatchling's own footprint on that sheet and floor-anchored at its same
// bottom edge — so Baby/Young/Adult, every other sheet's spacing, and the
// overall layout are completely unaffected; verified with a full pixel
// diff against backups (kept in assets/images/pets/bathing/backups/)
// showing zero changes outside the old Hatchling region. rinse_1.png,
// dry_1.png, and dry_5.png were left exactly as they were — only their
// Hatchling entries below are untouched from the original measurements.
// The 7 changed sheets' Hatchling crop boxes below were re-measured
// against the new, saved artwork (same alpha-bounding-box + clamped-
// margin methodology as every other entry here) — Baby/Young/Adult crop
// boxes for those same 7 sheets did NOT change, since those pixels never
// moved.

// A single crop rectangle within a sheet, in that sheet's own pixel
// coordinates — the exact shape SpriteCrop's own props expect, so a sheet
// entry's own values can be spread straight into <SpriteCrop {...} />.
type StageCropBox = {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
};

type BathingSheet = {
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  stages: Record<RoomPetStage, StageCropBox>;
};

// --- Soap (soap_1.png – soap_4.png) ---------------------------------------
const SOAP_SOURCES = [
  require('@/assets/images/pets/bathing/soap_1.png'),
  require('@/assets/images/pets/bathing/soap_2.png'),
  require('@/assets/images/pets/bathing/soap_3.png'),
  require('@/assets/images/pets/bathing/soap_4.png'),
];

const SOAP_SHEETS: BathingSheet[] = [
  {
    source: SOAP_SOURCES[0],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      Hatchling: { cropX: 18, cropY: 201, cropWidth: 393, cropHeight: 404 },
      Baby: { cropX: 520, cropY: 275, cropWidth: 511, cropHeight: 341 },
      Young: { cropX: 1140, cropY: 165, cropWidth: 454, cropHeight: 446 },
      Adult: { cropX: 1716, cropY: 166, cropWidth: 443, cropHeight: 460 },
    },
  },
  {
    source: SOAP_SOURCES[1],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      Hatchling: { cropX: 7, cropY: 140, cropWidth: 430, cropHeight: 521 },
      Baby: { cropX: 523, cropY: 243, cropWidth: 531, cropHeight: 421 },
      Young: { cropX: 1116, cropY: 155, cropWidth: 510, cropHeight: 503 },
      Adult: { cropX: 1698, cropY: 128, cropWidth: 465, cropHeight: 532 },
    },
  },
  {
    source: SOAP_SOURCES[2],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      Hatchling: { cropX: 14, cropY: 156, cropWidth: 444, cropHeight: 496 },
      Baby: { cropX: 529, cropY: 256, cropWidth: 546, cropHeight: 399 },
      Young: { cropX: 1120, cropY: 134, cropWidth: 489, cropHeight: 526 },
      Adult: { cropX: 1678, cropY: 113, cropWidth: 485, cropHeight: 549 },
    },
  },
  {
    // soap_4.png is intentionally bubbles-only for every stage (Kitty
    // fully covered) — see the module comment above.
    source: SOAP_SOURCES[3],
    sheetWidth: 2170,
    sheetHeight: 725,
    stages: {
      Hatchling: { cropX: 3, cropY: 152, cropWidth: 469, cropHeight: 511 },
      Baby: { cropX: 520, cropY: 269, cropWidth: 560, cropHeight: 392 },
      Young: { cropX: 1120, cropY: 127, cropWidth: 500, cropHeight: 546 },
      Adult: { cropX: 1652, cropY: 110, cropWidth: 517, cropHeight: 554 },
    },
  },
];

// --- Rinse (rinse_1.png – rinse_4.png, rince_5.png) -----------------------
const RINSE_SOURCES = [
  require('@/assets/images/pets/bathing/rinse_1.png'),
  require('@/assets/images/pets/bathing/rinse_2.png'),
  require('@/assets/images/pets/bathing/rinse_3.png'),
  require('@/assets/images/pets/bathing/rinse_4.png'),
  // Real on-disk filename — see the module comment above about the typo.
  require('@/assets/images/pets/bathing/rince_5.png'),
];

const RINSE_SHEETS: BathingSheet[] = [
  {
    source: RINSE_SOURCES[0],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      Hatchling: { cropX: 6, cropY: 188, cropWidth: 468, cropHeight: 477 },
      Baby: { cropX: 513, cropY: 243, cropWidth: 569, cropHeight: 418 },
      Young: { cropX: 1102, cropY: 126, cropWidth: 525, cropHeight: 529 },
      Adult: { cropX: 1673, cropY: 103, cropWidth: 490, cropHeight: 560 },
    },
  },
  {
    source: RINSE_SOURCES[1],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      // Re-measured after the Hatchling pose swap (see the module comment
      // above) — Baby/Young/Adult below are unchanged from the original.
      Hatchling: { cropX: 51, cropY: 300, cropWidth: 336, cropHeight: 369 },
      Baby: { cropX: 498, cropY: 304, cropWidth: 552, cropHeight: 367 },
      Young: { cropX: 1122, cropY: 205, cropWidth: 510, cropHeight: 474 },
      Adult: { cropX: 1695, cropY: 77, cropWidth: 471, cropHeight: 597 },
    },
  },
  {
    source: RINSE_SOURCES[2],
    sheetWidth: 2171,
    sheetHeight: 724,
    stages: {
      // Re-measured after the Hatchling pose swap (see the module comment
      // above) — Baby/Young/Adult below are unchanged from the original.
      Hatchling: { cropX: 51, cropY: 292, cropWidth: 329, cropHeight: 333 },
      Baby: { cropX: 606, cropY: 324, cropWidth: 462, cropHeight: 309 },
      Young: { cropX: 1158, cropY: 201, cropWidth: 470, cropHeight: 436 },
      Adult: { cropX: 1753, cropY: 133, cropWidth: 388, cropHeight: 508 },
    },
  },
  {
    source: RINSE_SOURCES[3],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      // Re-measured after the Hatchling pose swap (see the module comment
      // above) — Baby/Young/Adult below are unchanged from the original.
      Hatchling: { cropX: 34, cropY: 279, cropWidth: 366, cropHeight: 360 },
      Baby: { cropX: 592, cropY: 313, cropWidth: 483, cropHeight: 329 },
      Young: { cropX: 1152, cropY: 213, cropWidth: 488, cropHeight: 432 },
      Adult: { cropX: 1784, cropY: 159, cropWidth: 372, cropHeight: 488 },
    },
  },
  {
    source: RINSE_SOURCES[4],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      // Re-measured after the Hatchling pose swap (see the module comment
      // above) — Baby/Young/Adult below are unchanged from the original.
      Hatchling: { cropX: 77, cropY: 307, cropWidth: 333, cropHeight: 347 },
      Baby: { cropX: 557, cropY: 300, cropWidth: 530, cropHeight: 349 },
      Young: { cropX: 1115, cropY: 165, cropWidth: 549, cropHeight: 491 },
      Adult: { cropX: 1742, cropY: 74, cropWidth: 421, cropHeight: 588 },
    },
  },
];

// --- Dry (dry_1.png – dry_5.png) ------------------------------------------
const DRY_SOURCES = [
  require('@/assets/images/pets/bathing/dry_1.png'),
  require('@/assets/images/pets/bathing/dry_2.png'),
  require('@/assets/images/pets/bathing/dry_3.png'),
  require('@/assets/images/pets/bathing/dry_4.png'),
  require('@/assets/images/pets/bathing/dry_5.png'),
];

const DRY_SHEETS: BathingSheet[] = [
  {
    source: DRY_SOURCES[0],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      // Re-measured after dry_1.png's own Hatchling pose was replaced with
      // the first (far-left) pose from the new assets/images/pets/bathing/
      // dry_1_1.png — same swap methodology as the module comment above
      // describes for the other Dry sheets (scaled to fit within, never
      // exceed, the old pose's own footprint, floor-anchored at the same
      // bottom edge). Baby/Young/Adult below are unchanged from the
      // original. dry_1_1.png itself was only read, never modified.
      Hatchling: { cropX: 79, cropY: 321, cropWidth: 301, cropHeight: 321 },
      Baby: { cropX: 562, cropY: 346, cropWidth: 533, cropHeight: 296 },
      Young: { cropX: 1145, cropY: 201, cropWidth: 521, cropHeight: 446 },
      Adult: { cropX: 1762, cropY: 153, cropWidth: 389, cropHeight: 498 },
    },
  },
  {
    source: DRY_SOURCES[1],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      // Re-measured again after hatchling_dry.png was replaced with a
      // newer version and the Hatchling pose redone from that (see the
      // module comment above) — Baby/Young/Adult below are unchanged from
      // the original. The new pose is a bit shorter than the old one (its
      // own aspect ratio, scaled to fit within the old pose's footprint
      // without exceeding it), so cropY/cropHeight are smaller than the
      // original measurement — it's still floor-anchored at the same
      // bottom edge as before.
      Hatchling: { cropX: 48, cropY: 331, cropWidth: 354, cropHeight: 288 },
      Baby: { cropX: 584, cropY: 339, cropWidth: 498, cropHeight: 284 },
      Young: { cropX: 1137, cropY: 184, cropWidth: 493, cropHeight: 448 },
      Adult: { cropX: 1750, cropY: 139, cropWidth: 410, cropHeight: 486 },
    },
  },
  {
    source: DRY_SOURCES[2],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      // Re-measured again after hatchling_dry.png was replaced (see the
      // module comment above and dry_2.png's note just above) — Baby/
      // Young/Adult below are unchanged from the original.
      Hatchling: { cropX: 31, cropY: 329, cropWidth: 360, cropHeight: 284 },
      Baby: { cropX: 565, cropY: 315, cropWidth: 513, cropHeight: 306 },
      Young: { cropX: 1119, cropY: 176, cropWidth: 536, cropHeight: 458 },
      Adult: { cropX: 1735, cropY: 122, cropWidth: 429, cropHeight: 498 },
    },
  },
  {
    source: DRY_SOURCES[3],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      // Re-measured again after hatchling_dry.png was replaced (see the
      // module comment above) — Baby/Young/Adult below are unchanged from
      // the original.
      Hatchling: { cropX: 58, cropY: 293, cropWidth: 382, cropHeight: 336 },
      Baby: { cropX: 589, cropY: 312, cropWidth: 499, cropHeight: 323 },
      Young: { cropX: 1149, cropY: 205, cropWidth: 512, cropHeight: 452 },
      Adult: { cropX: 1736, cropY: 166, cropWidth: 430, cropHeight: 491 },
    },
  },
  {
    // dry_5.png — the Baby/Young boundary here comes from only a 3px real
    // gap (margins clamped to 1px each side, see the module comment
    // above) — every other boundary on this sheet had a normal gap.
    source: DRY_SOURCES[4],
    sheetWidth: 2172,
    sheetHeight: 724,
    stages: {
      Hatchling: { cropX: 35, cropY: 178, cropWidth: 424, cropHeight: 466 },
      Baby: { cropX: 503, cropY: 309, cropWidth: 571, cropHeight: 335 },
      Young: { cropX: 1075, cropY: 151, cropWidth: 561, cropHeight: 496 },
      Adult: { cropX: 1649, cropY: 88, cropWidth: 503, cropHeight: 563 },
    },
  },
];

export type BathingStep = 'soap' | 'rinse' | 'dry';

// Simple explanation: give it a step ("soap"/"rinse"/"dry"), which numbered
// picture of that step (1-4 for soap, 1-5 for rinse/dry — matching the
// real filenames, e.g. step="soap", stepNumber=1 means soap_1.png), and
// Kitty's current growth stage, and it hands back exactly what
// <SpriteCrop {...art} width={...} height={...} /> needs to display that
// one pose — same spread-the-return-value pattern already used for
// getRoomPetArt in this same directory. stepNumber is 1-indexed (not
// 0-indexed) to match how these files are actually named and how a future
// caller will naturally think about "step 3 of 5", not an internal array
// index.
export function getBathingStepArt(step: BathingStep, stepNumber: number, stage: RoomPetStage) {
  const sheets = step === 'soap' ? SOAP_SHEETS : step === 'rinse' ? RINSE_SHEETS : DRY_SHEETS;
  const sheet = sheets[stepNumber - 1];
  const { source, sheetWidth, sheetHeight, stages } = sheet;
  return { source, sheetWidth, sheetHeight, ...stages[stage] };
}

// How many numbered pictures exist for each step — exported so a future
// caller can validate/iterate stepNumber without hardcoding 4/5 a second
// time (e.g. "is this the last Rinse step?").
export const BATHING_STEP_COUNTS: Record<BathingStep, number> = {
  soap: SOAP_SHEETS.length,
  rinse: RINSE_SHEETS.length,
  dry: DRY_SHEETS.length,
};
