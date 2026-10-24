import type { Tool, ToolContext } from '../core/types';
import { centerForTrim } from './trim-carve';

function apply(ctx: ToolContext): void {
  centerForTrim(ctx.piece, {
    pressure: ctx.pointer.pressure,
    omega: ctx.wheel.omega,
    segment: ctx.pointer.segment,
    dt: ctx.dt,
  });
  ctx.wheel.addDrag(ctx.pointer.pressure * 0.72);
}

/** Leather-hard. Slide the upside-down pot until it runs true. Volume stays put. */
export const tool: Tool = {
  id: 'trim-center',
  name: 'Center',
  label: 'Center',
  order: 70,
  allowedStages: ['leather-hard'],
  requiresWheel: true,
  instruction: 'The pot is base-up. Start the wheel and press the side until it runs true.',
  haptics: { down: 12, move: 8, moveIntervalMs: 110 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
