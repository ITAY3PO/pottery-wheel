import { maxOuterAtRing } from '../clay/grid';
import { removeFromWheel } from '../core/stateMachine';
import type { Tool, ToolContext } from '../core/types';

let startX = 0;
let startY = 0;
let cut = false;

function widest(ctx: ToolContext): number {
  let radius = 0.04;
  const grid = ctx.piece.grid;
  for (let ring = 0; ring < grid.rings; ring += 6) radius = Math.max(radius, maxOuterAtRing(grid, ring));
  return radius;
}

/** Reference tool. Draw the wire across the base once the wheel is nearly still. */
export const tool: Tool = {
  id: 'wire',
  name: 'Wire',
  label: 'Wire',
  order: 60,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'Stop the wheel, then draw the wire across the clay where it meets the bat.',
  haptics: { down: [8, 24, 10], move: 4, moveIntervalMs: 140 },
  onPointerDown(ctx) {
    startX = ctx.pointer.x;
    startY = ctx.pointer.y;
    cut = false;
  },
  onPointerMove(ctx) {
    if (cut || !ctx.piece.onWheel) return;
    if (ctx.wheel.rpm > 28) return;
    const low = ctx.pointer.y < 0.02 && startY < 0.035;
    const crossed = startX * ctx.pointer.x < 0 && Math.abs(ctx.pointer.x - startX) > 0.045;
    const span = Math.abs(ctx.pointer.x - startX) > Math.max(0.06, widest(ctx) * 0.75);
    if (low && (crossed || span)) {
      removeFromWheel(ctx.piece);
      cut = true;
    }
  },
  onPointerUp() {
    cut = false;
  },
};
