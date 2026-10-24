import { computeArc, currentArc } from '../clay/grid';
import type { ClayGrid, MeshSurface, PieceState, SurfaceMap } from './types';

/** Body and attachment maps. 128² is enough for glaze and wax at this scale. */
export const SURFACE_MAP_WIDTH = 128;
export const SURFACE_MAP_HEIGHT = 128;

export function createSurfaceMap(
  width = SURFACE_MAP_WIDTH,
  height = SURFACE_MAP_HEIGHT,
): SurfaceMap {
  const n = width * height;
  return {
    width,
    height,
    glazeId: new Uint8Array(n),
    thickness: new Float32Array(n),
    wax: new Uint8Array(n),
    underglazeId: new Uint8Array(n),
  };
}

export function createMeshSurface(meshId: string): MeshSurface {
  return { meshId, map: createSurfaceMap() };
}

export function ensureBodySurface(piece: PieceState): MeshSurface {
  let surface = piece.surfaces.find((entry) => entry.meshId === 'body');
  if (!surface) {
    surface = createMeshSurface('body');
    piece.surfaces.push(surface);
  }
  return surface;
}

export function ensureAttachmentSurface(piece: PieceState, attachmentId: string): MeshSurface {
  let surface = piece.surfaces.find((entry) => entry.meshId === attachmentId);
  if (!surface) {
    surface = createMeshSurface(attachmentId);
    piece.surfaces.push(surface);
  }
  return surface;
}

function wrap01(value: number): number {
  return value - Math.floor(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Body UV. `u` is the angle around the wheel (segment / segments).
 * `v` is normalized arc length along the profile. Once `grid.uvFrozen`
 * is set, v stops following the live profile.
 */
export function bodyUV(grid: ClayGrid, ring: number, segment: number): { u: number; v: number } {
  const u = grid.segments <= 1 ? 0 : segment / grid.segments;
  const arcs = currentArc(grid, 'outer');
  const clampedRing = Math.max(0, Math.min(grid.rings - 1, ring));
  return { u, v: arcs[clampedRing] ?? 0 };
}

/** Texel index for a UV. `u` wraps (it is an angle); `v` clamps. */
export function uvToTexel(map: SurfaceMap, u: number, v: number): { x: number; y: number; index: number } {
  const x = Math.min(map.width - 1, Math.max(0, Math.floor(wrap01(u) * map.width)));
  const y = Math.min(map.height - 1, Math.max(0, Math.floor(clamp01(v) * map.height)));
  return { x, y, index: y * map.width + x };
}

export function sampleGlaze(map: SurfaceMap, u: number, v: number): { glazeId: number; thickness: number; wax: number; underglazeId: number } {
  const { index } = uvToTexel(map, u, v);
  return {
    glazeId: map.glazeId[index] ?? 0,
    thickness: map.thickness[index] ?? 0,
    wax: map.wax[index] ?? 0,
    underglazeId: map.underglazeId[index] ?? 0,
  };
}

/** Used by tests and by anything that wants the arc table before freeze. */
export function recomputeLiveArcs(grid: ClayGrid): void {
  if (grid.uvFrozen) return;
  grid.arcOuter = computeArc(grid, 'outer');
  grid.arcInner = computeArc(grid, 'inner');
}
