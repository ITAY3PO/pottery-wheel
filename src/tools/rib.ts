import { getClay, minWallThickness } from '../clay/clays';
import {
  clayIndex,
  clamp,
  conserveByRadius,
  eachContacted,
  meanChannel,
  ringAtHeight,
  sanitizeGrid,
  smoothVertical,
  touchGrid,
  volume,
  wrapIndex,
} from '../clay/grid';
import type { Tool, ToolContext } from '../core/types';

const SPIN = 2.2;
let scratch = new Float32Array(16);

function frameDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, 0.05);
}

function falloff(ring: number, center: number, band: number): number {
  const d = Math.abs(ring - center) / (band + 0.25);
  if (d >= 1) return 0;
  return Math.cos(d * Math.PI * 0.5);
}

/** Blend each sample toward its neighbors so finger ridges die without moving the mean. */
function smoothAround(
  data: Float32Array,
  ring: number,
  segments: number,
  amount: number,
  segment: number,
  omega: number,
  dt: number,
): void {
  if (amount <= 0) return;
  if (scratch.length < segments) scratch = new Float32Array(segments);
  const base = ring * segments;
  if (Math.abs(omega) >= SPIN) {
    for (let s = 0; s < segments; s++) {
      const prev = data[base + wrapIndex(s - 1, segments)];
      const next = data[base + wrapIndex(s + 1, segments)];
      scratch[s] = data[base + s] + ((prev + next) * 0.5 - data[base + s]) * amount;
    }
    for (let s = 0; s < segments; s++) data[base + s] = scratch[s];
    return;
  }
  eachContacted(segments, segment, 0, dt, (seg, weight) => {
    const i = base + seg;
    const prev = data[base + wrapIndex(seg - 1, segments)];
    const next = data[base + wrapIndex(seg + 1, segments)];
    data[i] += ((prev + next) * 0.5 - data[i]) * amount * weight;
  });
}

function apply(ctx: ToolContext): void {
  const pressure = clamp(ctx.pointer.pressure, 0, 1);
  // A rib rides the wall. Firm, but it doesn't grab like a bare hand.
  ctx.wheel.addDrag(pressure * 0.62);
  const dt = frameDt(ctx.dt);
  if (pressure <= 0.04 || dt <= 0) return;

  const grid = ctx.piece.grid;
  const target = volume(grid);
  const ring = ringAtHeight(grid, ctx.pointer.height);
  const band = Math.max(3, Math.round(grid.rings * 0.07));
  const minW = minWallThickness(getClay(ctx.piece.clayTypeId));
  const round = Math.abs(ctx.wheel.omega) >= SPIN;
  const smooth = clamp(1 - Math.exp(-7 * dt * pressure), 0, 0.62);
  const vertical = clamp(1 - Math.exp(-5.5 * dt * pressure), 0, 0.28);
  const push = 0.006 * pressure * dt;

  for (let r = ring - band; r <= ring + band; r++) {
    if (r < 0 || r >= grid.rings) continue;
    const fall = falloff(r, ring, band);
    if (fall <= 0) continue;
    smoothAround(grid.outer, r, grid.segments, smooth * fall, ctx.pointer.segment, ctx.wheel.omega, dt);
    if (meanChannel(grid.inner, r, grid.segments) > 0.0015) {
      smoothAround(grid.inner, r, grid.segments, smooth * fall * 0.65, ctx.pointer.segment, ctx.wheel.omega, dt);
    }
    const compress = (segment: number, weight: number) => {
      const i = clayIndex(r, segment, grid.segments);
      const inner = grid.inner[i];
      const delta = push * fall * weight;
      // Outer moves in a little. The inner wall moves in more, so the wall packs thicker.
      const nextInner = inner > 0.002 ? Math.max(0, inner - delta) : inner;
      const nextOuter = Math.max(nextInner + minW, grid.outer[i] - delta * 0.45);
      grid.inner[i] = Math.min(nextInner, nextOuter);
      grid.outer[i] = nextOuter;
    };
    if (round) {
      for (let s = 0; s < grid.segments; s++) compress(s, 1);
    } else {
      eachContacted(grid.segments, ctx.pointer.segment, 0, dt, compress);
    }
    // The rib squeegees slip off the surface. It is not a sponge.
    grid.moisture[r] = clamp(grid.moisture[r] - 0.16 * pressure * dt * fall * (round ? 1 : 0.35), 0.22, 1);
  }

  smoothVertical(grid.outer, grid.rings, grid.segments, ring - band, ring + band, vertical);
  smoothVertical(grid.inner, grid.rings, grid.segments, ring - band, ring + band, vertical * 0.75);
  sanitizeGrid(grid);
  const now = volume(grid);
  if (now > 1e-12 && target > 0 && Math.abs(now - target) / target > 0.004) conserveByRadius(grid, target);
  touchGrid(grid);
}

/** Metal or wood rib. Erases throwing lines, fairs the profile, and compresses the wall. */
export const tool: Tool = {
  id: 'rib',
  name: 'Rib',
  label: 'Rib',
  order: 52,
  allowedStages: ['wet'],
  requiresWheel: true,
  instruction: 'Hold the rib on the spinning wall. It takes out throwing lines and fairs the curve.',
  haptics: { down: 8, move: 5, moveIntervalMs: 55 },
  onPointerDown: apply,
  onPointerMove: apply,
  onPointerUp() {},
};
