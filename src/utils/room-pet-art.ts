import type { PetStage } from '@/utils/pet-stage';
import type { RoomSlug } from '@/utils/rooms';

// The 4 Rooms that have their own room-specific pet ACTIVITY ART — a
// dedicated sprite sheet with one illustration per growth stage. Living
// Room is deliberately not part of RoomSlug at all (it keeps using the
// existing Home pet art/system in @/components/pet-placeholder.tsx).
// Bathroom IS a RoomSlug but deliberately excluded here too — it uses the
// same shared "normal" pet art every stage of it already had (no activity
// sprite sheet of its own yet, since bath mechanics aren't implemented —
// see @/components/room-pet.tsx, which is what actually branches on this
// distinction when deciding how to render a given room).
export type RoomPetSlug = Exclude<RoomSlug, 'bathroom'>;

export function isRoomPetSlug(slug: string): slug is RoomPetSlug {
  return slug === 'study-room' || slug === 'gym' || slug === 'bedroom' || slug === 'kitchen';
}

// The four growth stages actually drawn in each room's sheet, left to
// right. Egg isn't part of any of them — @/components/room-pet.tsx falls
// back to the same shared egg_nest.png used everywhere else for that
// stage instead, per "keep Egg artwork unchanged." Exported so
// room-pet.tsx can narrow `stage` to this type after it's already ruled
// out 'Egg'.
export type RoomPetStage = Exclude<PetStage, 'Egg'>;

type RoomPetArt = {
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
};

// All four sheets share this same canvas size.
const ROOM_PET_SHEET_WIDTH = 2172;
const ROOM_PET_SHEET_HEIGHT = 724;

const STUDY_SOURCE = require('@/assets/images/pets/kitty_study.png');
const GYM_SOURCE = require('@/assets/images/pets/gym_kitty.png');
const BEDROOM_SOURCE = require('@/assets/images/pets/sleepy_kitty.png');
const KITCHEN_SOURCE = require('@/assets/images/pets/cleaning_kitty.png');

function art(source: number, cropX: number, cropY: number, cropWidth: number, cropHeight: number): RoomPetArt {
  return { source, sheetWidth: ROOM_PET_SHEET_WIDTH, sheetHeight: ROOM_PET_SHEET_HEIGHT, cropX, cropY, cropWidth, cropHeight };
}

// Every crop below was measured via an alpha-channel bounding-box scan of
// each sheet's own 4 characters (Hatchling/Baby/Young/Adult, left to
// right, each column cleanly separated by a fully-transparent gap), with a
// 5px safety margin added on every side that had room, then visually
// verified by drawing these exact boxes over the real sheet and inspecting
// the result before trusting them — never guessed.
//
// One known source-art limitation found during that visual check: the
// Adult character's coffee-mug prop in kitty_study.png is cut off by the
// sheet's own right edge — real content (alpha > 0) runs right up to the
// last pixel column of the sheet there. That's a limitation of the source
// art itself (confirmed by viewing it directly), not something this crop
// introduced or can recover — flagged here and in the implementation
// writeup for a possible future re-export of that one sheet.
export const ROOM_PET_ART: Record<RoomPetSlug, Record<RoomPetStage, RoomPetArt>> = {
  'study-room': {
    Hatchling: art(STUDY_SOURCE, 12, 288, 461, 345),
    Baby: art(STUDY_SOURCE, 562, 219, 475, 431),
    Young: art(STUDY_SOURCE, 1108, 119, 502, 543),
    Adult: art(STUDY_SOURCE, 1665, 127, 507, 536),
  },
  gym: {
    // Hatchling/Baby unchanged — re-verified against the updated sheet
    // below and these two still fully contain their characters with
    // margin to spare, so they weren't touched (matches what you
    // reported: those two already looked correct).
    Hatchling: art(GYM_SOURCE, 16, 287, 514, 360),
    Baby: art(GYM_SOURCE, 544, 173, 497, 473),
    // Re-measured against the UPDATED gym_kitty.png (same 2172x724 canvas
    // size, but Young/Adult were redrawn further right, with more gap
    // between all four characters, than the original sheet these crops
    // were first measured from) — see the module comment above for the
    // general methodology. Young's content now runs from x~1102-1616 (was
    // ~1064-1571), Adult's from x~1680-2154 (was ~1595-2160).
    Young: art(GYM_SOURCE, 1096, 126, 526, 506),
    Adult: art(GYM_SOURCE, 1674, 122, 486, 509),
  },
  bedroom: {
    Hatchling: art(BEDROOM_SOURCE, 10, 217, 463, 393),
    Baby: art(BEDROOM_SOURCE, 571, 235, 484, 378),
    Young: art(BEDROOM_SOURCE, 1122, 210, 491, 408),
    Adult: art(BEDROOM_SOURCE, 1662, 115, 503, 500),
  },
  kitchen: {
    Hatchling: art(KITCHEN_SOURCE, 24, 277, 459, 336),
    Baby: art(KITCHEN_SOURCE, 628, 174, 403, 454),
    Young: art(KITCHEN_SOURCE, 1121, 195, 460, 407),
    Adult: art(KITCHEN_SOURCE, 1712, 144, 437, 463),
  },
};

export function getRoomPetArt(slug: RoomPetSlug, stage: RoomPetStage): RoomPetArt {
  return ROOM_PET_ART[slug][stage];
}
