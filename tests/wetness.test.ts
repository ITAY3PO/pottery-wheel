import { describe, expect, it } from 'vitest';
import { Raycaster } from 'three';
import { getClay } from '../src/clay/clays';
import { createCylinderGrid, meanChannel, pieceHeight, volume } from '../src/clay/grid';
import { evaluateIntegrity } from '../src/clay/integrity';
import { pressIn } from '../src/clay/shape';
import {
  MAX_WETNESS_STRESS,
  deformRateScale,
  wetnessFromStress,
} from '../src/clay/wetness';
import { events } from '../src/core/events';
import type { ClayGrid, PieceState, ToolContext, ToolPointer } from '../src/core/types';
import { Wheel } from '../src/core/wheel';
import { tool as water } from '../src/tools/water';

const stoneware = getClay('stoneware');
const raycaster = new Raycaster();

function pieceWith(grid: ClayGrid): PieceState {
  return {
    version: 1,
    id: 'wetness',
    clayTypeId: 'stoneware',
    weightKg: 1,
    stage: 'wet',
    onWheel: true,
    grid,
    attachments: [],
    surfaces: [],
    speedSetting: 0.62,
    createdAt: 0,
    updatedAt: 0,
  };
}

function wall(): ClayGrid {
  return createCylinderGrid({
    radius: 0.05,
    height: 0.1,
    innerRadius: 0.032,
    floor: 0.012,
    rings: 40,
    segments: 36,
  });
}

function midRadius(grid: ClayGrid): number {
  return meanChannel(grid.outer, Math.floor(grid.rings * 0.5), grid.segments);
}

function strokeAt(
  piece: PieceState,
  wheel: Wheel,
  height: number,
  dt: number,
  previous: ToolPointer | null,
): ToolContext {
  const pointer: ToolPointer = {
    radius: 0.04,
    height,
    pressure: 0.92,
    side: 1,
    segment: 0,
    x: 0.04,
    y: height,
  };
  return {
    piece,
    wheel,
    pointer,
    previous,
    dt,
    screen: { x: 0, y: 0 },
    ndc: { x: 0, y: 0 },
    raycaster,
    surfaceHit: null,
    markSurfaceDirty() {},
    events,
  };
}

function wheelAt(): Wheel {
  const wheel = new Wheel();
  wheel.omega = 16;
  return wheel;
}

function contactHeight(grid: ClayGrid): number {
  return grid.y[Math.floor(grid.rings * 0.5)];
}

/** One tap. Wets and raises stress, and does not squat. */
function tapWater(grid: ClayGrid, dt = 1 / 60): void {
  const piece = pieceWith(grid);
  water.onPointerDown(strokeAt(piece, wheelAt(), contactHeight(grid), dt, null));
}

/**
 * Held stroke after the tap: `seconds` of onPointerMove.
 * The tap is not part of `seconds`, so 30 fps and 120 fps integrate the same time.
 */
function holdWater(grid: ClayGrid, seconds: number, dt: number, withIntegrity = false): void {
  const piece = pieceWith(grid);
  const wheel = wheelAt();
  const height = contactHeight(grid);
  // Same tap on every clock, then a hold whose steps sum to `seconds`.
  tapWater(grid, 1 / 60);
  const steps = Math.max(1, Math.round(seconds / dt));
  let previous: ToolPointer | null = null;
  for (let i = 0; i < steps; i++) {
    const ctx = strokeAt(piece, wheel, height, dt, previous);
    water.onPointerMove(ctx);
    previous = ctx.pointer;
    if (withIntegrity) evaluateIntegrity(grid, stoneware, dt);
  }
}

function pressFor(grid: ClayGrid, seconds: number, dt: number): void {
  const height = grid.y[Math.floor(grid.rings * 0.5)];
  const steps = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < steps; i++) {
    pressIn(grid, height, { pressure: 1, omega: 16, segment: 0, dt }, stoneware);
  }
}

describe('wetness clamp', () => {
  it('keeps a second of deform inside a sane bound at maximum wetness', () => {
    const dry = wall();
    const wet = wall();
    const wild = wall();
    wet.stress = MAX_WETNESS_STRESS;
    wild.stress = 10_000;
    const dryR = midRadius(dry);
    const wetR = midRadius(wet);
    const wildR = midRadius(wild);
    pressFor(dry, 1, 1 / 60);
    pressFor(wet, 1, 1 / 60);
    pressFor(wild, 1, 1 / 60);

    const dryIn = dryR - midRadius(dry);
    const wetIn = wetR - midRadius(wet);
    const wildIn = wildR - midRadius(wild);
    expect(wetnessFromStress(10_000)).toBe(1);
    expect(deformRateScale(10_000)).toBeCloseTo(deformRateScale(MAX_WETNESS_STRESS), 6);
    expect(deformRateScale(10_000)).toBeLessThanOrEqual(1.2);
    // Slightly softer than a dry wall, and nowhere near a balloon.
    expect(wetIn).toBeGreaterThan(dryIn);
    expect(wetIn).toBeLessThan(0.05);
    expect(wildIn).toBeCloseTo(wetIn, 4);

    const soaked = wall();
    soaked.stress = MAX_WETNESS_STRESS;
    const before = midRadius(soaked);
    holdWater(soaked, 1, 1 / 60, true);
    const grown = midRadius(soaked) - before;
    expect(grown).toBeGreaterThan(0);
    expect(grown).toBeLessThan(0.012);
    expect(pieceHeight(soaked)).toBeGreaterThan(0.07);
  });

  it('does not let repeated water taps stack past the clamp or move the wall', () => {
    const grid = wall();
    const piece = pieceWith(grid);
    const wheel = wheelAt();
    const height = grid.y[20];
    const radius = midRadius(grid);
    const height0 = pieceHeight(grid);
    for (let i = 0; i < 40; i++) {
      water.onPointerDown(strokeAt(piece, wheel, height, 1 / 60, null));
    }
    expect(grid.stress).toBeLessThanOrEqual(MAX_WETNESS_STRESS);
    expect(grid.stress).toBeCloseTo(MAX_WETNESS_STRESS, 5);
    expect(midRadius(grid)).toBeCloseTo(radius, 6);
    expect(pieceHeight(grid)).toBeCloseTo(height0, 6);
    expect(volume(grid)).toBeCloseTo(volume(wall()), 6);

    // Already fully wet: another tap still does not deform.
    const again = midRadius(grid);
    water.onPointerDown(strokeAt(piece, wheel, height, 1 / 60, null));
    expect(grid.stress).toBe(MAX_WETNESS_STRESS);
    expect(midRadius(grid)).toBeCloseTo(again, 6);
  });

  it('matches at 30 fps and 120 fps', () => {
    const slow = wall();
    const fast = wall();
    holdWater(slow, 0.4, 1 / 30, true);
    holdWater(fast, 0.4, 1 / 120, true);
    // Same soak, two clocks. A per-frame step (the old 0.985 squat) drifts by millimetres.
    expect(Math.abs(midRadius(slow) - midRadius(fast))).toBeLessThan(0.0004);
    expect(Math.abs(pieceHeight(slow) - pieceHeight(fast))).toBeLessThan(0.0004);
    expect(Math.abs(slow.stress - fast.stress)).toBeLessThan(0.25);

    const pressSlow = wall();
    const pressFast = wall();
    pressSlow.stress = MAX_WETNESS_STRESS;
    pressFast.stress = MAX_WETNESS_STRESS;
    pressFor(pressSlow, 0.4, 1 / 30);
    pressFor(pressFast, 0.4, 1 / 120);
    expect(Math.abs(midRadius(pressSlow) - midRadius(pressFast))).toBeLessThan(0.0015);
  });

  it('stays gradual when a short soak is followed by a short press', () => {
    const grid = wall();
    const before = midRadius(grid);
    holdWater(grid, 0.3, 1 / 60, true);
    const afterWater = midRadius(grid);
    expect(afterWater - before).toBeLessThan(0.004);
    pressFor(grid, 0.3, 1 / 60);
    evaluateIntegrity(grid, stoneware, 0.3);
    expect(midRadius(grid) - afterWater).toBeLessThan(0.004);
    expect(pieceHeight(grid)).toBeGreaterThan(0.09);
  });
});
