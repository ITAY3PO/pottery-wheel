import { clayIndex, clamp, pieceHeight, ringAtHeight, sanitizeGrid, touchGrid, wrapIndex } from '../clay/grid';
import type { ClayGrid, Tool, ToolContext } from '../core/types';

const SPIN = 2.2;

function frameDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, 0.05);
}

function falloff(ring: number, center: number, band: number): number {
  const d = Math.abs(ring - center) / (band + 0.25);
  if (d >= 1) return 0;
  return Math.cos(d * Math.PI * 0.5);
}

/** Spinning needle at the lip: the high spots meet the point and a ring comes off. */
function trimRim(grid: ClayGrid, pressure: number, dt: number): void {
  const height = pieceHeight(grid);
  if (height < 0.025) return;
  const top = grid.rings - 1;
  const rim = Math.max(1, top - Math.max(2, Math.round(grid.rings * 0.05)));
  const available = grid.y[top] - grid.y[rim];
  if (available < 0.0015) return;

  const shave = Math.min(available * 0.65, 0.00022 + pressure * dt * 0.018);
  const factor = clamp((available - shave) / available, 0.4, 1);
  let y = grid.y[rim];
  for (let r = rim; r < top; r++) {
    const gap = grid.y[r + 1] - grid.y[r];
    y += Math.max(0.00035, gap * factor);
    grid.y[r + 1] = y;
  }

  let lip = Infinity;
  const base = top * grid.segments;
  for (let s = 0; s < grid.segments; s++) lip = Math.min(lip, grid.outer[base + s]);
  for (let r = rim; r <= top; r++) {
    const blend = (r - rim) / Math.max(1, top - rim);
    for (let s = 0; s < grid.segments; s++) {
      const i = clayIndex(r, s, grid.segments);
      if (grid.outer[i] > lip) grid.outer[i] += (lip - grid.outer[i]) * blend;
    }
    grid.moisture[r] = clamp(grid.moisture[r] - 0.35 * pressure * dt, 0.3, 1);
  }
  sanitizeGrid(grid);
  touchGrid(grid);
}

/** A needle point. The mark stays on the segments under the tool, even while the wheel turns. */
function cutMark(grid: ClayGrid, height: number, segment: number, pressure: number, dt: number): void {
  const ring = ringAtHeight(grid, height);
  const band = Math.max(1, Math.round(grid.rings * 0.018));
  const depth = Math.min(0.0015, 0.00007 + pressure * dt * 0.011);
  const offsets: readonly (readonly [number, number])[] = [
    [0, 1],
    [-1, 0.42],
    [1, 0.42],
  ];
  for (let r = ring - band; r <= ring + band; r++) {
    if (r <= 0 || r >= grid.rings - 1) continue;
    const fall = falloff(r, ring, band);
    if (fall <= 0) continue;
    for (const [offset, weight] of offsets) {
      const seg = wrapIndex(segment + offset, grid.segments);
      const i = clayIndex(r, seg, grid.segments);
      const inner = grid.inner[i];
      grid.outer[i] = Math.max(inner + 0.0016, grid.outer[i] - depth * fall * weight);
    }
  }
  if (ring >= 0 && ring < grid.rings) {
    grid.moisture[ring] = clamp(grid.moisture[ring] - 0.35 * pressure * dt, 0.3, 1);
  }
  sanitizeGrid(grid);
  touchGrid(grid);
}

function apply(ctx: ToolContext): void {
  const pressure = clamp(ctx.pointer.pressure, 0, 1);
  const grid = ctx.piece.grid;
  const top = grid.y[grid.rings - 1];
  const nearRim = ctx.pointer.height >= top - Math.max(0.008, pieceHeight(grid) * 0.08);
  const trimming = nearRim && Math.abs(ctx.wheel.omega) >= SPIN;
  ctx.wheel.addDrag(pressure * (trimming ? 0.36 : 0.2));
  const dt = frameDt(ctx.dt);
  if (pressure <= 0.04 || dt <= 0) return;
  if (trimming) trimRim(grid, pressure, dt);
  else cutMark(grid, ctx.pointer.height, ctx.pointer.segment, pressure, dt);
}

/** Needle tool. Levels an uneven rim while spinning, and cuts a one-sided mark anywhere else. */
export const tool: Tool = {
  id: 'needle',
  name: 'Needle tool',
  label: 'Needle',
  order: 56,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'At speed, hold the needle on the rim to cut a ring off. Off the rim it nicks one side.',
  haptics: { down: [4, 18, 8], move: 9, moveIntervalMs: 85 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
