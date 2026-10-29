import { TOY_PRICING } from './toy-config';

// The Cat Toys catalog: all 24 designs on kitty_toys.png (see cat-toy-art.ts), in sheet order (left to
// right, top to bottom). Name, art slot and numbers are three separate things: `artSlot` ->
// cat-toy-art.ts, price/happiness -> toy-config.ts. Beds, the tunnel and the cube house are plain
// temporary toys for now (permanent furniture may come later).
export type ToyDef = {
  id: string;
  name: string;
  species: string;
  // Key into the species' art (see cat-toy-art.ts).
  artSlot: string;
  price: number;
  happiness: number;
};

function cat(id: string, name: string, artSlot: string): ToyDef {
  const p = TOY_PRICING[id];
  return { id, name, species: 'cat', artSlot, price: p.price, happiness: p.happiness };
}

export const CAT_TOYS: ToyDef[] = [
  cat('cat-toy-mouse', 'Plush Mouse', 'r1c1'),
  cat('cat-toy-fish', 'Blue Fish Plush', 'r1c2'),
  cat('cat-toy-yarn', 'Pink Yarn Ball', 'r1c3'),
  cat('cat-toy-feather-wand', 'Feather Wand', 'r1c4'),
  cat('cat-toy-crinkle-ball', 'Crinkle Ball', 'r1c5'),
  cat('cat-toy-chick', 'Chick Plush', 'r1c6'),
  cat('cat-toy-paw-tunnel', 'Paw Tunnel', 'r2c1'),
  cat('cat-toy-catnip-candy', 'Catnip Candy', 'r2c2'),
  cat('cat-toy-ball-tower', 'Ball Tower', 'r2c3'),
  cat('cat-toy-spring-paw', 'Spring Paw Toy', 'r2c4'),
  cat('cat-toy-jingle-ball', 'Jingle Bell Ball', 'r2c5'),
  cat('cat-toy-mint-pom', 'Mint Pom-Pom', 'r2c6'),
  cat('cat-toy-heart-pillow', 'Heart Pillow', 'r3c1'),
  cat('cat-toy-pastel-pom', 'Pastel Pom-Pom', 'r3c2'),
  cat('cat-toy-goldfish', 'Goldfish Plush', 'r3c3'),
  cat('cat-toy-cat-bed', 'Cat Bed', 'r3c4'),
  cat('cat-toy-star-stand', 'Dangling Star Stand', 'r3c5'),
  cat('cat-toy-cube-house', 'Cat Cube House', 'r3c6'),
  cat('cat-toy-shrimp', 'Shrimp Plush', 'r4c1'),
  cat('cat-toy-fishbone', 'Fishbone Plush', 'r4c2'),
  cat('cat-toy-butterfly', 'Butterfly Toy', 'r4c3'),
  cat('cat-toy-daisy', 'Daisy Toy', 'r4c4'),
  cat('cat-toy-rainbow', 'Rainbow Toy', 'r4c5'),
  cat('cat-toy-strawberry-milk', 'Strawberry Milk Toy', 'r4c6'),
];
