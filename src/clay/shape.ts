import type { ClayType } from './clays';
import { minWallThickness } from './clays';
import {
  clayIndex,
  clamp,
  conserveByHeight,
  conserveByRadius,
  eachContacted,
  meanChannel,
  pieceHeight,
  ringAtHeight,
  sanitizeGrid,
  smoothVertical,
  touchGrid,
  volume,
} from './grid';
import type { ClayGrid } from '../core/types';

export interface Stroke {
  pressure: number;
  omega: number;
  segment: number;
  dt: number;
}

function spinAmount(omega: number): number {
  return clamp(Math.abs(omega) / 8, 0, 1);
}

/** Above this, the hand has been around the pot enough that the stroke is round. */
function spinning(stroke: Stroke): boolean {
  return Math.abs(stroke.omega) >= 2.2;
}

/** Spinning strokes hit the whole ring. A still finger only hits a thumb-sized arc. */
function withHand(grid: ClayGrid, stroke: Stroke, fn: (segment: number, weight: number) => void): void {
  if (spinning(stroke)) {
    for (let segment = 0; segment < grid.segments; segment++) fn(segment, 1);
    return;
  }
  eachContacted(grid.segments, stroke.segment, 0, stroke.dt, fn);
}

function framePush(stroke: Stroke, handSpeed: number): number {
  if (stroke.pressure <= 0.01) return 0;
  const cover = spinning(stroke) ? 0.72 : 1;
  return handSpeed * stroke.pressure * cover * stroke.dt;
}

function frameBlend(stroke: Stroke, ratePerSecond: number): number {
  if (stroke.pressure <= 0.01) return 0;
  const rate = spinning(stroke) ? ratePerSecond : ratePerSecond * 0.35;
  return clamp(1 - Math.exp(-rate * stroke.dt * Math.max(0.2, stroke.pressure)), 0, 0.65);
}

function falloffAt(ring: number, center: number, band: number): number {
  const d = Math.abs(ring - center) / (band + 0.25);
  if (d >= 1) return 0;
  return Math.cos(d * Math.PI * 0.5);
}

/**
 * Press the lump toward round. Spinning spreads the hand around the ring;
 * a still finger only moves the clay it is actually touching.
 * Inward pressure pushes volume up.
 */
export function centerClay(grid: ClayGrid, height: number, stroke: Stroke, clay: ClayType): void {
  const target = volume(grid);
  const ring = ringAtHeight(grid, height);
  // A spinning hand has been all the way around, and centering is a whole-lump
  // gesture: every ring trends round, strongest under the fingers.
  const round = spinning(stroke);
  const band = round ? grid.rings : Math.max(3, Math.round(grid.rings * 0.07));
  const minW = minWallThickness(clay);
  const blend = frameBlend(stroke, round ? 4.4 : 3.1);
  const inward = framePush(stroke, round ? 0.016 : 0.02);
  if (blend <= 0 && inward <= 0) return;

  const influence = round ? Math.max(6, Math.round(grid.rings * 0.22)) : band;
  for (let r = ring - band; r <= ring + band; r++) {
    if (r < 0 || r >= grid.rings) continue;
    const shaped = falloffAt(r, ring, influence);
    const fall = round ? 0.62 + 0.38 * shaped : shaped;
    if (fall <= 0) continue;
    const mean = meanChannel(grid.outer, r, grid.segments);
    const meanInner = meanChannel(grid.inner, r, grid.segments);
    const goal = Math.max(minW + meanInner, mean - inward * fall);
    withHand(grid, stroke, (segment, weight) => {
      const i = clayIndex(r, segment, grid.segments);
      const t = blend * fall * weight;
      grid.outer[i] += (goal - grid.outer[i]) * t;
      if (grid.inner[i] > 0.0015) {
        grid.inner[i] += (meanInner - grid.inner[i]) * t;
      }
    });
  }
  smoothVertical(grid.outer, grid.rings, grid.segments, Math.max(0, ring - band), Math.min(grid.rings - 1, ring + band), 0.12);
  sanitizeGrid(grid);
  conserveByHeight(grid, Math.max(0, ring - band), target);
  touchGrid(grid);
}

/** Collar inward. Hollow walls move in together and the piece grows taller. */
export function pressIn(grid: ClayGrid, height: number, stroke: Stroke, clay: ClayType): void {
  const target = volume(grid);
  const ring = ringAtHeight(grid, height);
  const band = Math.max(3, Math.round(grid.rings * 0.055));
  const minW = minWallThickness(clay) * 0.78;
  const disp = framePush(stroke, 0.045);
  if (disp <= 0) return;

  for (let r = ring - band; r <= ring + band; r++) {
    if (r < 0 || r >= grid.rings) continue;
    const fall = falloffAt(r, ring, band);
    if (fall <= 0) continue;
    withHand(grid, stroke, (segment, weight) => {
      const i = clayIndex(r, segment, grid.segments);
      const delta = disp * fall * weight;
      const inner = grid.inner[i];
      grid.outer[i] = Math.max(inner + minW, grid.outer[i] - delta);
      if (inner > 0.002) grid.inner[i] = Math.max(0, inner - delta * 0.84);
    });
  }
  smoothVertical(grid.outer, grid.rings, grid.segments, ring - band, ring + band, 0.16);
  sanitizeGrid(grid);
  conserveByHeight(grid, Math.max(0, ring - band), target);
  touchGrid(grid);
}

/**
 * Open a well. `openingRadius` is the finger's distance from the axis.
 * Rings above the finger become hollow; displaced clay moves into the wall.
 */
export function openCenter(
  grid: ClayGrid,
  fingerHeight: number,
  openingRadius: number,
  stroke: Stroke,
  clay: ClayType,
): void {
  const target = volume(grid);
  const totalH = Math.max(0.01, pieceHeight(grid));
  const floorY = grid.y[0] + Math.max(0.007, totalH * 0.13);
  const floor = Math.max(fingerHeight, floorY);
  const top = grid.y[grid.rings - 1];
  if (floor >= top - 0.002) return;

  const midRing = ringAtHeight(grid, (floor + top) * 0.5);
  const meanOuter = Math.max(0.01, meanChannel(grid.outer, midRing, grid.segments));
  const desired = clamp(Math.max(openingRadius, 0.012 * stroke.pressure), 0.008, meanOuter * 0.86);
  const blend = frameBlend(stroke, 3.4);
  if (blend <= 0) return;
  const minW = minWallThickness(clay) * 0.7;

  for (let r = 0; r < grid.rings; r++) {
    if (grid.y[r] < floor) continue;
    const taper = clamp((grid.y[r] - floor) / 0.012, 0, 1);
    const local = desired * (0.35 + 0.65 * taper);
    withHand(grid, stroke, (segment, weight) => {
      const i = clayIndex(r, segment, grid.segments);
      const outer = grid.outer[i];
      const inner = grid.inner[i];
      const area = Math.max(outer * outer - inner * inner, minW * minW);
      const goal = Math.min(local, Math.max(0, outer - minW));
      const nextInner = inner + (goal - inner) * blend * weight;
      const nextOuter = Math.sqrt(nextInner * nextInner + area);
      grid.inner[i] = nextInner;
      grid.outer[i] = Math.max(nextOuter, nextInner + minW * 0.35);
    });
  }
  smoothOpenInner(grid, floor);
  sanitizeGrid(grid);
  const now = volume(grid);
  if (now > 1e-12 && Math.abs(now - target) / target > 0.006) {
    conserveByRadius(grid, target);
  }
  touchGrid(grid);
}

function smoothOpenInner(grid: ClayGrid, floor: number): void {
  const segs = grid.segments;
  const next = new Float32Array(grid.inner);
  for (let r = 1; r < grid.rings - 1; r++) {
    if (grid.y[r] < floor) continue;
    for (let s = 0; s < segs; s++) {
      const i = clayIndex(r, s, segs);
      const a = grid.inner[clayIndex(r - 1, s, segs)];
      const c = grid.inner[clayIndex(r + 1, s, segs)];
      if (a < 0.001 || c < 0.001) continue;
      next[i] = grid.inner[i] + ((a + c) * 0.5 - grid.inner[i]) * 0.22;
    }
  }
  grid.inner.set(next);
}

/**
 * Pull walls up. A spinning pull stretches height and thins the wall,
 * keeping its midline. A still finger leaves a local thin spot.
 */
export function pullUp(
  grid: ClayGrid,
  height: number,
  dragUp: number,
  stroke: Stroke,
  clay: ClayType,
): void {
  if (dragUp <= 0.00002 || stroke.pressure <= 0.02) return;
  const target = volume(grid);
  const ring = ringAtHeight(grid, height);
  const spin = spinAmount(stroke.omega);
  const grow = dragUp * (0.22 + 0.98 * spin) * (0.4 + 0.75 * stroke.pressure);
  const anchor = Math.max(1, ring - 4);
  addHeight(grid, anchor, grow);

  if (spin > 0.35) {
    thinToVolume(grid, anchor, target, minWallThickness(clay) * 0.62);
  } else {
    const band = Math.max(2, Math.round(grid.rings * 0.035));
    const shave = dragUp * (0.35 + stroke.pressure) * 0.55;
    for (let r = ring - band; r <= ring + 1; r++) {
      if (r < 0 || r >= grid.rings) continue;
      const fall = falloffAt(r, ring, band);
      withHand(grid, stroke, (segment, weight) => {
        const i = clayIndex(r, segment, grid.segments);
        const inner = grid.inner[i];
        const outer = grid.outer[i];
        if (inner < 0.0015) {
          grid.outer[i] = Math.max(0.004, outer - shave * fall * weight);
        } else {
          const mid = (outer + inner) * 0.5;
          const thick = Math.max(0.0004, outer - inner - shave * fall * weight);
          grid.outer[i] = mid + thick * 0.5;
          grid.inner[i] = Math.max(0, mid - thick * 0.5);
        }
      });
    }
    sanitizeGrid(grid);
    conserveByHeight(grid, anchor, target);
  }
  smoothVertical(grid.outer, grid.rings, grid.segments, anchor, grid.rings - 1, 0.1);
  sanitizeGrid(grid);
  const pulled = volume(grid);
  if (pulled > 0 && Math.abs(pulled - target) / target > 0.008) conserveByRadius(grid, target);
  touchGrid(grid);
}

/** Shorten and thicken. Drag down is in meters for this frame. */
export function compressClay(
  grid: ClayGrid,
  height: number,
  dragDown: number,
  stroke: Stroke,
  clay: ClayType,
): void {
  if (dragDown <= 0.00002 || stroke.pressure <= 0.02) return;
  const target = volume(grid);
  const ring = ringAtHeight(grid, Math.max(height, grid.y[0] + pieceHeight(grid) * 0.45));
  const spin = spinAmount(stroke.omega);
  const available = grid.y[grid.rings - 1] - grid.y[ring];
  if (available < 0.008) return;
  const remove = Math.min(available * 0.42, dragDown * (0.35 + 0.9 * spin) * (0.45 + 0.7 * stroke.pressure));
  const factor = clamp((available - remove) / available, 0.58, 1);
  const gaps: number[] = [];
  for (let r = ring; r < grid.rings - 1; r++) gaps.push(grid.y[r + 1] - grid.y[r]);
  let y = grid.y[ring];
  for (let i = 0; i < gaps.length; i++) {
    y += Math.max(0.00035, gaps[i] * factor);
    grid.y[ring + 1 + i] = y;
  }
  thickenToVolume(grid, ring, target, minWallThickness(clay));
  smoothVertical(grid.outer, grid.rings, grid.segments, ring, grid.rings - 1, 0.12);
  sanitizeGrid(grid);
  const compressed = volume(grid);
  if (compressed > 0 && Math.abs(compressed - target) / target > 0.008) conserveByRadius(grid, target);
  touchGrid(grid);
}

function addHeight(grid: ClayGrid, anchor: number, extra: number): void {
  if (extra <= 0) return;
  const gaps: number[] = [];
  let span = 0;
  for (let r = anchor; r < grid.rings - 1; r++) {
    const gap = grid.y[r + 1] - grid.y[r];
    gaps.push(gap);
    span += gap;
  }
  if (span <= 0) return;
  let y = grid.y[anchor];
  for (let i = 0; i < gaps.length; i++) {
    y += gaps[i] + extra * (gaps[i] / span);
    grid.y[anchor + 1 + i] = y;
  }
}

function thinToVolume(grid: ClayGrid, anchor: number, target: number, minThick: number): void {
  const outer0 = grid.outer.slice();
  const inner0 = grid.inner.slice();
  const apply = (factor: number) => {
    for (let r = anchor; r < grid.rings; r++) {
      const base = r * grid.segments;
      for (let s = 0; s < grid.segments; s++) {
        const o = outer0[base + s];
        const inner = inner0[base + s];
        if (inner < 0.0015) {
          grid.outer[base + s] = Math.max(0.004, o * Math.sqrt(Math.max(factor, 0.05)));
          grid.inner[base + s] = 0;
        } else {
          const mid = (o + inner) * 0.5;
          const thick = Math.max(minThick, (o - inner) * factor);
          grid.outer[base + s] = mid + thick * 0.5;
          grid.inner[base + s] = Math.max(0, mid - thick * 0.5);
        }
      }
    }
  };
  let lo = 0.12;
  let hi = 1.15;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) * 0.5;
    apply(mid);
    if (volume(grid) > target) hi = mid;
    else lo = mid;
  }
  apply((lo + hi) * 0.5);
  sanitizeGrid(grid);
}

function thickenToVolume(grid: ClayGrid, anchor: number, target: number, minThick: number): void {
  const outer0 = grid.outer.slice();
  const inner0 = grid.inner.slice();
  const apply = (factor: number) => {
    for (let r = anchor; r < grid.rings; r++) {
      const base = r * grid.segments;
      for (let s = 0; s < grid.segments; s++) {
        const o = outer0[base + s];
        const inner = inner0[base + s];
        if (inner < 0.0015) {
          grid.outer[base + s] = o * Math.sqrt(Math.max(factor, 0.2));
          grid.inner[base + s] = 0;
        } else {
          const mid = (o + inner) * 0.5;
          const thick = Math.max(minThick * 0.5, (o - inner) * factor);
          let outer = mid + thick * 0.5;
          let nextInner = mid - thick * 0.5;
          if (nextInner < 0) {
            outer += -nextInner;
            nextInner = 0;
          }
          grid.outer[base + s] = outer;
          grid.inner[base + s] = nextInner;
        }
      }
    }
  };
  let lo = 0.7;
  let hi = 2.4;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) * 0.5;
    apply(mid);
    if (volume(grid) < target) lo = mid;
    else hi = mid;
  }
  apply((lo + hi) * 0.5);
  sanitizeGrid(grid);
}
