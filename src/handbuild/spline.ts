import { clamp, clayIndex, currentArc, ringAtHeight } from '../clay/grid';
import type { AttachmentPoint, ClayGrid } from '../core/types';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const MIN_TUBE_RADIUS = 0.0022;
export const MAX_TUBE_RADIUS = 0.014;
/** Off-wheel lift of the clay pivot in the studio, in meters. */
export const PIECE_LIFT = 0.014;

export function clonePoint(point: AttachmentPoint): AttachmentPoint {
  return { x: point.x, y: point.y, z: point.z, radius: point.radius };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function lengthOf(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(v: Vec3, factor: number): Vec3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

export function normalize(v: Vec3): Vec3 | null {
  const length = lengthOf(v);
  if (length < 1e-8) return null;
  return scale(v, 1 / length);
}

export function polylineLength(points: readonly Vec3[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += lengthOf(sub(points[i], points[i - 1]));
  return length;
}

export function clampRadius(radius: number): number {
  return clamp(radius, MIN_TUBE_RADIUS, MAX_TUBE_RADIUS);
}

/** Tube radius for a sample. A harder press pinches the clay thinner. */
export function radiusFor(kind: 'handle' | 'coil' | 'sculpt', pressure: number): number {
  const base = kind === 'handle' ? 0.0068 : kind === 'coil' ? 0.0044 : 0.0055;
  return clampRadius(base * (1 - clamp(pressure, 0, 1) * 0.55));
}

export function resample(points: readonly AttachmentPoint[], count: number): AttachmentPoint[] {
  if (points.length === 0 || count <= 0) return [];
  if (points.length === 1 || count === 1) return [clonePoint(points[0])];
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + lengthOf(sub(points[i], points[i - 1])));
  const total = lengths[lengths.length - 1];
  if (total < 1e-8) return Array.from({ length: count }, () => clonePoint(points[0]));
  const out: AttachmentPoint[] = [];
  for (let i = 0; i < count; i++) {
    const distance = (i / (count - 1)) * total;
    let k = 1;
    while (k < lengths.length - 1 && lengths[k] < distance) k++;
    const span = lengths[k] - lengths[k - 1] || 1;
    const f = clamp((distance - lengths[k - 1]) / span, 0, 1);
    const a = points[k - 1];
    const b = points[k];
    out.push({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
      radius: a.radius + (b.radius - a.radius) * f,
    });
  }
  return out;
}

export function smoothOpen(points: readonly AttachmentPoint[], amount: number): AttachmentPoint[] {
  if (points.length < 3 || amount <= 0) return points.map(clonePoint);
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return clonePoint(point);
    const prev = points[index - 1];
    const next = points[index + 1];
    return {
      x: point.x * (1 - amount) + ((prev.x + next.x) * 0.5) * amount,
      y: point.y * (1 - amount) + ((prev.y + next.y) * 0.5) * amount,
      z: point.z * (1 - amount) + ((prev.z + next.z) * 0.5) * amount,
      radius: point.radius,
    };
  });
}

/** Scale every tube radius. Factor < 1 pinches the clay thinner. */
export function pinchPoints(points: readonly AttachmentPoint[], factor: number): AttachmentPoint[] {
  const scaleBy = clamp(factor, 0.35, 1.6);
  return points.map((point) => ({ ...point, radius: clampRadius(point.radius * scaleBy) }));
}

/**
 * Roll the spline around the chord from the first point to the last.
 * The ends stay put; the bow swings out of its plane.
 */
export function twistPoints(points: readonly AttachmentPoint[], radians: number): AttachmentPoint[] {
  if (points.length < 3 || Math.abs(radians) < 1e-8) return points.map(clonePoint);
  const origin = points[0];
  const axis = normalize(sub(points[points.length - 1], origin));
  if (!axis) return points.map(clonePoint);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((point) => {
    const v = sub(point, origin);
    const along = dot(v, axis);
    const cx = axis.y * v.z - axis.z * v.y;
    const cy = axis.z * v.x - axis.x * v.z;
    const cz = axis.x * v.y - axis.y * v.x;
    return {
      x: origin.x + v.x * cos + cx * sin + axis.x * along * (1 - cos),
      y: origin.y + v.y * cos + cy * sin + axis.y * along * (1 - cos),
      z: origin.z + v.z * cos + cz * sin + axis.z * along * (1 - cos),
      radius: point.radius,
    };
  });
}

/** Signed angle from `from` to `to` around `axis`, for a twist gesture. */
export function signedAngle(from: Vec3, to: Vec3, axis: Vec3): number {
  const a = normalize(from);
  const b = normalize(to);
  if (!a || !b) return 0;
  const cross = {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
  return Math.atan2(dot(cross, axis), dot(a, b));
}

export function reject(vector: Vec3, axis: Vec3): Vec3 {
  return sub(vector, scale(axis, dot(vector, axis)));
}

export function wallRadius(grid: ClayGrid, y: number, theta: number): number {
  const yClamped = clamp(y, grid.y[0], grid.y[grid.rings - 1]);
  const ring = ringAtHeight(grid, yClamped);
  let ring2 = ring;
  if (ring < grid.rings - 1 && grid.y[ring] <= yClamped) ring2 = ring + 1;
  else if (ring > 0) ring2 = ring - 1;
  const y0 = grid.y[ring];
  const y1 = grid.y[ring2];
  const span = Math.abs(y1 - y0) < 1e-8 ? 0 : clamp((yClamped - y0) / (y1 - y0), 0, 1);
  const turns = theta / (Math.PI * 2);
  const segF = (turns - Math.floor(turns)) * grid.segments;
  const s0 = Math.floor(segF) % grid.segments;
  const s1 = (s0 + 1) % grid.segments;
  const sf = segF - Math.floor(segF);
  const at = (r: number, s: number) => grid.outer[clayIndex(r, s, grid.segments)];
  const low = at(ring, s0) + (at(ring, s1) - at(ring, s0)) * sf;
  const high = at(ring2, s0) + (at(ring2, s1) - at(ring2, s0)) * sf;
  return low + (high - low) * span;
}

export function radialExcess(grid: ClayGrid, point: Vec3): number {
  return Math.hypot(point.x, point.z) - wallRadius(grid, point.y, Math.atan2(point.x, point.z));
}

export function plantOnWall(grid: ClayGrid, point: AttachmentPoint, gap: number): AttachmentPoint {
  const y = clamp(point.y, grid.y[0], grid.y[grid.rings - 1]);
  const radial = Math.hypot(point.x, point.z);
  const theta = radial < 1e-4 ? Math.PI / 2 : Math.atan2(point.x, point.z);
  const radius = Math.max(0.002, wallRadius(grid, y, theta) + gap);
  return { x: radius * Math.sin(theta), y, z: radius * Math.cos(theta), radius: point.radius };
}

export function pushOutside(grid: ClayGrid, point: AttachmentPoint, gap: number): AttachmentPoint {
  if (radialExcess(grid, point) >= gap) {
    return { ...point, y: clamp(point.y, grid.y[0], grid.y[grid.rings - 1]) };
  }
  return plantOnWall(grid, point, gap);
}

/** Piece-local point on the outer wall from body UVs (u angle, v arc length). */
export function pointOnOuter(grid: ClayGrid, u: number, v: number, tubeRadius: number): AttachmentPoint {
  const arcs = currentArc(grid, 'outer');
  const target = clamp(v, 0, 1);
  let ring = grid.rings - 1;
  for (let r = 1; r < grid.rings; r++) {
    if (arcs[r] >= target) {
      ring = r;
      break;
    }
  }
  const prev = Math.max(0, ring - 1);
  const span = (arcs[ring] ?? 1) - (arcs[prev] ?? 0) || 1;
  const f = clamp((target - (arcs[prev] ?? 0)) / span, 0, 1);
  const y = grid.y[prev] + (grid.y[ring] - grid.y[prev]) * f;
  const turns = u - Math.floor(u);
  const theta = turns * Math.PI * 2;
  const radius = wallRadius(grid, y, theta);
  return { x: radius * Math.sin(theta), y, z: radius * Math.cos(theta), radius: tubeRadius };
}

function bowDirection(points: readonly AttachmentPoint[]): Vec3 {
  let x = 0;
  let z = 0;
  for (const point of points) {
    x += point.x;
    z += point.z;
  }
  return normalize({ x, y: 0, z }) ?? { x: 1, y: 0, z: 0 };
}

function bowOut(points: readonly AttachmentPoint[], amount: number): AttachmentPoint[] {
  const dir = bowDirection(points);
  const last = points.length - 1;
  return points.map((point, index) => {
    const hump = Math.sin((index / last) * Math.PI) * amount;
    return { ...point, x: point.x + dir.x * hump, z: point.z + dir.z * hump };
  });
}

/** A pulled handle: the drawn spline, bowed off the wall when the finger stayed on it. */
export function shapeHandle(grid: ClayGrid, raw: readonly AttachmentPoint[]): AttachmentPoint[] {
  if (raw.length < 2) return raw.map(clonePoint);
  const sampled = smoothOpen(resample(raw, 14), 0.42);
  let excess = 0;
  for (let i = 1; i < sampled.length - 1; i++) excess = Math.max(excess, radialExcess(grid, sampled[i]));
  const bowed = excess > 0.008 ? sampled : bowOut(sampled, 0.02);
  return bowed.map((point, index) => {
    const end = index === 0 || index === bowed.length - 1;
    if (end) return plantOnWall(grid, point, -point.radius * 0.45);
    return pushOutside(grid, point, point.radius * 0.25);
  });
}

export function shapeCoil(grid: ClayGrid, raw: readonly AttachmentPoint[]): AttachmentPoint[] {
  if (raw.length < 2) return raw.map(clonePoint);
  const count = clamp(Math.round(polylineLength(raw) / 0.008), 6, 28);
  const sampled = resample(raw, count);
  return sampled.map((point, index) => {
    const end = index === 0 || index === sampled.length - 1;
    return plantOnWall(grid, point, end ? point.radius * 0.15 : point.radius * 0.75);
  });
}

export function shapeKnob(grid: ClayGrid, anchor: AttachmentPoint, normal: Vec3 | null): AttachmentPoint[] {
  const base = plantOnWall(grid, anchor, -0.001);
  const radial = normalize({ x: base.x, y: 0, z: base.z }) ?? { x: 1, y: 0, z: 0 };
  let n = normal ? normalize(normal) : null;
  if (!n || dot(n, radial) < 0.25) n = radial;
  const at = (distance: number, radius: number, lift: number): AttachmentPoint => ({
    x: base.x + n.x * distance,
    y: base.y + n.y * distance * 0.35 + lift,
    z: base.z + n.z * distance,
    radius,
  });
  return [{ ...base, radius: 0.009 }, at(0.008, 0.0065, 0.001), at(0.016, 0.0032, 0.002)];
}

export function shapeSprig(grid: ClayGrid, raw: readonly AttachmentPoint[]): AttachmentPoint[] {
  const sampled = resample(raw, 8);
  return sampled.map((point, index) => {
    const end = index === 0 || index === sampled.length - 1;
    const radius = end ? Math.min(point.radius, 0.0038) : Math.max(point.radius, 0.0046);
    return plantOnWall(grid, { ...point, radius }, end ? 0.001 : radius * 0.55);
  });
}

export function shapeSculpt(grid: ClayGrid, raw: readonly AttachmentPoint[], normal: Vec3 | null): AttachmentPoint[] {
  if (raw.length === 0) return [];
  if (polylineLength(raw) < 0.012) return shapeKnob(grid, raw[0], normal);
  return shapeSprig(grid, raw);
}

export function joinBlendFor(kind: 'handle' | 'coil' | 'sculpt', sculptLength: number): number {
  if (kind === 'handle') return 0.22;
  if (kind === 'coil') return 0.1;
  return sculptLength < 0.012 ? 0.3 : 0.16;
}

/** Distance from a point to a polyline, in meters. */
export function distanceToSpline(points: readonly Vec3[], point: Vec3): number {
  if (points.length === 0) return Infinity;
  let best = lengthOf(sub(point, points[0]));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const ab = sub(b, a);
    const abLen = lengthOf(ab);
    const t = abLen < 1e-8 ? 0 : clamp(dot(sub(point, a), ab) / (abLen * abLen), 0, 1);
    const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
    best = Math.min(best, lengthOf(sub(point, closest)));
  }
  return best;
}
