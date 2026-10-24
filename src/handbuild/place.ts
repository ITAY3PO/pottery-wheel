import type { ToolContext } from '../core/types';
import { PIECE_LIFT, pointOnOuter, radiusFor, type Vec3 } from './spline';

/**
 * Placement reads the core tool hit fields on `ToolContext`:
 * - `surfaceHit` — `{ meshId, u, v, point, normal }`. `point` and `normal`
 *   are piece-local (Y up, origin at the bat). Body `u` is angle and `v` is
 *   profile arc. A missing hit still draws from the pointer.
 * - `raycaster` — camera ray through the pointer. `ray` is accepted too, as a
 *   Three.js `Ray` (`origin`, `direction`) or a `Raycaster` (`ray`).
 * - `markSurfaceDirty(meshId)` — refresh that mesh's surface textures.
 * The drawing ray is world space. The surface hit is already piece-local.
 */
export interface HandHit {
  meshId: string;
  u: number;
  v: number;
  point?: Vec3;
  normal?: Vec3;
}

export interface HandRay {
  origin: Vec3;
  direction: Vec3;
}

export interface Sample {
  /** Piece-local point in the air, on the plane facing the camera. */
  air: Vec3;
  /** Piece-local point on the outer wall when the finger hit the body. */
  body: Vec3 | null;
  /** Piece-local surface hit from `surfaceHit.point`. */
  contact: Vec3 | null;
  meshId: string | null;
  /** Piece-local face normal when the hit carried one. */
  normal: Vec3 | null;
  pressure: number;
}

interface HitContext {
  surfaceHit?: unknown;
  /** Older alias. The live field is `raycaster`. */
  ray?: unknown;
  raycaster?: unknown;
}

export function readHit(value: unknown): HandHit | null {
  if (!value || typeof value !== 'object') return null;
  const hit = value as Partial<HandHit> & { point?: Partial<Vec3>; normal?: Partial<Vec3> };
  const u = hit.u;
  const v = hit.v;
  if (typeof hit.meshId !== 'string' || u === undefined || v === undefined || !Number.isFinite(u) || !Number.isFinite(v)) return null;
  return {
    meshId: hit.meshId,
    u,
    v,
    point: asVec(hit.point),
    normal: asVec(hit.normal),
  };
}

export function readRay(value: unknown): HandRay | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { origin?: Partial<Vec3>; direction?: Partial<Vec3>; ray?: { origin?: Partial<Vec3>; direction?: Partial<Vec3> } };
  const nested = record.ray;
  const origin = asVec(nested?.origin) ?? asVec(record.origin);
  const direction = asVec(nested?.direction) ?? asVec(record.direction);
  if (!origin || !direction) return null;
  if (Math.hypot(direction.x, direction.y, direction.z) < 1e-8) return null;
  return { origin, direction };
}

function asVec(value: Partial<Vec3> | undefined): Vec3 | undefined {
  if (!value) return undefined;
  const x = value.x;
  const y = value.y;
  const z = value.z;
  if (x === undefined || y === undefined || z === undefined) return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined;
  return { x, y, z };
}

/** Inverse of the clay pivot: Y rotation plus the off-wheel lift. */
export function worldToPiece(world: Vec3, rotationY: number, lift: number): Vec3 {
  const x = world.x;
  const y = world.y - lift;
  const z = world.z;
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return { x: x * c - z * s, y, z: x * s + z * c };
}

export function directionToPiece(direction: Vec3, rotationY: number): Vec3 {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return { x: direction.x * c - direction.z * s, y: direction.y, z: direction.x * s + direction.z * c };
}

/** Intersect the ray with the vertical plane through the wheel axis that faces the camera. */
export function drawingPlanePoint(ray: HandRay): Vec3 | null {
  const flat = Math.hypot(ray.origin.x, ray.origin.z);
  if (flat < 1e-5) return null;
  const nx = ray.origin.x / flat;
  const nz = ray.origin.z / flat;
  const denom = nx * ray.direction.x + nz * ray.direction.z;
  if (Math.abs(denom) < 1e-6) return null;
  const t = -(nx * ray.origin.x + nz * ray.origin.z) / denom;
  if (!Number.isFinite(t) || t < 0) return null;
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: ray.origin.z + ray.direction.z * t,
  };
}

export function pieceLift(onWheel: boolean): number {
  return onWheel ? 0 : PIECE_LIFT;
}

export function placeSample(ctx: ToolContext): Sample | null {
  const extra = ctx as ToolContext & HitContext;
  const hit = readHit(extra.surfaceHit);
  const ray = readRay(extra.ray) ?? readRay(extra.raycaster);
  const lift = pieceLift(ctx.piece.onWheel);
  const rotation = ctx.wheel.angle;
  const tube = radiusFor('handle', ctx.pointer.pressure);
  const plane = ray ? drawingPlanePoint(ray) : null;
  const airWorld = plane ?? { x: ctx.pointer.x, y: ctx.pointer.y + lift, z: 0 };
  const air = worldToPiece(airWorld, rotation, lift);
  const body = hit?.meshId === 'body' ? pointOnOuter(ctx.piece.grid, hit.u, hit.v, tube) : null;
  // `raycastToUV` already returns piece-local copies. Rotating them again
  // would swing a handle off the wall it just hit.
  const contact = hit?.point ? { ...hit.point } : null;
  const normal = hit?.normal ? { ...hit.normal } : null;
  if (!Number.isFinite(air.x) || !Number.isFinite(air.y) || !Number.isFinite(air.z)) return null;
  return {
    air,
    body,
    contact,
    meshId: hit?.meshId ?? null,
    normal,
    pressure: ctx.pointer.pressure,
  };
}

export function markDirty(ctx: ToolContext, meshId: string): void {
  const mark = (ctx as ToolContext & { markSurfaceDirty?: (meshId: string) => void }).markSurfaceDirty;
  if (typeof mark === 'function') mark(meshId);
}
