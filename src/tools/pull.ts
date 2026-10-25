import { getClay } from '../clay/clays';
import { currentHand } from '../clay/hand';
import { pullUp, type Stroke } from '../clay/shape';
import type { Tool, ToolContext } from '../core/types';

function strokeOf(ctx: ToolContext): Stroke {
  return {
    pressure: ctx.pointer.pressure,
    omega: ctx.wheel.omega,
    segment: ctx.pointer.segment,
    dt: ctx.dt,
    hand: currentHand(),
  };
}

function apply(ctx: ToolContext): void {
  const dragUp = ctx.previous ? ctx.pointer.height - ctx.previous.height : 0;
  if (dragUp <= 0) {
    ctx.wheel.addDrag(ctx.pointer.pressure * 0.35);
    return;
  }
  pullUp(ctx.piece.grid, ctx.pointer.height, dragUp, strokeOf(ctx), getClay(ctx.piece.clayTypeId));
  ctx.wheel.addDrag(ctx.pointer.pressure);
}

/** Reference tool. Drag upward to raise and thin a wall. */
export const tool: Tool = {
  id: 'pull',
  name: 'Pull',
  label: 'Pull',
  order: 30,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'Drag up the wall. Keep the wheel turning and don’t rush the thin spots.',
  haptics: { down: 10, move: 5, moveIntervalMs: 70 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
