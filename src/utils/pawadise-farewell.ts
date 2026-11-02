// The Pet Pawadise farewell: what is said and which species have a farewell scene.

// The seven affectionate messages live in the translation lists (`farewell` in lists.en.ts / lists.es.ts); each
// farewell shows three DIFFERENT ones, in random order. They are picked as INDEXES, so they follow a language change.
export const FAREWELL_POOL_SIZE = 7;

export const FAREWELL_MESSAGE_COUNT = 3;

// Picks `count` distinct message indexes (a shuffle, so none repeats within one farewell).
export function pickFarewellMessages(count: number = FAREWELL_MESSAGE_COUNT, rng: () => number = Math.random): number[] {
  const pool = Array.from({ length: FAREWELL_POOL_SIZE }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

// Farewell scenes are per species (a species without an entry gets no farewell, so the cat artwork is never
// used for other pets). The farewell is built from SEPARATE layers so each can be moved or resized on its own:
//   background - the Pawadise entrance picture (full screen);
//   character  - a transparent kitty drawn in front of it (see FAREWELL_CHARACTER_LAYOUT);
//   leaves     - a complete departure scene it fades to (nothing is drawn over it).
export type FarewellScenes = {
  background: number;
  backgroundAspectRatio: number;
  character: number;
  characterAspectRatio: number;
  // The kitty's VISIBLE bounds inside her picture, as fractions of its width / height (the PNG has a little
  // transparent margin), used to centre and place things by what can actually be seen.
  characterVisible: { left: number; right: number; top: number; bottom: number };
  leaves: number;
  leavesAspectRatio: number;
};

export const FAREWELL_SCENES_BY_SPECIES: Record<string, FarewellScenes> = {
  cat: {
    background: require('../../assets/images/rooms/backgrounds/pawadise/Pawadise_enterance.png') as number,
    backgroundAspectRatio: 1672 / 941,
    character: require('../../assets/images/rooms/backgrounds/pawadise/farewells/Kitty_farewell.png') as number,
    characterAspectRatio: 1295 / 1214,
    // Measured from the file: visible pixels span x 19-1268 and y 18-1189 of 1295 x 1214.
    characterVisible: { left: 19 / 1295, right: 1269 / 1295, top: 18 / 1214, bottom: 1190 / 1214 },
    leaves: require('../../assets/images/rooms/backgrounds/pawadise/farewells/Kitty_leaves.png') as number,
    leavesAspectRatio: 1536 / 1024,
  },
};

// Where the character sits on the screen. Tweak these numbers to move or resize her without touching the
// background. Fractions are of the screen's width / height; `centerX` is where the middle of the VISIBLE
// kitty goes (0.5 = centre of the screen), she is anchored `bottom` up from the bottom, and she is always
// shown whole (never cropped), at her real proportions.
export const FAREWELL_CHARACTER_LAYOUT = {
  // Tall (portrait) screens
  tall: { maxWidthFraction: 0.84, maxHeightFraction: 0.5, centerX: 0.5, bottom: 0.03 },
  // Wide (landscape / desktop) screens
  wide: { maxWidthFraction: 0.4, maxHeightFraction: 0.74, centerX: 0.45, bottom: 0.03 },
};

// Timing of the departure: how long the crossfade to "Kitty leaves" takes, and how long that scene is then
// shown (3.8 s, so about five seconds in all with the fade) before the farewell ends by itself.
// Which part of the "Kitty leaves" picture is shown when the screen is too narrow to show all of it (the
// picture always fills the screen, so some of its width is cropped; this picks which part). 0% = the picture's
// left edge, 100% = its right edge. Portrait uses its own value, so moving the kitty on tall screens never
// changes wide screens: a LARGER portrait number shows more of the picture's right side, so the kitty (who is
// left of centre in the picture) appears farther LEFT on screen.
export const FAREWELL_DEPARTURE_FOCUS_X = { portrait: '46%', wide: '20%' } as const;

export const FAREWELL_FADE_MS = 1400;
export const FAREWELL_DEPARTURE_HOLD_MS = 3800;

export function getFarewellScenes(species: string): FarewellScenes | null {
  return FAREWELL_SCENES_BY_SPECIES[species] ?? null;
}
