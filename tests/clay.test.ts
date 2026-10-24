import { describe, expect, it } from 'vitest';
import { getClay, minWallThickness, volumeForWeight } from '../src/clay/clays';
import {
  clayIndex,
  createClayGrid,
  createCylinderGrid,
  freezeProfile,
  pieceHeight,
  radialStdDev,
  volume,
} from '../src/clay/grid';
import { evaluateIntegrity, tornCount } from '../src/clay/integrity';
import { centerClay, compressClay, openCenter, pressIn, pullUp, type Stroke } from '../src/clay/shape';
import { bodyUV } from '../src/core/surfaceMap';

const stoneware = getClay('stoneware');
const porcelain = getClay('porcelain');

function expectConserved(before: number, after: number, tolerance = 0.02): void {
  expect(Math.abs(after - before) / before).toBeLessThan(tolerance);
}

describe('clay volume', () => {
  it('builds a lump whose volume matches the chosen weight', () => {
    const target = volumeForWeight(1.2, stoneware);
    const grid = createClayGrid(target);
    expectConserved(target, volume(grid), 0.01);
    expect(grid.rings).toBe(160);
    expect(grid.segments).toBe(72);
  });

  it('keeps the volume when clay is pressed inward and grows upward', () => {
    const grid = createClayGrid(volumeForWeight(1, stoneware), { wobble: 0, rings: 48, segments: 24 });
    const before = volume(grid);
    const height = pieceHeight(grid);
    const stroke: Stroke = { pressure: 0.9, omega: 16, segment: 0, dt: 1 / 60 };
    for (let i = 0; i < 40; i++) pressIn(grid, height * 0.55, stroke, stoneware);
    expectConserved(before, volume(grid));
    expect(pieceHeight(grid)).toBeGreaterThan(height * 1.02);
  });

  it('opens a well without losing clay', () => {
    const grid = createClayGrid(volumeForWeight(1, stoneware), { wobble: 0, rings: 48, segments: 24 });
    const before = volume(grid);
    const height = pieceHeight(grid);
    const stroke: Stroke = { pressure: 0.95, omega: 16, segment: 0, dt: 1 / 60 };
    for (let i = 0; i < 80; i++) openCenter(grid, height * 0.4, 0.02, stroke, stoneware);
    expectConserved(before, volume(grid), 0.03);
    const ring = Math.floor(grid.rings * 0.75);
    let inner = 0;
    for (let s = 0; s < grid.segments; s++) inner += grid.inner[clayIndex(ring, s, grid.segments)];
    expect(inner / grid.segments).toBeGreaterThan(0.008);
  });

  it('raises a wall when pulled and keeps the volume', () => {
    const grid = createCylinderGrid({
      radius: 0.05,
      height: 0.07,
      innerRadius: 0.03,
      floor: 0.012,
      rings: 48,
      segments: 24,
    });
    const before = volume(grid);
    const height = pieceHeight(grid);
    let y = height * 0.55;
    const stroke: Stroke = { pressure: 0.85, omega: 16, segment: 0, dt: 1 / 60 };
    for (let i = 0; i < 36; i++) {
      pullUp(grid, y, 0.0018, stroke, stoneware);
      y += 0.0008;
    }
    expect(pieceHeight(grid)).toBeGreaterThan(height * 1.12);
    expectConserved(before, volume(grid), 0.03);
  });

  it('shortens and keeps the volume when compressed', () => {
    const grid = createCylinderGrid({
      radius: 0.05,
      height: 0.1,
      innerRadius: 0.03,
      floor: 0.012,
      rings: 40,
      segments: 20,
    });
    const before = volume(grid);
    const height = pieceHeight(grid);
    const stroke: Stroke = { pressure: 0.9, omega: 14, segment: 0, dt: 1 / 60 };
    for (let i = 0; i < 30; i++) compressClay(grid, height * 0.7, 0.0016, stroke, stoneware);
    expect(pieceHeight(grid)).toBeLessThan(height * 0.95);
    expectConserved(before, volume(grid), 0.03);
  });
});

describe('centering and asymmetry', () => {
  it('spins a wobble toward round', () => {
    const grid = createClayGrid(volumeForWeight(1, stoneware), { wobble: 0.18, rings: 48, segments: 32 });
    const before = volume(grid);
    const mid = Math.floor(grid.rings * 0.5);
    const initial = radialStdDev(grid, mid);
    expect(initial).toBeGreaterThan(0.001);
    const stroke: Stroke = { pressure: 0.9, omega: 18, segment: 0, dt: 1 / 60 };
    for (let i = 0; i < 100; i++) centerClay(grid, grid.y[mid], stroke, stoneware);
    expect(radialStdDev(grid, mid)).toBeLessThan(initial * 0.2);
    expectConserved(before, volume(grid));
  });

  it('leaves a still finger mark where it was pressed', () => {
    const segments = 36;
    const grid = createCylinderGrid({ radius: 0.05, height: 0.08, rings: 36, segments });
    const ring = 18;
    const segment = 2;
    const far = 18;
    const before = grid.outer[clayIndex(ring, segment, segments)];
    const farBefore = grid.outer[clayIndex(ring, far, segments)];
    pressIn(grid, grid.y[ring], { pressure: 1, omega: 0, segment, dt: 0.12 }, stoneware);
    const dent = grid.outer[clayIndex(ring, segment, segments)];
    expect(dent).toBeLessThan(before - 0.001);
    const farAfter = grid.outer[clayIndex(ring, far, segments)];
    expect(Math.abs(farAfter - farBefore) / farBefore).toBeLessThan(0.035);
    evaluateIntegrity(grid, stoneware, 3);
    expect(grid.outer[clayIndex(ring, segment, segments)]).toBeCloseTo(dent, 4);
  });
});

describe('collapse', () => {
  it('tears a wall that is thinner than the clay can hold', () => {
    const grid = createCylinderGrid({
      radius: 0.05,
      height: 0.12,
      innerRadius: 0.0496,
      floor: 0.012,
      rings: 30,
      segments: 12,
    });
    const event = evaluateIntegrity(grid, porcelain, 0.016);
    expect(event.tore).toBe(true);
    expect(tornCount(grid)).toBeGreaterThan(0);
    expect(minWallThickness(porcelain)).toBeGreaterThan(minWallThickness(getClay('earthenware')));
  });

  it('slumps a tall wet wall that has been stressed', () => {
    const grid = createCylinderGrid({
      radius: 0.04,
      height: 0.22,
      innerRadius: 0.0382,
      floor: 0.01,
      rings: 36,
      segments: 16,
    });
    grid.moisture.fill(1);
    const before = pieceHeight(grid);
    let slumped = false;
    for (let i = 0; i < 30; i++) {
      if (evaluateIntegrity(grid, porcelain, 0.5).slumped) slumped = true;
    }
    expect(slumped).toBe(true);
    expect(pieceHeight(grid)).toBeLessThan(before);
  });
});

describe('profile uvs', () => {
  it('freezes arc-length v once the piece leaves the wheel', () => {
    const grid = createCylinderGrid({ radius: 0.04, height: 0.08, rings: 20, segments: 8 });
    expect(bodyUV(grid, 0, 0).v).toBe(0);
    expect(bodyUV(grid, grid.rings - 1, 4).v).toBeCloseTo(1, 5);
    freezeProfile(grid);
    const frozen = bodyUV(grid, 6, 2).v;
    grid.y[grid.rings - 1] = grid.y[grid.rings - 1] * 1.8;
    expect(bodyUV(grid, 6, 2).v).toBeCloseTo(frozen, 5);
    expect(bodyUV(grid, 6, 2).u).toBeCloseTo(2 / grid.segments, 5);
  });
});
