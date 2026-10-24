import { getClay } from '../clay/clays';
import { compressClay, type Stroke } from '../clay/shape';
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
  const dragDown = ctx.previous ? ctx.previous.height - ctx.pointer.height : 0;
  if (dragDown <= 0) {
    ctx.wheel.addDrag(ctx.pointer.pressure * 0.3);
    return;
  }
  compressClay(ctx.piece.grid, ctx.pointer.height, dragDown, strokeOf(ctx), getClay(ctx.piece.clayTypeId));
  ctx.wheel.addDrag(ctx.pointer.pressure * 0.7);
}

/** Reference tool. Drag down to shorten and thicken. */
export const tool: Tool = {
  id: 'compress',
  name: 'Compress',
  label: 'Compress',
  order: 50,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'Drag down on the rim to shorten the piece and thicken the wall.',
  haptics: { down: 10, move: 8, moveIntervalMs: 100 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
