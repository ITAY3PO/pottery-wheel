import { clamp, conserveByRadius, ringAtHeight, scaleGaps, touchGrid, volume } from '../clay/grid';
import type { Tool, ToolContext } from '../core/types';

function frameDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, 0.05);
}

function apply(ctx: ToolContext): void {
  const pressure = clamp(ctx.pointer.pressure, 0, 1);
  // Slip. Water lubricates, so the wheel barely feels it.
  ctx.wheel.addDrag(pressure * 0.05);
  const dt = frameDt(ctx.dt);
  if (pressure <= 0.04 || dt <= 0) return;

  const grid = ctx.piece.grid;
  const ring = ringAtHeight(grid, ctx.pointer.height);
  const band = Math.max(2, Math.round(grid.rings * 0.06));
  const cover = Math.abs(ctx.wheel.omega) >= 2.2 ? 1 : 0.35;
  let soaked = 0;
  for (let r = ring - band; r <= ring + band; r++) {
    if (r < 0 || r >= grid.rings) continue;
    const d = Math.abs(r - ring) / (band + 0.25);
    if (d >= 1) continue;
    const fall = Math.cos(d * Math.PI * 0.5);
    const before = grid.moisture[r];
    // Already dripping: more water has nowhere to go and the wall goes soft.
    if (before >= 0.96) soaked = Math.max(soaked, fall);
    grid.moisture[r] = clamp(before + 1.4 * pressure * cover * dt * fall, 0, 1);
  }

  if (soaked > 0) {
    grid.stress += dt * pressure * 42 * soaked;
    if (grid.stress > 3) {
      const target = volume(grid);
      const factor = clamp(1 - dt * pressure * 0.22 * soaked, 0.985, 1);
      scaleGaps(grid, 0, factor);
      if (target > 1e-12) conserveByRadius(grid, target);
    }
  }
  touchGrid(grid);
}

/**
 * Water. Adds moisture and slip. On clay that is already saturated, holding
 * it softens the wall (stress climbs, the form squats) so it slumps sooner.
 */
export const tool: Tool = {
  id: 'water',
  name: 'Water',
  label: 'Water',
  order: 16,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'Touch water onto the clay for slip. Too much softens a wet wall until it slumps.',
  haptics: { down: 4, move: 3, moveIntervalMs: 170 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
