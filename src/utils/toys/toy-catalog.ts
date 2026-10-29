import { getCatToyArt, type ToyArt } from './cat-toy-art';
import { CAT_TOYS, type ToyDef } from './cat-toys';

export type { ToyArt, ToyDef };

// Toys are grouped by pet species. To add Dog Toys, Frog Toys or Fancy Rat Toys later: create that
// species' art + catalog files the same way as cat-toy-art.ts / cat-toys.ts and add ONE entry here.
// The Shop and the Home living room read only this registry — neither is rewritten per species.
export type ToySpecies = {
  id: string;
  label: string;
  toys: ToyDef[];
  getArt: (artSlot: string) => ToyArt | null;
};

export const TOY_SPECIES: ToySpecies[] = [
  { id: 'cat', label: 'Cat Toys', toys: CAT_TOYS, getArt: getCatToyArt },
];

export function getToy(toyId: string): ToyDef | undefined {
  for (const s of TOY_SPECIES) {
    const t = s.toys.find((x) => x.id === toyId);
    if (t) return t;
  }
  return undefined;
}

export function getToyArtFor(toy: ToyDef): ToyArt | null {
  return TOY_SPECIES.find((s) => s.id === toy.species)?.getArt(toy.artSlot) ?? null;
}
