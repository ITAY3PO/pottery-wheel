import type { SurfaceMap } from '../core/types';
import { getGlaze } from './catalog';

/** Float thickness is stored in millimeters. The byte preview tops out here. */
export const THICKNESS_BYTE_MAX_MM = 2.55;

export interface UVPoint {
  u: number;
  v: number;
}

export function brushRadius(size: number): number {
  const t = clamp01(size);
  return 0.012 + t * 0.068;
}

export function thicknessToByte(mm: number): number {
  const clamped = Math.max(0, Math.min(THICKNESS_BYTE_MAX_MM, mm));
  return Math.round((clamped / THICKNESS_BYTE_MAX_MM) * 255);
}

export function byteToThickness(byte: number): number {
  return (Math.max(0, Math.min(255, byte)) / 255) * THICKNESS_BYTE_MAX_MM;
}

export function waxBlocks(map: SurfaceMap, index: number): boolean {
  return (map.wax[index] ?? 0) > 0;
}

/** Soft disc in UV space. `u` wraps; `v` clamps. Calls `visit` with 0..1 weight. */
export function stampDisk(
  map: SurfaceMap,
  u: number,
  v: number,
  radius: number,
  visit: (index: number, weight: number) => void,
): void {
  if (!(radius > 0)) return;
  const width = map.width;
  const height = map.height;
  const cx = wrap01(u) * width;
  const cy = clamp01(v) * height;
  const rx = Math.ceil(radius * width);
  const ry = Math.ceil(radius * height);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let dy = -ry; dy <= ry; dy++) {
    const y = y0 + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -rx; dx <= rx; dx++) {
      const du = (x0 + dx + 0.5 - cx) / width;
      const dv = (y + 0.5 - cy) / height;
      const d = Math.hypot(du - Math.round(du), dv);
      if (d > radius) continue;
      const t = 1 - d / radius;
      const weight = t * t * (3 - 2 * t);
      if (weight < 0.04) continue;
      visit(y * width + mod(x0 + dx, width), weight);
    }
  }
}

export function paintWax(map: SurfaceMap, u: number, v: number, radius: number): void {
  stampDisk(map, u, v, radius, (index, weight) => {
    if (weight >= 0.35) map.wax[index] = 1;
  });
}

export function paintGlaze(
  map: SurfaceMap,
  u: number,
  v: number,
  radius: number,
  glazeId: number,
  coatMm: number,
): void {
  stampDisk(map, u, v, radius, (index, weight) => {
    deposit(map, index, glazeId, coatMm * weight);
  });
}

/** Stamps along the segment, skipping the start so a stroke does not pile up on one point. */
export function strokeWax(map: SurfaceMap, from: UVPoint, to: UVPoint, radius: number): void {
  walk(from, to, radius, (u, v) => paintWax(map, u, v, radius));
}

export function strokeGlaze(
  map: SurfaceMap,
  from: UVPoint,
  to: UVPoint,
  radius: number,
  glazeId: number,
  coatMm: number,
): void {
  walk(from, to, radius, (u, v) => paintGlaze(map, u, v, radius, glazeId, coatMm));
}

export function dipCoat(map: SurfaceMap, glazeId: number, coatMm: number, spareFoot = true): void {
  const { width, height } = map;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    if (spareFoot && v < 0.08) continue;
    const row = y * width;
    for (let x = 0; x < width; x++) deposit(map, row + x, glazeId, coatMm);
  }
}

/**
 * Rivulets from the rim. Thicker near v = 1, sparse toward the foot.
 * `seed` shifts the runs so a second pour is not a photocopy of the first.
 */
export function pourCoat(map: SurfaceMap, glazeId: number, coatMm: number, seed: number, spareFoot = true): void {
  const { width, height } = map;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    if (spareFoot && v < 0.1) continue;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const weight = pourWeight(u, v, seed);
      if (weight <= 0) continue;
      deposit(map, row + x, glazeId, coatMm * weight);
    }
  }
}

export function pourWeight(u: number, v: number, seed: number): number {
  if (v < 0.1) return 0;
  const rim = v > 0.92 ? (v - 0.92) / 0.08 : 0;
  let best = rim;
  const columns = 6;
  for (let i = 0; i < columns; i++) {
    const jitter = Math.sin(seed * 2.1 + i * 1.7) * 0.03;
    const center = wrap01((i + 0.5) / columns + seed * 0.13 + jitter);
    let du = Math.abs(u - center);
    du = Math.min(du, 1 - du);
    const width = 0.028 + 0.018 * (0.5 + 0.5 * Math.sin(seed * 4 + i));
    const band = Math.max(0, 1 - du / width);
    const reach = 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(seed * 3.3 + i * 2));
    const start = 1 - reach;
    if (v < start) continue;
    const fade = (v - start) / Math.max(1e-4, reach);
    best = Math.max(best, band * (0.4 + 0.6 * fade));
  }
  return best;
}

export function applyGlazeBrush(map: SurfaceMap, glazeId: number, u: number, v: number, radius: number): void {
  const glaze = getGlaze(glazeId);
  paintGlaze(map, u, v, radius, glaze.id, glaze.coatMm);
}

function deposit(map: SurfaceMap, index: number, glazeId: number, add: number): void {
  if (waxBlocks(map, index) || !(add > 0)) return;
  const next = Math.min(THICKNESS_BYTE_MAX_MM, (map.thickness[index] ?? 0) + add);
  map.thickness[index] = next;
  // A coat thinner than one byte reads as bare. Keeping the id off those
  // texels lets the shader treat a real zero as "texture failed" and still
  // show glaze where the CPU stored a visible coat.
  if (thicknessToByte(next) > 0) map.glazeId[index] = glazeId;
}

function walk(from: UVPoint, to: UVPoint, radius: number, stamp: (u: number, v: number) => void): void {
  const du = wrapDelta(to.u - from.u);
  const dv = to.v - from.v;
  const dist = Math.hypot(du, dv);
  if (dist < 1e-6) return;
  const step = Math.max(radius * 0.45, 1e-4);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    stamp(from.u + du * t, from.v + dv * t);
  }
}

function wrap01(value: number): number {
  return value - Math.floor(value);
}

function wrapDelta(delta: number): number {
  return delta - Math.round(delta);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
