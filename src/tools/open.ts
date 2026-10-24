import { getClay } from '../clay/clays';
import { meanChannel, ringAtHeight } from '../clay/grid';
import { openCenter, type Stroke } from '../clay/shape';
import type { Tool, ToolContext } from '../core/types';

function strokeOf(ctx: ToolContext): Stroke {
  return {
    pressure: ctx.pointer.pressure,
    omega: ctx.wheel.omega,
    segment: ctx.pointer.segment,
    dt: ctx.dt,
  };
}

function apply(ctx: ToolContext): void {
  const grid = ctx.piece.grid;
  const ring = ringAtHeight(grid, ctx.pointer.height);
  const outer = meanChannel(grid.outer, ring, grid.segments);
  // A finger on the outside wall is not opening the well.
  if (ctx.pointer.radius > outer * 0.84 && ctx.pointer.radius > 0.02) return;
  openCenter(grid, ctx.pointer.height, ctx.pointer.radius, strokeOf(ctx), getClay(ctx.piece.clayTypeId));
  ctx.wheel.addDrag(ctx.pointer.pressure * 0.85);
}

/** Reference tool. Push down in the middle, then widen. */
export const tool: Tool = {
  id: 'open',
  name: 'Open',
  label: 'Open',
  order: 20,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'Push down near the center, then move outward to widen the floor.',
  haptics: { down: 12, move: 6, moveIntervalMs: 110 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
