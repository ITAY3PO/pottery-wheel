import { describe, expect, it } from 'vitest';
import { getClay } from '../src/clay/clays';
import {
  clayIndex,
  createCylinderGrid,
  meanChannel,
  pieceHeight,
  radialStdDev,
  volume,
} from '../src/clay/grid';
import { evaluateIntegrity } from '../src/clay/integrity';
import { loadTools, toolsFor } from '../src/core/registry';
import type { ClayGrid, PieceState, Tool, ToolPointer } from '../src/core/types';
import { Wheel } from '../src/core/wheel';
import { tool as knife } from '../src/tools/knife';
import { tool as needle } from '../src/tools/needle';
import { tool as rib } from '../src/tools/rib';
import { tool as sponge } from '../src/tools/sponge';
import { tool as water } from '../src/tools/water';

const stoneware = getClay('stoneware');

function pieceWith(grid: ClayGrid): PieceState {
  return {
    version: 1,
    id: 'tool-test',
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

function pointerAt(height: number, extra: Partial<ToolPointer> = {}): ToolPointer {
  return {
    radius: 0.05,
    height,
    pressure: 0.92,
    side: 1,
    segment: 0,
    x: 0.05,
    y: height,
    ...extra,
  };
}

function run(
  tool: Tool,
  grid: ClayGrid,
  height: number,
  frames: number,
  options: { omega?: number; pressure?: number; segment?: number } = {},
): Wheel {
  const wheel = new Wheel();
  wheel.running = true;
  wheel.speed = 0.62;
  wheel.omega = options.omega ?? 16;
  const piece = pieceWith(grid);
  let previous: ToolPointer | null = null;
  for (let i = 0; i < frames; i++) {
    const pointer = pointerAt(height, {
      pressure: options.pressure ?? 0.92,
      segment: options.segment ?? 0,
    });
    const ctx = { piece, wheel, pointer, previous, dt: 1 / 60 };
    if (i === 0) tool.onPointerDown(ctx);
    else tool.onPointerMove(ctx);
    previous = pointer;
  }
  return wheel;
}

function ripple(grid: ClayGrid, ring: number): number {
  const segs = grid.segments;
  const base = ring * segs;
  let acc = 0;
  for (let s = 0; s < segs; s++) {
    const prev = grid.outer[base + ((s + segs - 1) % segs)];
    const next = grid.outer[base + ((s + 1) % segs)];
    const d = grid.outer[base + s] - (prev + next) * 0.5;
    acc += d * d;
  }
  return Math.sqrt(acc / segs);
}

function thickness(grid: ClayGrid, ring: number): number {
  let sum = 0;
  for (let s = 0; s < grid.segments; s++) {
    const i = clayIndex(ring, s, grid.segments);
    sum += grid.outer[i] - grid.inner[i];
  }
  return sum / grid.segments;
}

function maxJump(grid: ClayGrid): number {
  let jump = 0;
  for (let r = 1; r < grid.rings; r++) {
    const step = Math.abs(
      meanChannel(grid.outer, r, grid.segments) - meanChannel(grid.outer, r - 1, grid.segments),
    );
    jump = Math.max(jump, step);
  }
  return jump;
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

describe('throwing tools', () => {
  it('registers each tool on the wet wheel, with its own haptics', () => {
    const ids = loadTools().map((tool) => tool.id);
    expect(ids).toEqual(expect.arrayContaining(['water', 'rib', 'sponge', 'needle', 'knife']));
    expect(toolsFor('wet', true).map((tool) => tool.id)).toEqual(
      expect.arrayContaining(['rib', 'sponge', 'water', 'needle', 'knife']),
    );
    expect(toolsFor('leather-hard', true).some((tool) => tool.id === 'rib')).toBe(false);
    for (const tool of [rib, sponge, water, needle, knife]) {
      expect(tool.haptics?.down).toBeTruthy();
      expect(tool.haptics?.move).toBeTruthy();
      expect(tool.requiresWheel).toBe(true);
      expect(tool.allowedStages).toContain('wet');
    }
  });

  it('lets water slip and a knife bite, so drag matches the tool', () => {
    const grid = () => wall();
    const coast = (tool: Tool) => {
      const wheel = run(tool, grid(), 0.004, 10, { omega: 16 });
      wheel.step(1 / 60);
      return wheel.omega;
    };
    const waterOmega = coast(water);
    const spongeOmega = coast(sponge);
    const ribOmega = coast(rib);
    const knifeOmega = coast(knife);
    expect(waterOmega).toBeGreaterThan(spongeOmega);
    expect(spongeOmega).toBeGreaterThan(ribOmega);
    expect(ribOmega).toBeGreaterThan(knifeOmega);
  });
});

describe('rib', () => {
  it('erases throwing lines, thickens the wall, and keeps the volume', () => {
    const grid = wall();
    const ring = 20;
    const before = volume(grid);
    const thickBefore = thickness(grid, ring);
    for (let r = ring - 2; r <= ring + 2; r++) {
      for (let s = 0; s < grid.segments; s++) {
        const wave = 0.0022 * Math.sin((s / grid.segments) * Math.PI * 2 * 6);
        grid.outer[clayIndex(r, s, grid.segments)] += wave;
      }
    }
    const lines = ripple(grid, ring);
    expect(lines).toBeGreaterThan(0.0005);
    const wet = grid.moisture[ring];
    run(rib, grid, grid.y[ring], 30);
    expect(ripple(grid, ring)).toBeLessThan(lines * 0.45);
    expect(thickness(grid, ring)).toBeGreaterThan(thickBefore + 0.0004);
    expect(grid.moisture[ring]).toBeLessThan(wet - 0.04);
    expect(Math.abs(volume(grid) - before) / before).toBeLessThan(0.02);
  });

  it('fairs a kink in the profile', () => {
    const grid = wall();
    const ring = 18;
    for (let s = 0; s < grid.segments; s++) grid.outer[clayIndex(ring, s, grid.segments)] += 0.008;
    const jump = maxJump(grid);
    expect(jump).toBeGreaterThan(0.007);
    run(rib, grid, grid.y[ring], 36);
    expect(maxJump(grid)).toBeLessThan(jump * 0.62);
  });
});

describe('sponge', () => {
  it('lowers moisture on the contact band and leaves the wall and the far rings alone', () => {
    const grid = wall();
    const ring = 20;
    const outer = grid.outer[clayIndex(ring, 0, grid.segments)];
    const before = volume(grid);
    run(sponge, grid, grid.y[ring], 20);
    expect(grid.moisture[ring]).toBeLessThan(0.7);
    expect(grid.moisture[ring]).toBeGreaterThan(0.38);
    expect(grid.moisture[2]).toBe(1);
    expect(grid.moisture[grid.rings - 1]).toBe(1);
    expect(grid.outer[clayIndex(ring, 0, grid.segments)]).toBe(outer);
    expect(volume(grid)).toBe(before);
  });
});

describe('water', () => {
  it('raises moisture on a drier wall without softening it', () => {
    const grid = wall();
    grid.moisture.fill(0.5);
    const ring = 20;
    const height = pieceHeight(grid);
    const outer = meanChannel(grid.outer, ring, grid.segments);
    run(water, grid, grid.y[ring], 18);
    expect(grid.moisture[ring]).toBeGreaterThan(0.8);
    expect(grid.moisture[1]).toBeCloseTo(0.5, 5);
    expect(grid.stress).toBe(0);
    expect(pieceHeight(grid)).toBeCloseTo(height, 5);
    expect(meanChannel(grid.outer, ring, grid.segments)).toBeCloseTo(outer, 4);
  });

  it('softens a saturated wall so it squats and slumps sooner', () => {
    const grid = wall();
    grid.moisture.fill(1);
    const height = pieceHeight(grid);
    run(water, grid, grid.y[20], 24);
    expect(grid.stress).toBeGreaterThan(12);
    expect(pieceHeight(grid)).toBeLessThan(height * 0.97);
    const event = evaluateIntegrity(grid, stoneware, 0.016);
    expect(event.slumped).toBe(true);
    expect(grid.failure).toBe('slumped');

    const dry = wall();
    dry.moisture.fill(1);
    expect(evaluateIntegrity(dry, stoneware, 0.016).slumped).toBe(false);
  });
});

describe('needle', () => {
  it('cuts a ring off an uneven rim and levels the lip', () => {
    const grid = wall();
    const top = grid.rings - 1;
    for (let s = 0; s < grid.segments; s++) {
      const wave = 0.004 * Math.sin((s / grid.segments) * Math.PI * 2 * 3);
      grid.outer[clayIndex(top, s, grid.segments)] += wave;
      grid.outer[clayIndex(top - 1, s, grid.segments)] += wave * 0.65;
    }
    const uneven = radialStdDev(grid, top);
    const height = pieceHeight(grid);
    const before = volume(grid);
    expect(uneven).toBeGreaterThan(0.001);
    run(needle, grid, grid.y[top] - 0.001, 24, { omega: 16 });
    expect(radialStdDev(grid, top)).toBeLessThan(uneven * 0.25);
    expect(pieceHeight(grid)).toBeLessThan(height - 0.002);
    expect(pieceHeight(grid)).toBeGreaterThan(height - 0.02);
    expect(volume(grid)).toBeLessThan(before * 0.99);
    expect(grid.moisture[top]).toBeLessThan(0.95);
  });

  it('cuts an asymmetric mark and leaves the far side and the height alone', () => {
    const grid = wall();
    const ring = 16;
    const segment = 4;
    const far = segment + grid.segments / 2;
    const touched = grid.outer[clayIndex(ring, segment, grid.segments)];
    const other = grid.outer[clayIndex(ring, far, grid.segments)];
    const height = pieceHeight(grid);
    run(needle, grid, grid.y[ring], 24, { omega: 0, segment });
    expect(grid.outer[clayIndex(ring, segment, grid.segments)]).toBeLessThan(touched - 0.003);
    expect(grid.outer[clayIndex(ring, far, grid.segments)]).toBeCloseTo(other, 4);
    expect(pieceHeight(grid)).toBeCloseTo(height, 4);
    expect(grid.moisture[ring]).toBeLessThan(0.95);
  });
});

describe('wooden knife', () => {
  it('bevels the foot, undercuts above the bat, and discards that clay', () => {
    const grid = wall();
    const before = volume(grid);
    const mid = Math.floor(grid.rings * 0.55);
    const midOuter = meanChannel(grid.outer, mid, grid.segments);
    run(knife, grid, 0.004, 32, { omega: 14 });
    const footRings = Math.floor(grid.rings * 0.2);
    let minOuter = Infinity;
    let minAt = 0;
    for (let r = 0; r <= footRings; r++) {
      const mean = meanChannel(grid.outer, r, grid.segments);
      if (mean < minOuter) {
        minOuter = mean;
        minAt = r;
      }
    }
    expect(minAt).toBeGreaterThan(0);
    expect(minOuter).toBeLessThan(0.045);
    expect(meanChannel(grid.outer, 0, grid.segments)).toBeLessThan(0.049);
    expect(meanChannel(grid.outer, 0, grid.segments)).toBeGreaterThan(minOuter + 0.0008);
    expect(meanChannel(grid.outer, mid, grid.segments)).toBeCloseTo(midOuter, 4);
    expect(volume(grid)).toBeLessThan(before * 0.99);
    expect(grid.moisture[minAt]).toBeLessThan(0.9);
    expect(grid.moisture[mid]).toBeCloseTo(1, 5);
  });

  it('does not carve the belly when the knife is held up on the wall', () => {
    const grid = wall();
    const ring = 22;
    const outer = grid.outer[clayIndex(ring, 0, grid.segments)];
    run(knife, grid, grid.y[ring], 20, { omega: 14 });
    expect(grid.outer[clayIndex(ring, 0, grid.segments)]).toBe(outer);
    expect(meanChannel(grid.outer, 1, grid.segments)).toBeCloseTo(0.05, 4);
  });
});
