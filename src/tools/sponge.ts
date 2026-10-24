import { clamp, ringAtHeight, touchGrid } from '../clay/grid';
import type { Tool, ToolContext } from '../core/types';

function frameDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, 0.05);
}

function apply(ctx: ToolContext): void {
  const pressure = clamp(ctx.pointer.pressure, 0, 1);
  // Soft. A sponge drags less than a rib and much less than a knife.
  ctx.wheel.addDrag(pressure * 0.28);
  const dt = frameDt(ctx.dt);
  if (pressure <= 0.04 || dt <= 0) return;

  const grid = ctx.piece.grid;
  const ring = ringAtHeight(grid, ctx.pointer.height);
  const band = Math.max(2, Math.round(grid.rings * 0.06));
  // Moisture is one value per ring. A stopped sponge only wipes the arc under it.
  const cover = Math.abs(ctx.wheel.omega) >= 2.2 ? 1 : 0.22;
  let changed = false;
  for (let r = ring - band; r <= ring + band; r++) {
    if (r < 0 || r >= grid.rings) continue;
    const d = Math.abs(r - ring) / (band + 0.25);
    if (d >= 1) continue;
    const fall = Math.cos(d * Math.PI * 0.5);
    const next = clamp(grid.moisture[r] - 1.15 * pressure * cover * dt * fall, 0.38, 1);
    if (next !== grid.moisture[r]) {
      grid.moisture[r] = next;
      changed = true;
    }
  }
  if (changed) touchGrid(grid);
}

/** Sponge. Lifts slip and lowers surface moisture without moving the wall. */
export const tool: Tool = {
  id: 'sponge',
  name: 'Sponge',
  label: 'Sponge',
  order: 54,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'Press the sponge on the wall to soak up slip and dry the surface.',
  haptics: { down: 6, move: [5, 30, 5], moveIntervalMs: 130 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
