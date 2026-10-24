export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityMode = 'auto' | QualityLevel;

/** What the renderer should spend this frame. The clay grid itself never changes. */
export interface QualityProfile {
  mode: QualityMode;
  level: QualityLevel;
  pixelRatio: number;
  shadows: boolean;
  maxRings: number;
  maxSegments: number;
}

const STORAGE_KEY = 'pottery-wheel:quality';

interface Tier {
  level: QualityLevel;
  pixelRatioCap: number;
  maxRings: number;
  maxSegments: number;
  shadows: boolean;
}

/**
 * Auto climbs this ladder. Shadows are the last step, so a phone that can
 * hold 60fps at full mesh does not also turn on a shadow map until the
 * frames say there is room.
 */
const TIERS: readonly Tier[] = [
  { level: 'low', pixelRatioCap: 1, maxRings: 80, maxSegments: 36, shadows: false },
  { level: 'medium', pixelRatioCap: 1.25, maxRings: 120, maxSegments: 48, shadows: false },
  { level: 'high', pixelRatioCap: 1.5, maxRings: 4096, maxSegments: 4096, shadows: false },
  { level: 'high', pixelRatioCap: 2, maxRings: 4096, maxSegments: 4096, shadows: true },
];

const MANUAL: Record<QualityLevel, number> = { low: 0, medium: 1, high: 3 };

const WARMUP = 40;
const DOWN_MS = 0.0185;
const DOWN_FRAMES = 24;
const COOLDOWN = 90;

let dprOverride: number | null = null;
let coarseOverride: boolean | null = null;
let storageOverride: Pick<Storage, 'getItem' | 'setItem'> | null = null;

let loaded = false;
let mode: QualityMode = 'auto';
let tier = 1;
let ema = 0.016;
let samples = 0;
let hot = 0;
let cool = 0;
let cooldown = 0;
let upGate = 0.0125;
let upNeed = 150;

function devicePixelRatio(): number {
  if (dprOverride != null) return dprOverride;
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio;
  return dpr > 0 ? dpr : 1;
}

function prefersCoarse(): boolean {
  if (coarseOverride != null) return coarseOverride;
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

function memory(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (storageOverride) return storageOverride;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function storedMode(): QualityMode {
  try {
    const value = memory()?.getItem(STORAGE_KEY);
    if (value === 'auto' || value === 'low' || value === 'medium' || value === 'high') return value;
  } catch {
    // Private mode can throw on read.
  }
  return 'auto';
}

function initialTier(): number {
  const dpr = devicePixelRatio();
  if (prefersCoarse() || dpr >= 2) return 1;
  if (dpr <= 1.25) return 3;
  return 2;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  mode = storedMode();
  tier = mode === 'auto' ? initialTier() : MANUAL[mode];
}

function profileFromTier(): QualityProfile {
  const spec = TIERS[tier] ?? TIERS[1];
  return {
    mode,
    level: spec.level,
    pixelRatio: Math.min(devicePixelRatio(), spec.pixelRatioCap),
    shadows: spec.shadows,
    maxRings: spec.maxRings,
    maxSegments: spec.maxSegments,
  };
}

export function currentProfile(): QualityProfile {
  ensureLoaded();
  return profileFromTier();
}

export function setQualityMode(next: QualityMode): QualityProfile {
  ensureLoaded();
  mode = next;
  try {
    memory()?.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore quota and private-mode failures. The session still applies.
  }
  tier = next === 'auto' ? initialTier() : MANUAL[next];
  samples = 0;
  ema = 0.016;
  hot = 0;
  cool = 0;
  cooldown = next === 'auto' ? 45 : 0;
  upGate = 0.0125;
  upNeed = 150;
  return profileFromTier();
}

/**
 * Feed one frame's real duration (seconds, not the clamped sim step).
 * Returns true when auto moved a tier. Manual modes never move.
 */
export function noteFrame(dt: number): boolean {
  ensureLoaded();
  if (mode !== 'auto') return false;
  if (!(dt > 0) || dt > 0.5) return false;
  samples += 1;
  ema = samples === 1 ? dt : ema * 0.9 + dt * 0.1;
  if (samples < WARMUP) return false;
  if (cooldown > 0) {
    cooldown -= 1;
    return false;
  }
  if (ema > DOWN_MS) {
    cool = 0;
    hot += 1;
    if (hot >= DOWN_FRAMES && tier > 0) {
      tier -= 1;
      hot = 0;
      cooldown = COOLDOWN;
      upGate = Math.min(upGate, 0.0105);
      upNeed = 300;
      return true;
    }
    return false;
  }
  hot = 0;
  if (ema < upGate) {
    cool += 1;
    if (cool >= upNeed && tier < TIERS.length - 1) {
      tier += 1;
      cool = 0;
      cooldown = COOLDOWN;
      return true;
    }
    return false;
  }
  cool = 0;
  return false;
}

/** Test hook. Production code leaves the overrides unset. */
export function resetQualityForTests(env?: {
  dpr?: number;
  coarse?: boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}): void {
  dprOverride = env?.dpr ?? null;
  coarseOverride = env?.coarse ?? null;
  storageOverride = env?.storage ?? null;
  loaded = false;
  mode = 'auto';
  tier = 1;
  ema = 0.016;
  samples = 0;
  hot = 0;
  cool = 0;
  cooldown = 0;
  upGate = 0.0125;
  upNeed = 150;
}
