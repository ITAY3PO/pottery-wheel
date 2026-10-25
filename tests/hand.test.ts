import { beforeEach, describe, expect, it } from 'vitest';
import { getClay } from '../src/clay/clays';
import { clayIndex, createCylinderGrid, meanChannel, pieceHeight, volume } from '../src/clay/grid';
import {
  contactFootprint,
  currentHand,
  DEFAULT_HAND,
  handContact,
  handFalloff,
  resetHandForTests,
  setHandMode,
  toolUsesHand,
  type HandMode,
} from '../src/clay/hand';
import { pressIn, pullUp, type Stroke } from '../src/clay/shape';
import type { ClayGrid, PieceState, ToolContext, ToolPointer } from '../src/core/types';
import { Wheel } from '../src/core/wheel';
import { events } from '../src/core/events';
import { tool as rib } from '../src/tools/rib';

const stoneware = getClay('stoneware');

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function fresh(): ClayGrid {
  return createCylinderGrid({ radius: 0.055, height: 0.09, rings: 64, segments: 36 });
}

function stroke(hand: HandMode | undefined, pressure = 0.9, omega = 16): Stroke {
  return { pressure, omega, segment: 4, dt: 1 / 60, hand };
}

function means(grid: ClayGrid): Float32Array {
  const out = new Float32Array(grid.rings);
  for (let r = 0; r < grid.rings; r++) out[r] = meanChannel(grid.outer, r, grid.segments);
  return out;
}

function press(hand: HandMode, frames: number, pressure = 0.9, omega = 16): { grid: ClayGrid; before: Float32Array; y: Float32Array } {
  const grid = fresh();
  const before = means(grid);
  const y = grid.y.slice();
  const height = pieceHeight(grid) * 0.55;
  const sample = stroke(hand, pressure, omega);
  for (let i = 0; i < frames; i++) pressIn(grid, height, sample, stoneware);
  return { grid, before, y };
}

interface Dent {
  peak: number;
  width: number;
  moved: number;
  slope: number;
}

function dentOf(before: Float32Array, y: Float32Array, grid: ClayGrid): Dent {
  const after = means(grid);
  let peak = 0;
  let peakRing = 0;
  const dent = new Float32Array(grid.rings);
  for (let r = 0; r < grid.rings; r++) {
    dent[r] = before[r] - after[r];
    if (dent[r] > peak) {
      peak = dent[r];
      peakRing = r;
    }
  }
  const thresh = Math.max(peak * 0.2, 0.00004);
  let lo = peakRing;
  let hi = peakRing;
  for (let r = peakRing; r >= 0; r--) {
    if (dent[r] >= thresh) lo = r;
    else break;
  }
  for (let r = peakRing; r < grid.rings; r++) {
    if (dent[r] >= thresh) hi = r;
    else break;
  }
  const width = y[Math.min(hi, y.length - 1)] - y[lo];
  let moved = 0;
  let slope = 0;
  for (let r = 0; r < grid.rings - 1; r++) {
    const dh = Math.max(1e-6, y[r + 1] - y[r]);
    moved += Math.max(0, dent[r]) * dh;
    slope = Math.max(slope, Math.abs(dent[r + 1] - dent[r]) / dh);
  }
  return { peak, width, moved, slope };
}

function touchedSegments(hand: HandMode): number {
  const grid = fresh();
  const ring = Math.round(grid.rings * 0.55);
  const before = grid.outer.slice();
  pressIn(grid, grid.y[ring], stroke(hand, 1, 0), stoneware);
  const dents: number[] = [];
  for (let s = 0; s < grid.segments; s++) {
    const i = clayIndex(ring, s, grid.segments);
    dents.push(before[i] - grid.outer[i]);
  }
  const sorted = dents.slice().sort((a, b) => a - b);
  const background = sorted[Math.floor(sorted.length / 2)] ?? 0;
  let peak = 0;
  for (const dent of dents) peak = Math.max(peak, dent - background);
  if (peak <= 0.00005) return 0;
  let count = 0;
  for (const dent of dents) if (dent - background > peak * 0.25) count += 1;
  return count;
}

describe('hand profiles', () => {
  beforeEach(() => {
    resetHandForTests(memory());
  });

  it('defaults to the palm and remembers a choice', () => {
    expect(DEFAULT_HAND).toBe('palm');
    expect(currentHand()).toBe('palm');
    setHandMode('knuckle');
    expect(currentHand()).toBe('knuckle');
    resetHandForTests(memory());
    const store = memory();
    resetHandForTests(store);
    setHandMode('fingertip');
    resetHandForTests(store);
    expect(currentHand()).toBe('fingertip');
    setHandMode('palm');
    expect(currentHand()).toBe('palm');
  });

  it('keeps a sharp, a smooth, and a firm falloff', () => {
    const sharp = handFalloff('sharp', 0.45);
    const firm = handFalloff('firm', 0.45);
    const smooth = handFalloff('smooth', 0.45);
    expect(sharp).toBeLessThan(firm);
    expect(firm).toBeGreaterThan(smooth);
    expect(handFalloff('smooth', 0)).toBe(1);
    expect(handFalloff('sharp', 1)).toBe(0);
    expect(handFalloff('firm', 0.2)).toBeGreaterThan(0.9);
    expect(handFalloff('smooth', 0.85)).toBeLessThan(handFalloff('firm', 0.85));
  });

  it('sizes the touch mark with the hand', () => {
    const finger = contactFootprint('fingertip', 0.8);
    const knuckle = contactFootprint('knuckle', 0.8);
    const palm = contactFootprint('palm', 0.8);
    expect(finger.x).toBeLessThan(knuckle.x);
    expect(knuckle.x).toBeLessThan(palm.x);
    expect(palm.x).toBeGreaterThan(palm.y * 2);
    expect(contactFootprint('fingertip', 0.2).y).toBeLessThan(finger.y);
    expect(toolUsesHand('press')).toBe(true);
    expect(toolUsesHand('pull')).toBe(true);
    expect(toolUsesHand('rib')).toBe(false);
    expect(toolUsesHand('needle')).toBe(false);
    expect(toolUsesHand('knife')).toBe(false);
    expect(toolUsesHand('trim-round')).toBe(false);
    expect(handContact('palm').halfWidth).toBeGreaterThan(handContact('knuckle').halfWidth);
    expect(handContact('knuckle').halfWidth).toBeGreaterThan(handContact('fingertip').halfWidth);
  });
});

describe('hand displacement', () => {
  const frames = 28;

  function shaped(hand: HandMode, pressure = 0.9): Dent {
    const run = press(hand, frames, pressure);
    return dentOf(run.before, run.y, run.grid);
  }

  it('cuts a narrow fingertip groove, a broader knuckle, and a shallow palm', () => {
    const finger = shaped('fingertip');
    const knuckle = shaped('knuckle');
    const palm = shaped('palm');
    expect(finger.peak).toBeGreaterThan(knuckle.peak * 1.2);
    expect(knuckle.peak).toBeGreaterThan(palm.peak * 1.35);
    expect(palm.width).toBeGreaterThan(knuckle.width * 1.35);
    expect(knuckle.width).toBeGreaterThan(finger.width * 1.35);
    expect(palm.peak).toBeGreaterThan(0.0003);
    expect(finger.width).toBeLessThan(0.018);
    expect(palm.width).toBeGreaterThan(0.04);
    expect(palm.slope).toBeLessThan(finger.slope * 0.45);
    // Fingertip moves the least clay, the firm knuckle the most, the palm in between.
    expect(finger.moved).toBeLessThan(palm.moved * 0.85);
    expect(palm.moved).toBeLessThan(knuckle.moved * 0.8);
  });

  it('still scales the groove with pressure', () => {
    const light = shaped('fingertip', 0.35);
    const firm = shaped('fingertip', 1);
    const lightPalm = shaped('palm', 0.35);
    const firmPalm = shaped('palm', 1);
    expect(light.peak).toBeLessThan(firm.peak * 0.7);
    expect(lightPalm.moved).toBeLessThan(firmPalm.moved * 0.75);
    expect(light.peak).toBeGreaterThan(0);
  });

  it('leaves a still fingertip on fewer segments than a palm, without a sharp palm dent', () => {
    const finger = touchedSegments('fingertip');
    const knuckle = touchedSegments('knuckle');
    const palm = touchedSegments('palm');
    expect(finger).toBeGreaterThan(0);
    expect(finger).toBeLessThan(knuckle);
    expect(knuckle).toBeLessThan(palm);
    const local = (hand: HandMode) => {
      const grid = fresh();
      const ring = Math.round(grid.rings * 0.55);
      const segment = 4;
      const index = clayIndex(ring, segment, grid.segments);
      const before = grid.outer[index];
      for (let i = 0; i < 20; i++) pressIn(grid, grid.y[ring], stroke(hand, 1, 0), stoneware);
      return before - grid.outer[index];
    };
    const fingerDent = local('fingertip');
    const palmDent = local('palm');
    expect(fingerDent).toBeGreaterThan(palmDent * 1.7);
    expect(palmDent).toBeGreaterThan(0.0004);
  });

  it('raises more wall with a knuckle than with a fingertip or a palm', () => {
    const raised = (hand: HandMode, drag = 0.0018) => {
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
      let y = height * 0.5;
      const sample = stroke(hand, 0.85, 16);
      for (let i = 0; i < 24; i++) {
        pullUp(grid, y, drag, sample, stoneware);
        y += drag * 0.35;
      }
      return { gain: pieceHeight(grid) - height, volume: volume(grid), before };
    };
    const finger = raised('fingertip');
    const palm = raised('palm');
    const knuckle = raised('knuckle');
    expect(knuckle.gain).toBeGreaterThan(finger.gain * 1.6);
    expect(knuckle.gain).toBeGreaterThan(palm.gain * 1.45);
    expect(palm.gain).toBeGreaterThan(finger.gain);
    expect(Math.abs(knuckle.volume - knuckle.before) / knuckle.before).toBeLessThan(0.03);
    const slow = raised('knuckle', 0.0007);
    const fast = raised('knuckle', 0.0022);
    expect(slow.gain).toBeLessThan(fast.gain * 0.6);
    expect(slow.gain).toBeGreaterThan(0);
  });

  it('does not let the saved hand change a legacy stroke or the rib', () => {
    setHandMode('fingertip');
    const plain = fresh();
    const tagged = fresh();
    const height = pieceHeight(plain) * 0.5;
    const legacy: Stroke = { pressure: 0.9, omega: 16, segment: 0, dt: 1 / 60 };
    for (let i = 0; i < 12; i++) {
      pressIn(plain, height, legacy, stoneware);
      pressIn(tagged, height, legacy, stoneware);
    }
    expect(Array.from(plain.outer)).toEqual(Array.from(tagged.outer));

    const withMode = fresh();
    for (let i = 0; i < 12; i++) pressIn(withMode, height, { ...legacy, hand: 'fingertip' }, stoneware);
    let differed = false;
    for (let i = 0; i < plain.outer.length; i++) {
      if (Math.abs(plain.outer[i] - withMode.outer[i]) > 1e-6) differed = true;
    }
    expect(differed).toBe(true);

    const ribbed = (hand: HandMode) => {
      setHandMode(hand);
      const grid = fresh();
      const piece: PieceState = {
        version: 1,
        id: 'rib',
        clayTypeId: 'stoneware',
        weightKg: 1,
        stage: 'wet',
        onWheel: true,
        grid,
        attachments: [],
        surfaces: [],
        speedSetting: 0.6,
        createdAt: 0,
        updatedAt: 0,
      };
      const pointer: ToolPointer = {
        radius: 0.05,
        height: 0.04,
        pressure: 0.8,
        side: 1,
        segment: 2,
        x: 0.05,
        y: 0.04,
      };
      const wheel = new Wheel();
      wheel.omega = 12;
      const ctx: ToolContext = {
        piece,
        wheel,
        pointer,
        previous: { ...pointer, height: 0.038 },
        dt: 1 / 60,
        screen: { x: 0, y: 0 },
        ndc: { x: 0, y: 0 },
        raycaster: { ray: { direction: { x: 0, y: 0, z: -1 } } } as ToolContext['raycaster'],
        surfaceHit: null,
        markSurfaceDirty() {},
        events,
      };
      for (let i = 0; i < 8; i++) rib.onPointerMove(ctx);
      return Array.from(grid.outer);
    };
    expect(ribbed('fingertip')).toEqual(ribbed('palm'));
  });
});
