import { getClay } from '../clay/clays';
import { pressIn, type Stroke } from '../clay/shape';
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
  pressIn(ctx.piece.grid, ctx.pointer.height, strokeOf(ctx), getClay(ctx.piece.clayTypeId));
  ctx.wheel.addDrag(ctx.pointer.pressure);
}

/** Reference tool. Collar the form inward; the clay climbs. */
export const tool: Tool = {
  id: 'press',
  name: 'Press',
  label: 'Press',
  order: 40,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'Press the wall inward to narrow it. The clay above will rise.',
  haptics: { down: 12, move: 7, moveIntervalMs: 90 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
