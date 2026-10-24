import {
  clayIndex,
  meanChannel,
  sanitizeGrid,
  scaleRadii,
  touchGrid,
  volume,
} from '../clay/grid';
import { remountOnWheel, unmountFromWheel } from '../core/stateMachine';
import type { ClayGrid, PieceState } from '../core/types';

/**
 * Trimming turns the pot base-up. The pose lives in `grid.stress`, which wet
 * throwing only uses when it is >= 0, and which drying zeroes. A mid-trim
 * save therefore reloads still upside down.
 * -1 is base-up and loose. -2 has been tapped down onto the bat.
 */
const LOOSE = -1;
const SEATED = -2;

/** A ring counts as opened once its mean inner radius passes this (meters). */
export const TRIM_HOLLOW = 0.0016;

const biteDepth = new WeakMap<ClayGrid, number>();

export function isBaseUp(grid: ClayGrid): boolean {
  return grid.stress < 0;
}

export function isSeated(grid: ClayGrid): boolean {
  return grid.stress <= -1.5;
}

export function isHollowRing(grid: ClayGrid, ring: number): boolean {
  return meanChannel(grid.inner, ring, grid.segments) >= TRIM_HOLLOW;
}

export function trimBite(grid: ClayGrid): number {
  return biteDepth.get(grid) ?? 0;
}

export function setTrimBite(grid: ClayGrid, depth: number): void {
  biteDepth.set(grid, depth);
}

export function forgetTrimBite(grid: ClayGrid): void {
  biteDepth.delete(grid);
}

export function seatOnBat(grid: ClayGrid): void {
  grid.stress = SEATED;
  touchGrid(grid);
}

/** Remount leather-hard clay with the base up, a little off center. */
export function mountBaseUp(piece: PieceState): boolean {
  if (!remountOnWheel(piece)) return false;
  if (isBaseUp(piece.grid)) return true;
  flipGrid(piece.grid);
  const mid = Math.floor(piece.grid.rings * 0.5);
  const radius = meanChannel(piece.grid.outer, mid, piece.grid.segments);
  shiftOffCenter(piece.grid, Math.min(0.006, Math.max(0.0025, radius * 0.09)));
  piece.grid.stress = LOOSE;
  piece.updatedAt = Date.now();
  return true;
}

/** Flip the base back down and take the piece off the wheel. */
export function unmountUpright(piece: PieceState): void {
  forgetTrimBite(piece.grid);
  if (isBaseUp(piece.grid)) {
    flipGrid(piece.grid);
    piece.grid.stress = 0;
  }
  unmountFromWheel(piece);
}

/**
 * Reverse the rings so the end that sat on the bat is now the top.
 * Doing it twice restores the grid. Frozen profile arcs travel with the clay.
 */
export function flipGrid(grid: ClayGrid): void {
  const rings = grid.rings;
  const segments = grid.segments;
  const y0 = grid.y[0];
  const yTop = grid.y[rings - 1];
  const oldY = grid.y.slice();
  for (let r = 0; r < rings; r++) {
    grid.y[r] = y0 + (yTop - oldY[rings - 1 - r]);
  }
  reverseRings(grid.outer, rings, segments);
  reverseRings(grid.inner, rings, segments);
  reverseRingsU8(grid.torn, rings, segments);
  const moisture = grid.moisture.slice();
  for (let r = 0; r < rings; r++) grid.moisture[r] = moisture[rings - 1 - r];
  if (grid.arcOuter && grid.arcOuter.length === rings) reverseValues(grid.arcOuter);
  if (grid.arcInner && grid.arcInner.length === rings) reverseValues(grid.arcInner);
  grid.revision++;
}

/** The base and the interior are one opening — the loop went through. */
export function baseIsPierced(grid: ClayGrid): boolean {
  let solid = 0;
  let hollow = 0;
  for (let r = 0; r < grid.rings; r++) {
    if (isHollowRing(grid, r)) hollow++;
    else solid++;
  }
  return hollow > 0 && solid === 0;
}

export function trimStatus(piece: PieceState): string {
  if (baseIsPierced(piece.grid)) return 'The loop cut through the base.';
  if (!isBaseUp(piece.grid)) return 'Turn it base-up on the wheel, then center and tap it down.';
  if (!isSeated(piece.grid)) return 'Base up. Center it until it runs true, then tap it down onto the bat.';
  return 'Trim the foot with a round loop, square loop, or ribbon. Too deep cuts through.';
}

function reverseRings(data: Float32Array, rings: number, segments: number): void {
  const copy = data.slice();
  for (let r = 0; r < rings; r++) {
    const from = (rings - 1 - r) * segments;
    data.set(copy.subarray(from, from + segments), r * segments);
  }
}

function reverseRingsU8(data: Uint8Array, rings: number, segments: number): void {
  const copy = data.slice();
  for (let r = 0; r < rings; r++) {
    const from = (rings - 1 - r) * segments;
    data.set(copy.subarray(from, from + segments), r * segments);
  }
}

function reverseValues(data: Float32Array): void {
  const copy = data.slice();
  for (let i = 0; i < data.length; i++) data[i] = copy[data.length - 1 - i];
}

function shiftOffCenter(grid: ClayGrid, shift: number): void {
  const before = volume(grid);
  const segments = grid.segments;
  for (let r = 0; r < grid.rings; r++) {
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const i = clayIndex(r, s, segments);
      grid.outer[i] = shiftedRadius(grid.outer[i], shift, theta);
      if (grid.inner[i] > 0.0001) grid.inner[i] = shiftedRadius(grid.inner[i], shift, theta);
    }
  }
  sanitizeGrid(grid);
  const now = volume(grid);
  if (now > 1e-12 && before > 1e-12) scaleRadii(grid, Math.sqrt(before / now));
  touchGrid(grid);
}

/** Radius from the wheel axis after a circle's center moves by `shift`. */
function shiftedRadius(radius: number, shift: number, theta: number): number {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const disc = radius * radius - shift * shift * s * s;
  if (disc <= 0) return Math.max(0.001, radius);
  return Math.max(0.001, shift * c + Math.sqrt(disc));
}
