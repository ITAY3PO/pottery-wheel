/** Glaze ids live in the surface map's glazeId channel. 0 is bare clay. */

export type GlazeKind = 'gloss' | 'matte' | 'celadon' | 'tenmoku' | 'shino' | 'ash' | 'copper';

export interface GlazeRecipe {
  id: number;
  name: string;
  kind: GlazeKind;
  /** Chalky pastel, the coat before the kiln. Hex sRGB. */
  raw: string;
  /** Color after the glaze fire. Hex sRGB. */
  fired: string;
  /** Where the glaze breaks thin over an edge. Hex sRGB. */
  breakColor: string;
  /** How much a full coat hides the clay, 0..1. */
  cover: number;
  /** Fired roughness. 0 is gloss, 1 is matte. */
  roughness: number;
  /** How strongly edges lighten, 0..1. */
  break: number;
  /** How strongly recesses darken, 0..1. */
  pool: number;
  /** Millimeters where the coat starts to crawl. */
  crawlAt: number;
  /** Millimeters added by one dip, or by the center of one brush dab. */
  coatMm: number;
}

export const GLAZES: readonly GlazeRecipe[] = [
  {
    id: 1,
    name: 'Clear gloss',
    kind: 'gloss',
    raw: '#e4ded4',
    fired: '#f7f3ec',
    breakColor: '#fffaf4',
    cover: 0.16,
    roughness: 0.06,
    break: 0.2,
    pool: 0.18,
    crawlAt: 1.7,
    coatMm: 0.2,
  },
  {
    id: 2,
    name: 'Clear matte',
    kind: 'matte',
    raw: '#ddd6cb',
    fired: '#efe8dc',
    breakColor: '#f6f1e8',
    cover: 0.22,
    roughness: 0.82,
    break: 0.12,
    pool: 0.08,
    crawlAt: 1.6,
    coatMm: 0.2,
  },
  {
    id: 3,
    name: 'Celadon',
    kind: 'celadon',
    raw: '#d7e2d4',
    fired: '#6e9484',
    breakColor: '#d7e6d6',
    cover: 0.78,
    roughness: 0.14,
    break: 0.72,
    pool: 0.9,
    crawlAt: 1.4,
    coatMm: 0.28,
  },
  {
    id: 4,
    name: 'Tenmoku',
    kind: 'tenmoku',
    raw: '#e0cbb0',
    fired: '#1a120c',
    breakColor: '#c46a32',
    cover: 0.98,
    roughness: 0.1,
    break: 1,
    pool: 0.55,
    crawlAt: 1.35,
    coatMm: 0.32,
  },
  {
    id: 5,
    name: 'Shino',
    kind: 'shino',
    raw: '#f3d8c4',
    fired: '#e39a62',
    breakColor: '#f4e2cf',
    cover: 0.8,
    roughness: 0.46,
    break: 0.4,
    pool: 0.35,
    crawlAt: 0.7,
    coatMm: 0.36,
  },
  {
    id: 6,
    name: 'Cobalt',
    kind: 'gloss',
    raw: '#d0d8ea',
    fired: '#1a3e8a',
    breakColor: '#8eadd4',
    cover: 0.9,
    roughness: 0.1,
    break: 0.55,
    pool: 0.6,
    crawlAt: 1.5,
    coatMm: 0.24,
  },
  {
    id: 7,
    name: 'Oribe',
    kind: 'gloss',
    raw: '#d7e6c8',
    fired: '#1f6a38',
    breakColor: '#c5d7a4',
    cover: 0.88,
    roughness: 0.16,
    break: 0.5,
    pool: 0.55,
    crawlAt: 1.35,
    coatMm: 0.26,
  },
  {
    id: 8,
    name: 'Ash',
    kind: 'ash',
    raw: '#e4e0d4',
    fired: '#8d9174',
    breakColor: '#d9d4c4',
    cover: 0.7,
    roughness: 0.4,
    break: 0.48,
    pool: 0.8,
    crawlAt: 1.15,
    coatMm: 0.3,
  },
  {
    id: 9,
    name: 'Copper red',
    kind: 'copper',
    raw: '#ead4cc',
    fired: '#8f2433',
    breakColor: '#e7b2a4',
    cover: 0.86,
    roughness: 0.18,
    break: 0.7,
    pool: 0.65,
    crawlAt: 1.2,
    coatMm: 0.26,
  },
  {
    id: 10,
    name: 'Nuka',
    kind: 'matte',
    raw: '#ece6d8',
    fired: '#f3efe4',
    breakColor: '#fffdf8',
    cover: 0.55,
    roughness: 0.58,
    break: 0.75,
    pool: 0.3,
    crawlAt: 1.05,
    coatMm: 0.28,
  },
];

const BY_ID = new Map(GLAZES.map((glaze) => [glaze.id, glaze]));

export function getGlaze(id: number): GlazeRecipe {
  return BY_ID.get(id) ?? GLAZES[2];
}
