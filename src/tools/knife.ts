import { clayIndex, clamp, eachContacted, pieceHeight, sanitizeGrid, touchGrid } from '../clay/grid';
import type { Tool, ToolContext } from '../core/types';

const SPIN = 2.2;

function frameDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, 0.05);
}

/** Chamfer on the bat, deeper groove just above it for the wire. */
function footProfile(t: number): number {
  const chamfer = Math.exp(-((t - 0.04) ** 2) / 0.02);
  const groove = Math.exp(-((t - 0.34) ** 2) / 0.012);
  return chamfer * 0.42 + groove;
}

function apply(ctx: ToolContext): void {
  const pressure = clamp(ctx.pointer.pressure, 0, 1);
  const grid = ctx.piece.grid;
  const footLimit = Math.max(0.012, pieceHeight(grid) * 0.16);
  if (ctx.pointer.height > footLimit) {
    ctx.wheel.addDrag(pressure * 0.16);
    return;
  }
  // The edge bites at the foot.
  ctx.wheel.addDrag(pressure * 0.74);
  const dt = frameDt(ctx.dt);
  if (pressure <= 0.04 || dt <= 0) return;

  const foot = Math.max(4, Math.round(grid.rings * 0.12));
  const bite = Math.min(0.0028, 0.0001 + pressure * dt * 0.014);
  const round = Math.abs(ctx.wheel.omega) >= SPIN;
  const end = Math.min(foot, grid.rings - 1);
  for (let r = 0; r <= end; r++) {
    const cut = bite * footProfile(r / foot);
    if (cut <= 0) continue;
    const carve = (segment: number, weight: number) => {
      const i = clayIndex(r, segment, grid.segments);
      const inner = grid.inner[i];
      const floor = Math.max(inner + 0.0022, 0.004);
      grid.outer[i] = Math.max(floor, grid.outer[i] - cut * weight);
    };
    if (round) {
      for (let s = 0; s < grid.segments; s++) carve(s, 1);
    } else {
      eachContacted(grid.segments, ctx.pointer.segment, 0, dt, carve);
    }
    grid.moisture[r] = clamp(grid.moisture[r] - 0.45 * pressure * dt * (round ? 1 : 0.3), 0.28, 1);
  }
  sanitizeGrid(grid);
  touchGrid(grid);
}

/** Wooden knife. Bevels the base and cuts an undercut just above the bat, before the wire. */
export const tool: Tool = {
  id: 'knife',
  name: 'Wooden knife',
  label: 'Wood knife',
  order: 58,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'With the wheel turning, cut a bevel and an undercut where the clay meets the bat.',
  haptics: { down: 14, move: 11, moveIntervalMs: 95 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
