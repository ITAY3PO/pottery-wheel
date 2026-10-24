import { getClay } from '../clay/clays';
import { axialBlend, pressAlongView, type Stroke } from '../clay/shape';
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
  const dir = ctx.raycaster.ray.direction;
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const hit = ctx.surfaceHit;
  const onBody = hit?.meshId === 'body';
  const radius = onBody && hit ? Math.hypot(hit.point.x, hit.point.z) : ctx.pointer.radius;
  const height = onBody && hit ? hit.point.y : ctx.pointer.height;
  pressAlongView(
    ctx.piece.grid,
    { axial: axialBlend(dir.y / len), radius, height },
    strokeOf(ctx),
    getClay(ctx.piece.clayTypeId),
  );
  ctx.wheel.addDrag(ctx.pointer.pressure);
}

/**
 * Collar from the side, open from above. The ray's angle to the wheel
 * axis blends the two, and the contact is the surface under the finger.
 */
export const tool: Tool = {
  id: 'press',
  name: 'Press',
  label: 'Press',
  order: 40,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'From the side, press the wall in and the clay rises. From above, a center press opens a floor and walls.',
  haptics: { down: 12, move: 7, moveIntervalMs: 90 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
