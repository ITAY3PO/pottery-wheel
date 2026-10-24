import { describe, expect, it } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { getClay } from '../src/clay/clays';
import {
  createCylinderGrid,
  meanChannel,
  pieceHeight,
  profileExtent,
  silhouette,
  volume,
  volumeBetween,
} from '../src/clay/grid';
import { events } from '../src/core/events';
import type { ClayGrid, PieceState, ToolContext, ToolPointer } from '../src/core/types';
import { Wheel } from '../src/core/wheel';
import { axialBlend, pressAlongView, pressIn, type Stroke, type ViewPress } from '../src/clay/shape';
import { profileOnViewPlane, VIEW_PRESETS, type ViewPreset } from '../src/render/cameraRig';
import { tool as press } from '../src/tools/press';

const stoneware = getClay('stoneware');

function expectConserved(before: number, after: number, tolerance = 0.02): void {
  expect(Math.abs(after - before) / before).toBeLessThan(tolerance);
}

function solid(): ClayGrid {
  return createCylinderGrid({ radius: 0.05, height: 0.08, rings: 36, segments: 16 });
}

function at(grid: ClayGrid, channel: 'outer' | 'inner', t: number): number {
  const ring = Math.min(grid.rings - 1, Math.max(0, Math.round(t * (grid.rings - 1))));
  const data = channel === 'outer' ? grid.outer : grid.inner;
  return meanChannel(data, ring, grid.segments);
}

const stroke: Stroke = { pressure: 0.9, omega: 16, segment: 0, dt: 1 / 60 };

function runView(axial: number, frames = 40, radius = 0.004): ClayGrid {
  const grid = solid();
  const height = pieceHeight(grid) * 0.55;
  const press: ViewPress = { axial, radius, height };
  for (let i = 0; i < frames; i++) pressAlongView(grid, press, stroke, stoneware);
  return grid;
}

describe('ray angle', () => {
  it('blends by the ray angle to the wheel axis', () => {
    expect(axialBlend(0)).toBe(0);
    expect(axialBlend(0.4)).toBe(0);
    expect(axialBlend(-1)).toBe(1);
    expect(axialBlend(-Math.SQRT1_2)).toBeCloseTo(0.5, 5);
  });

  it('puts side, three-quarter, and top on that blend', () => {
    const blend = (id: ViewPreset) => {
      const preset = VIEW_PRESETS.find((entry) => entry.id === id);
      if (!preset) throw new Error(id);
      return axialBlend(-Math.cos(preset.polar));
    };
    expect(blend('side')).toBeLessThan(0.02);
    expect(blend('three-quarter')).toBeCloseTo(0.5, 5);
    expect(blend('top')).toBeGreaterThan(0.9);
  });
});

describe('view-dependent press', () => {
  it('shapes the wall radially from the side, the same as pressing inward', () => {
    const height = 0.08 * 0.55;
    const side = solid();
    const direct = solid();
    const before = volume(side);
    const outerBefore = at(side, 'outer', 0.55);
    for (let i = 0; i < 40; i++) {
      pressIn(direct, height, stroke, stoneware);
      pressAlongView(side, { axial: 0, radius: 0.05, height }, stroke, stoneware);
    }
    expect(pieceHeight(side)).toBeGreaterThan(0.08);
    expect(at(side, 'outer', 0.55)).toBeLessThan(outerBefore - 0.001);
    expect(at(side, 'inner', 0.75)).toBe(0);
    for (let i = 0; i < side.outer.length; i++) {
      expect(side.outer[i]).toBeCloseTo(direct.outer[i], 6);
      expect(side.inner[i]).toBeCloseTo(direct.inner[i], 6);
    }
    expectConserved(before, volume(side));
  });

  it('opens a floor and walls from the top and keeps the volume', () => {
    const grid = solid();
    const before = volume(grid);
    const height = pieceHeight(grid);
    const floorBefore = volumeBetween(grid, 0, Math.floor(grid.rings * 0.12));
    const wallBefore = at(grid, 'outer', 0.62);
    const baseBefore = at(grid, 'outer', 0.06);
    for (let i = 0; i < 40; i++) {
      pressAlongView(grid, { axial: 1, radius: 0.002, height: height * 0.92 }, stroke, stoneware);
    }
    expect(at(grid, 'inner', 0.72)).toBeGreaterThan(0.012);
    expect(at(grid, 'inner', 0.04)).toBe(0);
    expect(at(grid, 'outer', 0.62)).toBeGreaterThan(wallBefore * 1.015);
    expect(at(grid, 'outer', 0.06)).toBeGreaterThan(baseBefore * 1.03);
    expect(volumeBetween(grid, 0, Math.floor(grid.rings * 0.12))).toBeGreaterThan(floorBefore * 1.04);
    expect(pieceHeight(grid)).toBeLessThan(height * 0.98);
    expectConserved(before, volume(grid));
  });

  it('blends opening and wall shaping at a three-quarter angle', () => {
    const side = runView(0);
    const quarter = runView(0.5);
    const top = runView(1);
    const sideInner = at(side, 'inner', 0.72);
    const midInner = at(quarter, 'inner', 0.72);
    const topInner = at(top, 'inner', 0.72);
    expect(sideInner).toBe(0);
    expect(midInner).toBeGreaterThan(sideInner + 0.004);
    expect(midInner).toBeLessThan(topInner * 0.85);
    expectConserved(volume(solid()), volume(side));
    expectConserved(volume(solid()), volume(quarter));
    expectConserved(volume(solid()), volume(top));
  });

  it('keeps the clay somewhere for side, blended, and top presses', () => {
    for (const axial of [0, 0.5, 1]) {
      const grid = solid();
      const before = volume(grid);
      const height = pieceHeight(grid) * 0.55;
      for (let i = 0; i < 48; i++) {
        pressAlongView(grid, { axial, radius: 0.003, height }, stroke, stoneware);
      }
      expectConserved(before, volume(grid), 0.015);
      expect(volume(grid)).toBeGreaterThan(before * 0.5);
    }
  });
});

describe('press tool', () => {
  function pieceWith(grid: ClayGrid): PieceState {
    return {
      version: 1,
      id: 'view-press',
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

  function runRay(direction: Vector3, point: Vector3, frames: number): ClayGrid {
    const grid = solid();
    const wheel = new Wheel();
    wheel.omega = 16;
    const piece = pieceWith(grid);
    const raycaster = new Raycaster();
    raycaster.ray.direction.copy(direction).normalize();
    const pointer: ToolPointer = {
      radius: Math.hypot(point.x, point.z),
      height: point.y,
      pressure: 0.9,
      side: 1,
      segment: 0,
      x: point.x,
      y: point.y,
    };
    const ctx: ToolContext = {
      piece,
      wheel,
      pointer,
      previous: null,
      dt: 1 / 60,
      screen: { x: 0, y: 0 },
      ndc: { x: 0, y: 0 },
      raycaster,
      surfaceHit: {
        meshId: 'body',
        u: 0.5,
        v: 0.8,
        point,
        normal: direction.clone().multiplyScalar(-1).normalize(),
      },
      markSurfaceDirty() {},
      events,
    };
    for (let i = 0; i < frames; i++) {
      if (i === 0) press.onPointerDown(ctx);
      else press.onPointerMove(ctx);
      ctx.previous = pointer;
    }
    return grid;
  }

  it('opens from a downward ray and collars from a side ray', () => {
    const top = runRay(new Vector3(0, -1, 0), new Vector3(0.001, 0.075, 0), 36);
    const side = runRay(new Vector3(0, 0, -1), new Vector3(0.05, 0.044, 0), 36);
    expect(at(top, 'inner', 0.72)).toBeGreaterThan(0.01);
    expect(at(top, 'inner', 0.04)).toBe(0);
    expect(at(side, 'inner', 0.72)).toBe(0);
    expect(pieceHeight(side)).toBeGreaterThan(0.08);
    expectConserved(volume(solid()), volume(top));
    expectConserved(volume(solid()), volume(side));
  });
});

describe('view plane', () => {
  it('keeps the side-view profile on world X', () => {
    const hit = profileOnViewPlane({ x: 0.02, y: 0.11, z: 0.4 }, { x: 0, y: -0.02, z: -1 }, 0, 1);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBeCloseTo(0.02, 5);
    expect(hit?.y).toBeCloseTo(0.102, 3);
  });

  it('still finds a center point when the camera is nearly overhead', () => {
    const hit = profileOnViewPlane({ x: 0, y: 0.5, z: 0.12 }, { x: 0, y: -1, z: -0.2 }, 0, 0.12);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit?.x ?? 1)).toBeLessThan(0.002);
  });

  it('ignores a ray parallel to the profile plane', () => {
    expect(profileOnViewPlane({ x: 0, y: 0.2, z: 0.3 }, { x: 1, y: 0, z: 0 }, 0, 1)).toBeNull();
  });

  it('matches the old side silhouette when the camera has not turned', () => {
    const grid = solid();
    expect(profileExtent(grid, 0.04, 0.4, 0, 1)).toBeCloseTo(silhouette(grid, 0.04, 0.4, 1), 8);
    expect(profileExtent(grid, 0.04, 0.4, 0, -1)).toBeCloseTo(silhouette(grid, 0.04, 0.4, -1), 8);
  });
});
