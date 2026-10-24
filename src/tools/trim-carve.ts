import { getClay, minWallThickness } from '../clay/clays';
import {
  centeredness,
  clayIndex,
  clamp,
  eachContacted,
  meanChannel,
  ringAtHeight,
  sanitizeGrid,
  scaleRadii,
  smoothVertical,
  touchGrid,
  volume,
} from '../clay/grid';
import { canTrim } from '../core/stateMachine';
import type { ClayGrid, PieceState, ToolContext } from '../core/types';
import { spawnTrimChips } from './trim-chips';
import {
  TRIM_HOLLOW,
  isBaseUp,
  isHollowRing,
  isSeated,
  seatOnBat,
  setTrimBite,
  trimBite,
} from './trim-pose';

export type LoopKind = 'round' | 'square' | 'ribbon';

export interface TrimStroke {
  pressure: number;
  omega: number;
  segment: number;
  dt: number;
}

export interface TrimCut {
  removed: number;
  cutThrough: boolean;
}

const SPIN = 2.2;
const NONE: TrimCut = { removed: 0, cutThrough: false };

interface LoopSpec {
  /** Meters of recess per second at full pressure. */
  depth: number;
  /** Meters of outer wall per second at full pressure. */
  shave: number;
  /** Fraction of the height, down from the base face, that still counts as the foot. */
  faceBand: number;
  wallBand: number;
  smooth: number;
}

const LOOPS: Record<LoopKind, LoopSpec> = {
  round: { depth: 0.008, shave: 0.0032, faceBand: 0.32, wallBand: 0.18, smooth: 0.4 },
  square: { depth: 0.0075, shave: 0.0042, faceBand: 0.2, wallBand: 0.1, smooth: 0 },
  ribbon: { depth: 0.0032, shave: 0.0055, faceBand: 0.4, wallBand: 0.5, smooth: 0.22 },
};

function strokeOf(ctx: ToolContext): TrimStroke {
  return {
    pressure: ctx.pointer.pressure,
    omega: ctx.wheel.omega,
    segment: ctx.pointer.segment,
    dt: ctx.dt,
  };
}

function spinning(stroke: TrimStroke): boolean {
  return Math.abs(stroke.omega) >= SPIN;
}

function withHand(grid: ClayGrid, stroke: TrimStroke, fn: (segment: number, weight: number) => void): void {
  if (spinning(stroke)) {
    for (let segment = 0; segment < grid.segments; segment++) fn(segment, 1);
    return;
  }
  eachContacted(grid.segments, stroke.segment, 0, stroke.dt, fn);
}

/** Slide the upside-down pot toward the axis. Leather-hard clay is not pushed up. */
export function centerForTrim(piece: PieceState, stroke: TrimStroke): void {
  if (!canTrim(piece) || !isBaseUp(piece.grid) || stroke.pressure <= 0.02) return;
  const grid = piece.grid;
  const before = volume(grid);
  const spin = spinning(stroke);
  const blend = clamp(1 - Math.exp(-(spin ? 6.5 : 2.4) * Math.max(stroke.dt, 0) * stroke.pressure), 0, 0.58);
  if (blend <= 0) return;
  const segments = grid.segments;
  for (let r = 0; r < grid.rings; r++) {
    const meanOuter = meanChannel(grid.outer, r, segments);
    const meanInner = meanChannel(grid.inner, r, segments);
    withHand(grid, stroke, (segment, weight) => {
      const i = clayIndex(r, segment, segments);
      const t = blend * (spin ? 1 : weight);
      grid.outer[i] += (meanOuter - grid.outer[i]) * t;
      if (grid.inner[i] > 0.0008 || meanInner > 0.0008) {
        grid.inner[i] += (meanInner - grid.inner[i]) * t;
        if (grid.inner[i] < 0) grid.inner[i] = 0;
      }
    });
  }
  sanitizeGrid(grid);
  const now = volume(grid);
  if (now > 1e-12 && before > 1e-12) scaleRadii(grid, Math.sqrt(before / now));
  touchGrid(grid);
}

/** A firm tap seats a centered pot. An off-center one just skids. */
export function tapForTrim(piece: PieceState, height: number, stroke: TrimStroke): boolean {
  if (!canTrim(piece) || !isBaseUp(piece.grid)) return false;
  if (isSeated(piece.grid)) return true;
  if (stroke.pressure < 0.38) return false;
  const grid = piece.grid;
  const top = grid.y[grid.rings - 1];
  const span = top - grid.y[0];
  if (height < top - span * 0.48) return false;
  if (centeredness(grid) < 0.62) return false;
  seatOnBat(grid);
  return true;
}

/**
 * Carve clay away. Volume drops. A round loop leaves a bowl, a square loop a
 * flat shelf, a ribbon a shallow shaving. Held too long, the floor opens.
 */
export function trimWithLoop(
  piece: PieceState,
  kind: LoopKind,
  height: number,
  fingerRadius: number,
  stroke: TrimStroke,
): TrimCut {
  if (!canTrim(piece) || !isBaseUp(piece.grid) || stroke.pressure <= 0.04) return NONE;
  const grid = piece.grid;
  const before = volume(grid);
  const spec = LOOPS[kind];
  const gain = (isSeated(grid) ? 1 : 0.35) * (spinning(stroke) ? 1 : 0.45);
  const step = spec.depth * stroke.pressure * Math.max(stroke.dt, 0) * gain;
  const shave = spec.shave * stroke.pressure * Math.max(stroke.dt, 0) * gain;
  const minFoot = Math.max(0.002, minWallThickness(getClay(piece.clayTypeId)) * 1.35);

  const pierced = fingerOnBase(grid, height, spec.faceBand)
    ? deepenRecess(grid, kind, fingerRadius, step, minFoot, stroke)
    : false;
  shapeOutside(grid, kind, fingerRadius, height, shave, spec, minFoot, stroke);
  if (spec.smooth > 0) smoothOuterFoot(grid, spec);
  sanitizeGrid(grid);
  const wallGone = footWallGone(grid);
  const cutThrough = pierced || wallGone;
  if (wallGone && !pierced) markRingTorn(grid, grid.rings - 1);
  touchGrid(grid);
  return { removed: Math.max(0, before - volume(grid)), cutThrough };
}

export function applyLoop(ctx: ToolContext, kind: LoopKind): void {
  const result = trimWithLoop(ctx.piece, kind, ctx.pointer.height, ctx.pointer.radius, strokeOf(ctx));
  if (result.removed > 0) {
    spawnTrimChips(
      { x: ctx.pointer.side * ctx.pointer.radius, y: ctx.pointer.height, z: 0.008 },
      result.removed,
      ctx.wheel.omega,
    );
  }
  const drag = kind === 'ribbon' ? 0.28 : 0.48;
  ctx.wheel.addDrag(ctx.pointer.pressure * drag);
}

function fingerOnBase(grid: ClayGrid, height: number, faceBand: number): boolean {
  const top = grid.y[grid.rings - 1];
  const span = Math.max(0.01, top - grid.y[0]);
  return height >= top - Math.max(0.008, span * faceBand);
}

function deepenRecess(
  grid: ClayGrid,
  kind: LoopKind,
  fingerRadius: number,
  step: number,
  minFoot: number,
  stroke: TrimStroke,
): boolean {
  const top = grid.rings - 1;
  const topY = grid.y[top];
  const span = Math.max(0.01, topY - grid.y[0]);
  let remembered = trimBite(grid);
  if (remembered > span + 0.01) remembered = geometricDepth(grid);
  const nextDepth = Math.max(geometricDepth(grid), remembered) + Math.max(0, step);
  setTrimBite(grid, nextDepth);

  const cavity = cavityTopRing(grid);
  const floorY = cavity >= 0 ? grid.y[cavity] : grid.y[0];
  const piercing = topY - nextDepth <= floorY + 1e-4;
  const limitY = piercing ? -1 : topY - nextDepth;
  const target = recessTarget(kind, fingerRadius, meanChannel(grid.outer, top, grid.segments), minFoot);
  const wasSolid: number[] = [];
  for (let r = 0; r < grid.rings; r++) if (!isHollowRing(grid, r)) wasSolid.push(r);

  for (let r = top; r >= 0; r--) {
    if (grid.y[r] < limitY) break;
    const t = clamp((topY - grid.y[r]) / Math.max(nextDepth, 1e-4), 0, 1);
    const spare = piercing ? 0.0004 : minFoot;
    const goal = Math.max(0, Math.min(profileGoal(kind, target, piercing ? 0.1 : t), meanOuter(grid, r) - spare));
    raiseInner(grid, r, goal, stroke, spare);
  }

  if (piercing) {
    const spin = Math.max(Math.abs(stroke.omega), SPIN) * Math.sign(stroke.omega || 1);
    for (const r of wasSolid) {
      if (isHollowRing(grid, r)) continue;
      const goal = Math.min(Math.max(target * 0.7, TRIM_HOLLOW * 2), Math.max(0, meanOuter(grid, r) - 0.0004));
      raiseInner(grid, r, goal, { ...stroke, omega: spin }, 0.0004);
    }
  }
  // The floor ring can open a frame before `piercing` flips, once the recess
  // reaches it. Either way, no solid ring left means the base is gone.
  if (hasSolid(grid)) return false;
  for (const r of wasSolid) {
    if (isHollowRing(grid, r)) markRingTorn(grid, r);
  }
  grid.failure = grid.failure === 'slumped' ? 'slumped' : 'torn';
  return true;
}

function geometricDepth(grid: ClayGrid): number {
  const low = recessBottomRing(grid);
  if (low < 0) return 0;
  const topY = grid.y[grid.rings - 1];
  const under = low === 0 ? grid.y[0] : grid.y[low] - (grid.y[low] - grid.y[low - 1]) * 0.2;
  return Math.max(0, topY - under);
}

function cavityTopRing(grid: ClayGrid): number {
  let found = -1;
  for (let r = 0; r < grid.rings; r++) {
    if (!isHollowRing(grid, r)) break;
    found = r;
  }
  return found;
}

function recessBottomRing(grid: ClayGrid): number {
  let low = -1;
  for (let r = grid.rings - 1; r >= 0; r--) {
    if (!isHollowRing(grid, r)) break;
    low = r;
  }
  return low;
}

function recessTarget(kind: LoopKind, fingerRadius: number, outer: number, minFoot: number): number {
  let target = fingerRadius;
  if (!(target > 0)) target = outer * 0.55;
  if (target > outer * 0.9) target = outer * (kind === 'ribbon' ? 0.48 : 0.64);
  if (kind === 'ribbon') target = Math.min(target, outer * 0.58);
  const cap = Math.max(0.006, outer - minFoot);
  return clamp(target, 0.006, cap);
}

function profileGoal(kind: LoopKind, target: number, t: number): number {
  if (kind === 'round') return target * (1 - 0.55 * t * t);
  if (kind === 'ribbon') return target * (1 - 0.4 * t);
  return target;
}

function raiseInner(grid: ClayGrid, ring: number, goal: number, stroke: TrimStroke, spare: number): void {
  if (!(goal > 0)) return;
  const segments = grid.segments;
  withHand(grid, stroke, (segment, weight) => {
    const i = clayIndex(ring, segment, segments);
    const capped = Math.min(goal, Math.max(0, grid.outer[i] - spare));
    const next = spinning(stroke) ? capped : capped * weight;
    if (next > grid.inner[i]) grid.inner[i] = next;
  });
}

function shapeOutside(
  grid: ClayGrid,
  kind: LoopKind,
  fingerRadius: number,
  height: number,
  shave: number,
  spec: LoopSpec,
  minFoot: number,
  stroke: TrimStroke,
): void {
  const top = grid.rings - 1;
  const topY = grid.y[top];
  const span = Math.max(0.01, topY - grid.y[0]);
  const ring = ringAtHeight(grid, clamp(height, grid.y[0], topY));
  const outerHere = meanChannel(grid.outer, ring, grid.segments);
  const nearWall = fingerRadius > outerHere * 0.78;
  const spare = stroke.pressure > 0.9 && kind === 'square' ? minFoot * 0.25 : minFoot;
  if (kind === 'ribbon' || nearWall) {
    const band = Math.max(2, Math.round(grid.rings * spec.wallBand));
    const center = kind === 'ribbon' ? ring : Math.max(0, top - 1);
    for (let r = center - band; r <= center + band; r++) {
      if (r < 0 || r >= grid.rings) continue;
      if (topY - grid.y[r] > span * (kind === 'ribbon' ? 0.62 : 0.28)) continue;
      const fall = band <= 0 ? 1 : Math.max(0, 1 - Math.abs(r - center) / (band + 0.25));
      shaveRing(grid, r, shave * fall, spare, stroke);
    }
    return;
  }
  const bevelBand = kind === 'square' ? 3 : 5;
  for (let k = 0; k <= bevelBand; k++) {
    const r = top - k;
    if (r < 0) break;
    const scale = kind === 'square' ? (k === 0 ? 0.2 : 0.85) : 1 - k / (bevelBand + 1);
    shaveRing(grid, r, shave * 0.45 * scale, minFoot, stroke);
  }
}

function shaveRing(grid: ClayGrid, ring: number, amount: number, minFoot: number, stroke: TrimStroke): void {
  if (amount <= 0) return;
  withHand(grid, stroke, (segment, weight) => {
    const i = clayIndex(ring, segment, grid.segments);
    const delta = amount * (spinning(stroke) ? 1 : weight);
    grid.outer[i] = Math.max(grid.inner[i] + minFoot, grid.outer[i] - delta);
  });
}

function smoothOuterFoot(grid: ClayGrid, spec: LoopSpec): void {
  const top = grid.rings - 1;
  const band = Math.max(2, Math.round(grid.rings * spec.wallBand));
  smoothVertical(grid.outer, grid.rings, grid.segments, Math.max(1, top - band), top - 1, spec.smooth * 0.3);
}

function footWallGone(grid: ClayGrid): boolean {
  const top = grid.rings - 1;
  for (let r = top; r >= top - 2 && r >= 0; r--) {
    const outer = meanChannel(grid.outer, r, grid.segments);
    const inner = meanChannel(grid.inner, r, grid.segments);
    if (inner >= TRIM_HOLLOW && outer - inner < 0.0008) return true;
  }
  return false;
}

function markRingTorn(grid: ClayGrid, ring: number): void {
  const base = ring * grid.segments;
  for (let s = 0; s < grid.segments; s++) grid.torn[base + s] = 1;
  grid.failure = grid.failure === 'slumped' ? 'slumped' : 'torn';
}

function hasSolid(grid: ClayGrid): boolean {
  for (let r = 0; r < grid.rings; r++) if (!isHollowRing(grid, r)) return true;
  return false;
}

function meanOuter(grid: ClayGrid, ring: number): number {
  return meanChannel(grid.outer, ring, grid.segments);
}
