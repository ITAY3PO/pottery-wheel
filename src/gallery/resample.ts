import { createSurfaceMap } from '../core/surfaceMap';
import type { ClayGrid, MeshSurface, PieceState, SurfaceMap } from '../core/types';
import { allocateGrid } from '../clay/grid';

/** Fewer rings and segments, for a share link that has to stay short. */
export function resampleGrid(grid: ClayGrid, rings: number, segments: number): ClayGrid {
  const next = allocateGrid(rings, segments);
  const ringScale = grid.rings <= 1 ? 0 : (grid.rings - 1) / Math.max(1, rings - 1);
  for (let r = 0; r < rings; r++) {
    const srcR = Math.max(0, Math.min(grid.rings - 1, Math.round(r * ringScale)));
    next.y[r] = grid.y[srcR] ?? 0;
    next.moisture[r] = grid.moisture[srcR] ?? 0;
    for (let s = 0; s < segments; s++) {
      const start = (s * grid.segments) / segments;
      const end = ((s + 1) * grid.segments) / segments;
      let outer = 0;
      let inner = 0;
      let torn = 0;
      let weight = 0;
      const first = Math.floor(start);
      const last = Math.ceil(end);
      for (let k = first; k < last; k++) {
        const lo = Math.max(start, k);
        const hi = Math.min(end, k + 1);
        const span = hi - lo;
        if (span <= 0) continue;
        const seg = ((k % grid.segments) + grid.segments) % grid.segments;
        const index = srcR * grid.segments + seg;
        outer += (grid.outer[index] ?? 0) * span;
        inner += (grid.inner[index] ?? 0) * span;
        if ((grid.torn[index] ?? 0) > 0) torn = 1;
        weight += span;
      }
      const dest = r * segments + s;
      next.outer[dest] = weight > 0 ? outer / weight : 0;
      next.inner[dest] = weight > 0 ? inner / weight : 0;
      next.torn[dest] = torn;
    }
  }
  if (grid.arcOuter && grid.arcInner && grid.arcOuter.length === grid.rings && grid.arcInner.length === grid.rings) {
    const arcOuter = new Float32Array(rings);
    const arcInner = new Float32Array(rings);
    for (let r = 0; r < rings; r++) {
      const srcR = Math.max(0, Math.min(grid.rings - 1, Math.round(r * ringScale)));
      arcOuter[r] = grid.arcOuter[srcR] ?? 0;
      arcInner[r] = grid.arcInner[srcR] ?? 0;
    }
    next.arcOuter = arcOuter;
    next.arcInner = arcInner;
  }
  next.uvFrozen = grid.uvFrozen;
  next.stress = grid.stress;
  next.failure = grid.failure;
  next.revision = 1;
  return next;
}

function sampleMap(map: SurfaceMap, edge: number): SurfaceMap {
  if (edge >= map.width && edge >= map.height) return map;
  const next = createSurfaceMap(edge, edge);
  for (let y = 0; y < edge; y++) {
    const sy = Math.min(map.height - 1, Math.floor(((y + 0.5) * map.height) / edge));
    for (let x = 0; x < edge; x++) {
      const sx = Math.min(map.width - 1, Math.floor(((x + 0.5) * map.width) / edge));
      const from = sy * map.width + sx;
      const to = y * edge + x;
      next.glazeId[to] = map.glazeId[from] ?? 0;
      next.thickness[to] = map.thickness[from] ?? 0;
      next.wax[to] = map.wax[from] ?? 0;
      next.underglazeId[to] = map.underglazeId[from] ?? 0;
    }
  }
  return next;
}

function resampleSurface(surface: MeshSurface, edge: number): MeshSurface {
  return { meshId: surface.meshId, map: sampleMap(surface.map, edge) };
}

/**
 * A view of `piece` used only to build a share payload.
 * `surfaceEdge` null keeps the maps, 0 drops them, otherwise each map is squared down.
 */
export function projectPiece(
  piece: PieceState,
  rings: number,
  segments: number,
  surfaceEdge: number | null,
): PieceState {
  const sameGrid = rings === piece.grid.rings && segments === piece.grid.segments;
  const grid = sameGrid ? piece.grid : resampleGrid(piece.grid, rings, segments);
  let surfaces = piece.surfaces;
  if (surfaceEdge === 0) surfaces = [];
  else if (surfaceEdge != null) surfaces = piece.surfaces.map((surface) => resampleSurface(surface, surfaceEdge));
  if (grid === piece.grid && surfaces === piece.surfaces) return piece;
  return { ...piece, grid, surfaces };
}
