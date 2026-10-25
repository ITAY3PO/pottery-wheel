import { clamp } from './grid';

/**
 * How the thrower is touching the clay.
 *
 * The three profiles are different envelopes, not a single force with a new
 * label. Pressure and drag speed still scale inside the envelope. A missing
 * mode on a stroke keeps the legacy contact, so tools that are not a hand
 * (rib, needle, knife, sponge, water, wire, trimming) stay as they were.
 */
export type HandMode = 'fingertip' | 'palm' | 'knuckle';

export type HandFalloff = 'sharp' | 'smooth' | 'firm';

export interface HandContact {
  id: HandMode;
  label: string;
  /** One line under the picker. */
  note: string;
  /** Vertical half-width of the contact, meters. */
  halfWidth: number;
  /** Still-hand half-arc, as a fraction of the circumference. */
  halfArc: number;
  /** Radial push, relative to the legacy press. */
  press: number;
  /** How fast a well opens, relative to the legacy thumb. */
  open: number;
  /** Extra well radius, meters. A palm cannot cut a pinhole. */
  openSpread: number;
  /** Centering push, relative to the legacy center. */
  center: number;
  /** Pull height, relative to the legacy pull. */
  lift: number;
  /** Downward squash, relative to the legacy compress. */
  squash: number;
  /** Vertical smooth rate after a press, 1/s. Legacy is about 10.5. */
  smooth: number;
  falloff: HandFalloff;
  /** A spinning palm recenters the whole lump. A finger does not. */
  centerWhole: boolean;
  /** Indicator radius at a light touch, meters. */
  indicator: number;
}

/** Centering is the first gesture, and a palm will not cut a groove into a fresh lump. */
export const DEFAULT_HAND: HandMode = 'palm';

const STORAGE_KEY = 'pottery-wheel:hand';

const CONTACTS: Record<HandMode, HandContact> = {
  fingertip: {
    id: 'fingertip',
    label: 'Fingertip',
    note: 'Narrow and firm. Grooves, the center, rims.',
    halfWidth: 0.005,
    halfArc: 0.02,
    press: 1.85,
    open: 1.7,
    openSpread: 0,
    center: 1.5,
    lift: 0.52,
    squash: 0.55,
    smooth: 1.8,
    falloff: 'sharp',
    centerWhole: false,
    indicator: 0.004,
  },
  palm: {
    id: 'palm',
    label: 'Palm',
    note: 'Broad and soft. Centers and smooths.',
    halfWidth: 0.034,
    halfArc: 0.12,
    press: 0.42,
    open: 1,
    openSpread: 0.006,
    center: 0.95,
    lift: 0.68,
    squash: 1.12,
    smooth: 34,
    falloff: 'smooth',
    centerWhole: true,
    indicator: 0.0165,
  },
  knuckle: {
    id: 'knuckle',
    label: 'Knuckle',
    note: 'Firm edge. Pulls and raises a wall.',
    halfWidth: 0.0135,
    halfArc: 0.05,
    press: 1.18,
    open: 1.08,
    openSpread: 0.002,
    center: 1.05,
    lift: 1.78,
    squash: 0.88,
    smooth: 7.5,
    falloff: 'firm',
    centerWhole: false,
    indicator: 0.0082,
  },
};

/** Fingertip, palm, knuckle. The order of the studio picker. */
export const HANDS: readonly HandContact[] = [CONTACTS.fingertip, CONTACTS.palm, CONTACTS.knuckle];

const HAND_TOOLS = new Set(['center', 'press', 'pull', 'open', 'compress']);

let memoryOverride: Pick<Storage, 'getItem' | 'setItem'> | null = null;
let cached: HandMode | null = null;

export function isHandMode(value: string): value is HandMode {
  return value === 'fingertip' || value === 'palm' || value === 'knuckle';
}

export function handContact(mode: HandMode): HandContact {
  return CONTACTS[mode] ?? CONTACTS[DEFAULT_HAND];
}

/** Bare-hand throwing tools. Ribs, needles, and the rest keep their own contact. */
export function toolUsesHand(toolId: string): boolean {
  return HAND_TOOLS.has(toolId);
}

/**
 * World scale for the default contact sphere (geometry radius 6mm).
 * A fingertip stays a small ball, a knuckle a short bar, a palm a wide pad.
 * Pressure still swells the mark inside that shape.
 */
export function contactFootprint(
  mode: HandMode,
  pressure: number,
): { x: number; y: number; z: number } {
  const hand = handContact(mode);
  const radius = hand.indicator * (0.84 + 0.4 * clamp(pressure, 0, 1));
  const scale = radius / 0.006;
  if (mode === 'palm') return { x: scale * 1.5, y: scale * 0.36, z: scale * 0.78 };
  if (mode === 'knuckle') return { x: scale * 1.22, y: scale * 0.55, z: scale * 0.62 };
  return { x: scale * 0.68, y: scale * 0.9, z: scale * 0.68 };
}

/** 0 at the contact center, 1 at the edge of the band. */
export function handFalloff(kind: HandFalloff, distance: number): number {
  if (distance >= 1) return 0;
  if (distance <= 0) return 1;
  if (kind === 'sharp') {
    const cosine = Math.cos(distance * Math.PI * 0.5);
    return cosine * cosine * cosine;
  }
  if (kind === 'smooth') {
    const eased = distance * distance * (3 - 2 * distance);
    return 1 - eased;
  }
  // Flat under the knuckle, then a shoulder that is steeper than a palm.
  if (distance < 0.55) return 1 - distance * 0.08;
  const edge = (distance - 0.55) / 0.45;
  return Math.cos(edge * Math.PI * 0.5) * 0.956;
}

export function currentHand(): HandMode {
  if (cached) return cached;
  cached = storedHand();
  return cached;
}

export function setHandMode(mode: HandMode): void {
  if (!isHandMode(mode)) return;
  cached = mode;
  try {
    memory()?.setItem(STORAGE_KEY, mode);
  } catch {
    // Private mode can throw on write. The session still keeps the choice.
  }
}

/** Test hook. Pass storage to replay a saved choice; omit it to drop the override. */
export function resetHandForTests(storage?: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  memoryOverride = storage ?? null;
  cached = null;
}

function storedHand(): HandMode {
  try {
    const value = memory()?.getItem(STORAGE_KEY);
    if (value && isHandMode(value)) return value;
  } catch {
    // Private mode can throw on read.
  }
  return DEFAULT_HAND;
}

function memory(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (memoryOverride) return memoryOverride;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}
