// Tunable numbers for toys, in ONE place (like pet-family-config.ts) so none is hard-coded in a
// screen. Prices are Paw Tokens; `happiness` is the Happiness points one use restores (capped at 100).
//
// PROVISIONAL: these numbers are starting values to be rebalanced later. Rough tiers: small 10 / +10,
// medium 20 / +20, larger or more elaborate 30 / +30 (the first three toys keep their original starter
// values of 10, 15 and 20).
export const TOY_SESSION_MS = 60_000; // how long a toy stays in the living room (60 s)

export type ToyPricing = { price: number; happiness: number };

export const TOY_PRICING: Record<string, ToyPricing> = {
  'cat-toy-mouse': { price: 10, happiness: 10 },
  'cat-toy-fish': { price: 15, happiness: 15 },
  'cat-toy-yarn': { price: 20, happiness: 20 },
  'cat-toy-feather-wand': { price: 20, happiness: 20 },
  'cat-toy-crinkle-ball': { price: 10, happiness: 10 },
  'cat-toy-chick': { price: 20, happiness: 20 },
  'cat-toy-paw-tunnel': { price: 30, happiness: 30 },
  'cat-toy-catnip-candy': { price: 10, happiness: 10 },
  'cat-toy-ball-tower': { price: 30, happiness: 30 },
  'cat-toy-spring-paw': { price: 20, happiness: 20 },
  'cat-toy-jingle-ball': { price: 10, happiness: 10 },
  'cat-toy-mint-pom': { price: 10, happiness: 10 },
  'cat-toy-heart-pillow': { price: 20, happiness: 20 },
  'cat-toy-pastel-pom': { price: 10, happiness: 10 },
  'cat-toy-goldfish': { price: 20, happiness: 20 },
  'cat-toy-cat-bed': { price: 30, happiness: 30 },
  'cat-toy-star-stand': { price: 30, happiness: 30 },
  'cat-toy-cube-house': { price: 30, happiness: 30 },
  'cat-toy-shrimp': { price: 10, happiness: 10 },
  'cat-toy-fishbone': { price: 10, happiness: 10 },
  'cat-toy-butterfly': { price: 20, happiness: 20 },
  'cat-toy-daisy': { price: 10, happiness: 10 },
  'cat-toy-rainbow': { price: 20, happiness: 20 },
  'cat-toy-strawberry-milk': { price: 20, happiness: 20 },
};
