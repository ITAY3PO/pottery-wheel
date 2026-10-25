import { getClay } from '../clay/clays';
import { currentHand } from '../clay/hand';
import { centerClay, type Stroke } from '../clay/shape';
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
  centerClay(ctx.piece.grid, ctx.pointer.height, strokeOf(ctx), getClay(ctx.piece.clayTypeId));
  ctx.wheel.addDrag(ctx.pointer.pressure);
}

/** Reference tool. Spinning pressure pulls the lump toward round and upward. */
export const tool: Tool = {
  id: 'center',
  name: 'Center',
  label: 'Center',
  order: 10,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'Start the wheel and press into the side until the lump runs true.',
  haptics: { down: 14, move: 8, moveIntervalMs: 100 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
