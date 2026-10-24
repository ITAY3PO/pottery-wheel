import { clamp } from './grid';

/**
 * Stress that counts as fully wet. Fresh clay is already moisture 1, so extra
 * water is tracked as stress and cannot stack past this.
 */
export const MAX_WETNESS_STRESS = 14;

/**
 * How much faster shaping is at full wetness. Wet clay gives a little;
 * it does not multiply the hand.
 */
export const MAX_WET_SOFTNESS = 0.2;

/**
 * Height lost per second while a soaked finger is held at full pressure
 * and full wetness. The wall widens only as volume moves out, about half
 * this rate.
 */
export const MAX_SQUAT_RATE = 0.22;

/** 0 when the wall is unstressed, 1 at and above `MAX_WETNESS_STRESS`. */
export function wetnessFromStress(stress: number): number {
  if (!Number.isFinite(stress) || stress <= 0) return 0;
  return clamp(stress / MAX_WETNESS_STRESS, 0, 1);
}

/** Scale on a per-second deform rate. Clamped, so a huge stress cannot run away. */
export function deformRateScale(stress: number): number {
  return 1 + MAX_WET_SOFTNESS * wetnessFromStress(stress);
}

/** Add water-driven stress and keep it inside the wetness clamp. */
export function clampWaterStress(stress: number, added: number): number {
  const base = Number.isFinite(stress) && stress > 0 ? stress : 0;
  const extra = Number.isFinite(added) && added > 0 ? added : 0;
  return Math.min(MAX_WETNESS_STRESS, base + extra);
}

/**
 * Gap multiplier for one soaked sample. Exponential in `dt`, so a 30 fps
 * step and four 120 fps steps land on the same profile.
 */
export function squatGapFactor(dt: number, pressure: number, stress: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 1;
  const rate = MAX_SQUAT_RATE * clamp(pressure, 0, 1) * wetnessFromStress(stress);
  if (rate <= 0) return 1;
  return Math.exp(-rate * dt);
}
