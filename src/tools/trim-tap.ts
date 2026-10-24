import type { Tool, ToolContext } from '../core/types';
import { tapForTrim } from './trim-carve';

function apply(ctx: ToolContext): void {
  tapForTrim(ctx.piece, ctx.pointer.height, {
    pressure: ctx.pointer.pressure,
    omega: ctx.wheel.omega,
    segment: ctx.pointer.segment,
    dt: ctx.dt,
  });
  ctx.wheel.addDrag(ctx.pointer.pressure * 0.22);
}

/** Leather-hard. Tap the base so the centered pot sticks to the bat. */
export const tool: Tool = {
  id: 'trim-tap',
  name: 'Tap',
  label: 'Tap',
  order: 80,
  allowedStages: ['leather-hard'],
  requiresWheel: true,
  instruction: 'Tap down on the base. It only sticks once the pot is running true.',
  haptics: { down: [4, 22], move: 12, moveIntervalMs: 180 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
