import { vibrate } from '../core/haptics';
import { ensureAttachmentSurface, ensureBodySurface } from '../core/surfaceMap';
import type { PieceState, SurfaceMap, Tool, ToolContext } from '../core/types';
import { getGlaze } from './catalog';
import { brushRadius, paintGlaze, paintWax, strokeGlaze, strokeWax } from './paint';
import { painter } from './session';

interface Stamp {
  meshId: string;
  u: number;
  v: number;
}

let from: Stamp | null = null;
let stamped = false;
let lastKey = '';
let lastAt = 0;

function mapFor(piece: PieceState, meshId: string): SurfaceMap {
  if (meshId === 'body') return ensureBodySurface(piece).map;
  return ensureAttachmentSurface(piece, meshId).map;
}

/** One dab, or a segment from the previous sample. Same UV inside 30ms counts once. */
function dab(ctx: ToolContext): boolean {
  const hit = ctx.surfaceHit;
  if (!hit || ctx.piece.stage !== 'bisque') return false;
  const key = `${hit.meshId}:${hit.u.toFixed(4)}:${hit.v.toFixed(4)}`;
  const now = performance.now();
  if (key === lastKey && now - lastAt < 30) return false;
  lastKey = key;
  lastAt = now;

  const map = mapFor(ctx.piece, hit.meshId);
  const radius = brushRadius(painter.brushSize);
  const previous = from && from.meshId === hit.meshId ? from : null;
  if (painter.mode === 'wax') {
    if (previous) strokeWax(map, previous, hit, radius);
    else paintWax(map, hit.u, hit.v, radius);
  } else {
    const glaze = getGlaze(painter.glazeId);
    if (previous) strokeGlaze(map, previous, hit, radius, glaze.id, glaze.coatMm);
    else paintGlaze(map, hit.u, hit.v, radius, glaze.id, glaze.coatMm);
  }
  from = { meshId: hit.meshId, u: hit.u, v: hit.v };
  ctx.markSurfaceDirty(hit.meshId);
  ctx.piece.updatedAt = Date.now();
  stamped = true;
  return true;
}

const brush: Tool = {
  id: 'glaze-brush',
  name: 'Brush',
  label: 'Brush',
  order: 120,
  allowedStages: ['bisque'],
  requiresWheel: false,
  instruction: 'Drag to paint wax or glaze. Two fingers turn the pot.',
  onPointerDown(ctx) {
    from = null;
    stamped = false;
    if (dab(ctx)) vibrate(70);
  },
  onPointerMove(ctx) {
    dab(ctx);
  },
  onPointerUp(ctx) {
    if (!stamped) dab(ctx);
    from = null;
    stamped = false;
  },
};

/** Hidden on the wheel, same as the hand-building tools. Bisque is already off it. */
export const tool: Tool = Object.assign(brush, { offWheel: true });
