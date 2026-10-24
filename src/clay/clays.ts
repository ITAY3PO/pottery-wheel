import type { ClayTypeId, StageId } from '../core/types';

export interface ClayType {
  id: ClayTypeId;
  name: string;
  blurb: string;
  /** Wet density, kg/m³. Weight chosen by the thrower becomes volume. */
  density: number;
  colorWet: string;
  colorLeather: string;
  colorBone: string;
  colorBisque: string;
  colorFired: string;
  /** 0 stiff .. 1 buttery. Porcelain tears; earthenware forgives. */
  plasticity: number;
  /** Total linear shrinkage, wet to glaze-fired. */
  shrinkage: number;
  maxTempC: number;
}

export const CLAY_TYPES: readonly ClayType[] = [
  {
    id: 'stoneware',
    name: 'Stoneware',
    blurb: 'Forgiving and strong. The everyday throwing body.',
    density: 2000,
    colorWet: '#7a5644',
    colorLeather: '#a78468',
    colorBone: '#cbb396',
    colorBisque: '#d7c0a8',
    colorFired: '#b5653b',
    plasticity: 0.72,
    shrinkage: 0.12,
    maxTempC: 1280,
  },
  {
    id: 'porcelain',
    name: 'Porcelain',
    blurb: 'Pale and short. It remembers every slip of the hand.',
    density: 1850,
    colorWet: '#e4ddd4',
    colorLeather: '#efe8df',
    colorBone: '#f4efe8',
    colorBisque: '#fbf7f2',
    colorFired: '#f7f4ef',
    plasticity: 0.42,
    shrinkage: 0.15,
    maxTempC: 1300,
  },
  {
    id: 'earthenware',
    name: 'Earthenware',
    blurb: 'Soft, red, and plastic. Happiest in a low fire.',
    density: 1900,
    colorWet: '#a84832',
    colorLeather: '#c4644a',
    colorBone: '#d98468',
    colorBisque: '#e8a08a',
    colorFired: '#c4532f',
    plasticity: 0.88,
    shrinkage: 0.09,
    maxTempC: 1060,
  },
];

const BY_ID = new Map(CLAY_TYPES.map((clay) => [clay.id, clay]));

export function getClay(id: ClayTypeId): ClayType {
  const clay = BY_ID.get(id);
  if (!clay) throw new Error(`Unknown clay type: ${id}`);
  return clay;
}

export function volumeForWeight(weightKg: number, clay: ClayType): number {
  return weightKg / clay.density;
}

export function colorForStage(clay: ClayType, stage: StageId): string {
  switch (stage) {
    case 'wet':
      return clay.colorWet;
    case 'leather-hard':
      return clay.colorLeather;
    case 'bone-dry':
      return clay.colorBone;
    case 'bisque':
    case 'glazed':
      return clay.colorBisque;
    case 'glaze-fired':
      return clay.colorFired;
  }
}

/** Thinnest sound wall for this body, in meters. Below this it tears. */
export function minWallThickness(clay: ClayType): number {
  return 0.0023 - clay.plasticity * 0.00115;
}
