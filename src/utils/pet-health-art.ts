import type { ImageSourcePropType } from 'react-native';

import { getArtworkStage, type PetStage } from '@/utils/pet-stage';

// Sick and Critical kitty pictures. Each came from a four-kitty sheet
// (assets/images/pets/Sick/sick_kitty.png and critical_kitty.png, left to
// right = smallest to largest = the pet_hatchling / pet_baby / pet_young /
// pet_adult pictures) and was cropped, exactly like the Dirty kitties, into a
// standalone transparent PNG in assets/images/pets/health/. The sheets are left
// untouched and the crops are not resampled or redrawn.
//
// Keyed by the same ARTWORK stage as the Dirty/normal tables in
// @/components/pet-placeholder.tsx's getStageImage, so the Hatchling/Baby
// artwork swap in pet-stage.ts keeps working: the 'Hatchling' entry is the sick
// version of pet_hatchling.png (the picture shown at the Baby stage), and so on.
// Eggs have no entry because an Egg cannot get sick.
//
// ALIGNMENT: the sick pictures have different poses and sizes from the healthy
// ones, but the hat and bow placements (pet-accessory-placement.ts /
// pet-accessories.ts) were tuned against the healthy pictures and are NOT
// changed. Instead each sick picture is placed and scaled so that its head
// lines up with the healthy picture's head, which makes the existing accessory
// placements land on the head. Everything is measured in pixels:
//   HEALTHY: the healthy picture's size and the point at the top-centre of its
//            head (between the ears);
//   HEALTH_ART: the crop's size and that same head point inside the crop;
//   SCALE:   converts crop pixels to healthy-picture pixels.
// These numbers were estimated from the artwork, so they are the thing to nudge
// if a hat looks off on a sick pet (each state and stage is independent).
export type HealthArtState = 'sick' | 'critical';
type ArtworkStage = Exclude<PetStage, 'Egg'>;

// How far (px) the Sick Baby kitty is moved down, in the Rooms / Bathroom and on
// Home (hats and bows on Home move with it). Nudge to taste.
const SICK_BABY_ROOM_OFFSET_Y_PX = 20;
const SICK_BABY_HOME_OFFSET_Y_PX = 10;
// Extra, Bathroom only (on top of SICK_BABY_ROOM_OFFSET_Y_PX).
const SICK_BABY_BATHROOM_OFFSET_Y_PX = 15;

// The Sick Young kitty sat a little high on Home and in the Bathroom only (the
// other rooms are unchanged).
const SICK_YOUNG_HOME_OFFSET_Y_PX = 100;
const SICK_YOUNG_BATHROOM_OFFSET_Y_PX = 30;

// Transparent margin kept around each cropped kitty.
const CROP_MARGIN = 8;

type HealthPicture = {
  source: ImageSourcePropType;
  width: number;
  height: number;
  domeX: number;
  domeY: number;
};

const HEALTHY: Record<ArtworkStage, { width: number; height: number; domeX: number; domeY: number }> = {
  Hatchling: { width: 429, height: 407, domeX: 213, domeY: 70 },
  Baby: { width: 540, height: 540, domeX: 295, domeY: 235 },
  Young: { width: 827, height: 752, domeX: 320, domeY: 100 },
  Adult: { width: 769, height: 780, domeX: 285, domeY: 95 },
};

// SICK kitties keep their sitting/standing poses and are placed head-to-head
// with the healthy picture. CRITICAL kitties are deliberately lying down, so
// they are instead placed ON THE FLOOR: their paws/belly sit on the same floor
// line as the healthy picture's paws and they are centred under it, with a
// scale chosen so the lying kitty stays inside the pet's box. Their illustrations are
// never altered, only where and how big they are drawn.
const SCALE: Record<HealthArtState, Record<ArtworkStage, number>> = {
  sick: { Hatchling: 1.05, Baby: 1.15, Young: 1.7, Adult: 1.5 },
  critical: { Hatchling: 1.0, Baby: 1.1, Young: 1.4, Adult: 1.3 },
};

// Where the healthy picture's paws rest and where its body is centred (pixels
// in the healthy picture) — the floor line / centre a Critical kitty lies on.
const FLOOR: Record<ArtworkStage, { bottom: number; centerX: number }> = {
  Hatchling: { bottom: 405, centerX: 214 },
  Baby: { bottom: 539, centerX: 290 },
  Young: { bottom: 746, centerX: 413 },
  Adult: { bottom: 775, centerX: 385 },
};

// How big a worn hat/bow should be relative to its healthy-picture size on a
// Critical kitty, whose head is a little smaller than the healthy one at the
// scale above (estimated from the artwork).
const CRITICAL_ACCESSORY_SCALE: Record<ArtworkStage, number> = { Hatchling: 1.0, Baby: 0.92, Young: 0.86, Adult: 0.96 };

const HEALTH_ART: Record<HealthArtState, Record<ArtworkStage, HealthPicture>> = {
  sick: {
    Hatchling: { source: require('@/assets/images/pets/health/sick_hatchling.png'), width: 422, height: 316, domeX: 185, domeY: 85 },
    Baby: { source: require('@/assets/images/pets/health/sick_baby.png'), width: 354, height: 382, domeX: 175, domeY: 86 },
    Young: { source: require('@/assets/images/pets/health/sick_young.png'), width: 485, height: 454, domeX: 202, domeY: 92 },
    Adult: { source: require('@/assets/images/pets/health/sick_adult.png'), width: 475, height: 507, domeX: 181, domeY: 87 },
  },
  critical: {
    Hatchling: { source: require('@/assets/images/pets/health/critical_hatchling.png'), width: 403, height: 294, domeX: 214, domeY: 94 },
    Baby: { source: require('@/assets/images/pets/health/critical_baby.png'), width: 421, height: 350, domeX: 186, domeY: 111 },
    Young: { source: require('@/assets/images/pets/health/critical_young.png'), width: 533, height: 413, domeX: 178, domeY: 124 },
    Adult: { source: require('@/assets/images/pets/health/critical_adult.png'), width: 549, height: 446, domeX: 199, domeY: 115 },
  },
};

export type HealthArt = {
  source: ImageSourcePropType;
  // The picture's own width / height (for a plain contain-fit, e.g. in Rooms).
  aspectRatio: number;
  // Where to draw the picture inside Home's square pet box, as fractions (0-1)
  // of the box, so the head lands where the healthy picture's head is.
  box: { left: number; top: number; width: number; height: number };
  // Where the head's top-centre is in the box (same fractions) for the healthy
  // picture and for this picture, and the size factor for worn accessories.
  // Home uses these to move the (unchanged) accessory placements along with the
  // head: accessories are drawn where they are saved for the healthy head, then
  // shifted by (headTo - headFrom) and scaled about that point.
  headFrom: { x: number; y: number };
  headTo: { x: number; y: number };
  accessoryScale: number;
  // Extra downward shift in pixels for the Rooms / Bathroom, and for Home.
  roomOffsetY: number;
  homeOffsetY: number;
  // Extra downward shift in pixels that applies in the Bathroom only.
  bathroomOffsetY: number;
};

// The Sick / Critical picture for a stage, or null (use the normal picture)
// when the pet is healthy, an Egg, passed away, or has no such picture.
export function getHealthArt(
  stage: PetStage,
  healthState: 'healthy' | 'sick' | 'critical' | 'deceased' | undefined
): HealthArt | null {
  if (healthState !== 'sick' && healthState !== 'critical') return null;
  const artworkStage = getArtworkStage(stage);
  if (artworkStage === 'Egg') return null;
  const pic = HEALTH_ART[healthState][artworkStage];
  const healthy = HEALTHY[artworkStage];
  const scale = SCALE[healthState][artworkStage];
  // The normal picture is contain-fitted and centred in the square box, so one
  // healthy-picture pixel is this fraction of the box.
  const fit = 1 / Math.max(healthy.width, healthy.height);
  const originX = (1 - healthy.width * fit) / 2;
  const originY = (1 - healthy.height * fit) / 2;
  // Picture's top-left corner in healthy-picture pixels.
  let leftPx: number;
  let topPx: number;
  if (healthState === 'critical') {
    const floor = FLOOR[artworkStage];
    leftPx = floor.centerX - (pic.width * scale) / 2;
    // The crop has an 8px transparent margin below the paws.
    topPx = floor.bottom - (pic.height - CROP_MARGIN) * scale;
  } else {
    leftPx = healthy.domeX - pic.domeX * scale;
    topPx = healthy.domeY - pic.domeY * scale;
  }
  return {
    source: pic.source,
    aspectRatio: pic.width / pic.height,
    box: {
      left: originX + leftPx * fit,
      top: originY + topPx * fit,
      width: pic.width * scale * fit,
      height: pic.height * scale * fit,
    },
    headFrom: { x: originX + healthy.domeX * fit, y: originY + healthy.domeY * fit },
    headTo: { x: originX + (leftPx + pic.domeX * scale) * fit, y: originY + (topPx + pic.domeY * scale) * fit },
    accessoryScale: healthState === 'critical' ? CRITICAL_ACCESSORY_SCALE[artworkStage] : 1,
    // The Sick picture shown at the Baby stage (artwork key 'Hatchling', because
    // of the Hatchling/Baby artwork swap) sits a little high in the Rooms.
    roomOffsetY: healthState === 'sick' && artworkStage === 'Hatchling' ? SICK_BABY_ROOM_OFFSET_Y_PX : 0,
    homeOffsetY:
      healthState === 'sick' && artworkStage === 'Hatchling'
        ? SICK_BABY_HOME_OFFSET_Y_PX
        : healthState === 'sick' && artworkStage === 'Young'
          ? SICK_YOUNG_HOME_OFFSET_Y_PX
          : 0,
    bathroomOffsetY:
      healthState === 'sick' && artworkStage === 'Young'
        ? SICK_YOUNG_BATHROOM_OFFSET_Y_PX
        : healthState === 'sick' && artworkStage === 'Hatchling'
          ? SICK_BABY_BATHROOM_OFFSET_Y_PX
          : 0,
  };
}

// The extra transform that moves (and slightly resizes) the worn hat/bow layer
// along with a Sick / Critical kitty's head, leaving the saved placements
// untouched. `youngScale` is the factor the Young body is drawn at around the
// box centre (accessories themselves are not scaled), so the head positions are
// mapped through it first. `offsetY` is any extra px shift the picture got.
export function getHealthAccessoryTransform(
  art: HealthArt,
  youngScale: number,
  boxWidth: number,
  boxHeight: number,
  offsetY = 0
): ({ translateX: number } | { translateY: number } | { scale: number })[] {
  if (boxWidth <= 0 || boxHeight <= 0) return [];
  const c = 0.5;
  const from = { x: c + youngScale * (art.headFrom.x - c), y: c + youngScale * (art.headFrom.y - c) };
  const to = { x: c + youngScale * (art.headTo.x - c), y: c + youngScale * (art.headTo.y - c) };
  const k = art.accessoryScale;
  return [
    { translateX: (to.x - from.x + (1 - k) * (from.x - c)) * boxWidth },
    { translateY: (to.y - from.y + (1 - k) * (from.y - c)) * boxHeight + offsetY },
    { scale: k },
  ];
}
