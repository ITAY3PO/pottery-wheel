import type { ClayType } from './clays';
import { minWallThickness } from './clays';
import {
  meanChannel,
  meanMoisture,
  pieceHeight,
  sanitizeGrid,
  scaleGaps,
  scaleRadii,
  touchGrid,
  volume,
} from './grid';
import type { ClayGrid } from '../core/types';

export interface IntegrityEvent {
  tore: boolean;
  slumped: boolean;
}

/**
 * Tear walls that are thinner than the clay can hold, and slump forms that
 * stay too wet and too tall. Call once per frame with the frame dt.
 */
export function evaluateIntegrity(grid: ClayGrid, clay: ClayType, dt: number): IntegrityEvent {
  const minW = minWallThickness(clay);
  const tearAt = minW * 0.82;
  let tore = false;
  const foot = Math.floor(grid.rings * 0.08);

  for (let r = foot; r < grid.rings; r++) {
    const base = r * grid.segments;
    for (let s = 0; s < grid.segments; s++) {
      const i = base + s;
      if (grid.torn[i]) continue;
      const inner = grid.inner[i];
      if (inner < 0.003) continue;
      if (grid.outer[i] - inner < tearAt) {
        grid.torn[i] = 1;
        grid.outer[i] = inner;
        tore = true;
      }
    }
  }

  const moisture = meanMoisture(grid);
  const height = pieceHeight(grid);
  const thickness = representativeThickness(grid);
  const ratio = height / Math.max(thickness, 0.0008);
  const strength = 22 + clay.plasticity * 40;
  const limit = strength / (0.45 + Math.max(moisture, 0));
  const step = Math.max(0, dt);

  if (moisture > 0.7 && ratio > limit) {
    const overload = ratio / limit;
    grid.stress += step * overload * overload;
  } else if (moisture > 0.82 && ratio > limit * 0.78) {
    grid.stress += step * 0.32;
  } else {
    grid.stress = Math.max(0, grid.stress - step * 0.4);
  }

  let slumped = false;
  if (grid.stress > 12 && moisture > 0.68) {
    applySlump(grid);
    grid.stress = 2;
    slumped = true;
  }

  if (tore) grid.failure = grid.failure === 'slumped' ? 'slumped' : 'torn';
  if (slumped) grid.failure = 'slumped';
  if (tore || slumped) touchGrid(grid);
  return { tore, slumped };
}

function representativeThickness(grid: ClayGrid): number {
  const r0 = Math.floor(grid.rings * 0.35);
  const r1 = Math.floor(grid.rings * 0.8);
  let thick = 0;
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    const outer = meanChannel(grid.outer, r, grid.segments);
    const inner = meanChannel(grid.inner, r, grid.segments);
    thick += inner > 0.002 ? outer - inner : outer * 0.55;
    n++;
  }
  return n === 0 ? 0.01 : thick / n;
}

function applySlump(grid: ClayGrid): void {
  const target = volume(grid);
  const n = grid.rings;
  for (let r = 0; r < n; r++) {
    const t = r / (n - 1);
    const belly = Math.exp(-((t - 0.42) ** 2) / 0.018);
    const k = 1 + 0.14 * belly;
    const base = r * grid.segments;
    for (let s = 0; s < grid.segments; s++) {
      const i = base + s;
      grid.outer[i] *= k;
      if (grid.inner[i] > 0.001) grid.inner[i] *= 1 + 0.1 * belly;
    }
  }
  scaleGaps(grid, 0, 0.84);
  sanitizeGrid(grid);
  const now = volume(grid);
  if (now > 1e-12) scaleRadii(grid, Math.sqrt(target / now));
  sanitizeGrid(grid);
}

/** Test helper: how many samples have torn. */
export function tornCount(grid: ClayGrid): number {
  let n = 0;
  for (let i = 0; i < grid.torn.length; i++) if (grid.torn[i]) n++;
  return n;
}
