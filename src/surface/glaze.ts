import type { SurfaceMap } from '../core/types';
import { applyGlazeBrush } from './paint';

/**
 * Brush one dab of glaze onto a surface map.
 * Waxed texels stay bare. Thickness stacks and caps at 2.55 mm.
 * From a tool, prefer `ctx.surfaceHit` and `ctx.markSurfaceDirty`.
 */
export function applyGlaze(map: SurfaceMap, u: number, v: number, radius: number, glazeId = 3): void {
  applyGlazeBrush(map, glazeId, u, v, radius);
}
