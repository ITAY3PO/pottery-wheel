import type { ClayGrid } from '../core/types';

export const CLAY_RINGS = 160;
export const CLAY_SEGMENTS = 72;

export function clayIndex(ring: number, segment: number, segments: number): number {
  return ring * segments + segment;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

/** Volume of one vertical interval between ring and ring+1, in cubic meters. */
export function intervalVolume(grid: ClayGrid, ring: number): number {
  if (ring < 0 || ring >= grid.rings - 1) return 0;
  const dh = grid.y[ring + 1] - grid.y[ring];
  if (dh <= 0) return 0;
  const dTheta = (Math.PI * 2) / grid.segments;
  let volume = 0;
  for (let s = 0; s < grid.segments; s++) {
    const o0 = grid.outer[clayIndex(ring, s, grid.segments)];
    const o1 = grid.outer[clayIndex(ring + 1, s, grid.segments)];
    const i0 = Math.min(grid.inner[clayIndex(ring, s, grid.segments)], o0);
    const i1 = Math.min(grid.inner[clayIndex(ring + 1, s, grid.segments)], o1);
    const outer = o0 * o0 + o0 * o1 + o1 * o1;
    const inner = i0 * i0 + i0 * i1 + i1 * i1;
    volume += (dTheta * 0.5 * dh * (outer - inner)) / 3;
  }
  return volume;
}

export function volume(grid: ClayGrid): number {
  let total = 0;
  for (let r = 0; r < grid.rings - 1; r++) total += intervalVolume(grid, r);
  return total;
}

export function volumeBetween(grid: ClayGrid, ring0: number, ring1: number): number {
  let total = 0;
  const end = Math.min(grid.rings - 1, ring1);
  for (let r = Math.max(0, ring0); r < end; r++) total += intervalVolume(grid, r);
  return total;
}

export function pieceHeight(grid: ClayGrid): number {
  return grid.y[grid.rings - 1] - grid.y[0];
}

export function meanChannel(data: Float32Array, ring: number, segments: number): number {
  let sum = 0;
  const base = ring * segments;
  for (let s = 0; s < segments; s++) sum += data[base + s];
  return sum / segments;
}

export function ringAtHeight(grid: ClayGrid, height: number): number {
  if (height <= grid.y[0]) return 0;
  if (height >= grid.y[grid.rings - 1]) return grid.rings - 1;
  let lo = 0;
  let hi = grid.rings - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (grid.y[mid] < height) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(grid.y[lo - 1] - height) < Math.abs(grid.y[lo] - height)) return lo - 1;
  return lo;
}

/** Population stddev of outer radius on one ring. */
export function radialStdDev(grid: ClayGrid, ring: number): number {
  const mean = meanChannel(grid.outer, ring, grid.segments);
  let acc = 0;
  const base = ring * grid.segments;
  for (let s = 0; s < grid.segments; s++) {
    const d = grid.outer[base + s] - mean;
    acc += d * d;
  }
  return Math.sqrt(acc / grid.segments);
}

/**
 * 1 when the mid-body is round, 0 when it is badly off-center.
 * A fresh lump starts near 0.
 */
export function centeredness(grid: ClayGrid): number {
  const r0 = Math.floor(grid.rings * 0.28);
  const r1 = Math.floor(grid.rings * 0.75);
  let acc = 0;
  let n = 0;
  for (let r = r0; r <= r1; r += 2) {
    const mean = Math.max(0.004, meanChannel(grid.outer, r, grid.segments));
    acc += radialStdDev(grid, r) / mean;
    n++;
  }
  const avg = n === 0 ? 0 : acc / n;
  return clamp(1 - avg / 0.075, 0, 1);
}

export function maxOuterAtRing(grid: ClayGrid, ring: number): number {
  let max = 0;
  const base = ring * grid.segments;
  for (let s = 0; s < grid.segments; s++) max = Math.max(max, grid.outer[base + s]);
  return max;
}

/**
 * Outermost clay along the camera's screen-right axis.
 * `azimuth` 0 is the side camera on +Z, where screen-right is world +X.
 */
export function profileExtent(
  grid: ClayGrid,
  height: number,
  rotation: number,
  azimuth: number,
  side: 1 | -1,
): number {
  const ring = ringAtHeight(grid, height);
  const ring2 = clamp(ring + (grid.y[ring] < height ? 1 : -1), 0, grid.rings - 1);
  const y0 = grid.y[ring];
  const y1 = grid.y[ring2];
  const span = Math.abs(y1 - y0) < 1e-6 ? 0 : clamp((height - y0) / (y1 - y0), 0, 1);
  let best = 0;
  for (let s = 0; s < grid.segments; s++) {
    const theta = (s / grid.segments) * Math.PI * 2 + rotation;
    const r0 = grid.outer[clayIndex(ring, s, grid.segments)];
    const r1 = grid.outer[clayIndex(ring2, s, grid.segments)];
    const radius = r0 + (r1 - r0) * span;
    const signed = side * radius * Math.sin(theta - azimuth);
    if (signed > best) best = signed;
  }
  return best;
}

/** Right-hand silhouette (max world +X) at a height, given the piece rotation. */
export function silhouette(grid: ClayGrid, height: number, angle: number, side: 1 | -1): number {
  return profileExtent(grid, height, angle, 0, side);
}

export function segmentAtWorldAngle(rotation: number, worldAngle: number, segments: number): number {
  let local = worldAngle - rotation;
  local = ((local % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round((local / (Math.PI * 2)) * segments) % segments;
}

/**
 * Segments that pass under a finger this frame.
 * Stopped: a thumb-sized arc. Spinning: the arc swept by omega * dt.
 */
export function eachContacted(
  segments: number,
  contact: number,
  omega: number,
  dt: number,
  fn: (segment: number, weight: number) => void,
): void {
  const speed = Math.abs(omega);
  if (speed < 0.45) {
    const thumb = Math.max(1, Math.round(segments * 0.07));
    for (let k = -thumb; k <= thumb; k++) {
      const weight = Math.cos((Math.abs(k) / (thumb + 0.001)) * Math.PI * 0.5);
      fn(wrapIndex(contact + k, segments), weight);
    }
    return;
  }
  const passed = (speed * Math.max(dt, 1 / 120)) / (Math.PI * 2) * segments;
  const count = clamp(Math.ceil(passed), 1, segments);
  const dir = omega >= 0 ? 1 : -1;
  for (let k = 0; k < count; k++) fn(wrapIndex(contact + dir * k, segments), 1);
}

export function scaleRadii(grid: ClayGrid, factor: number, ring0 = 0, ring1 = grid.rings): void {
  const end = Math.min(grid.rings, ring1);
  for (let r = Math.max(0, ring0); r < end; r++) {
    const base = r * grid.segments;
    for (let s = 0; s < grid.segments; s++) {
      grid.outer[base + s] *= factor;
      grid.inner[base + s] *= factor;
    }
  }
}

export function scaleGaps(grid: ClayGrid, anchorRing: number, factor: number): void {
  const anchor = clamp(anchorRing, 0, grid.rings - 1);
  const gaps: number[] = [];
  for (let r = anchor; r < grid.rings - 1; r++) gaps.push(grid.y[r + 1] - grid.y[r]);
  let y = grid.y[anchor];
  const minGap = 0.00035;
  for (let i = 0; i < gaps.length; i++) {
    y += Math.max(minGap, gaps[i] * factor);
    grid.y[anchor + 1 + i] = y;
  }
}

/** Grow or shrink the gaps above `anchorRing` until volume matches `target`. */
export function conserveByHeight(grid: ClayGrid, anchorRing: number, target: number): void {
  const anchor = clamp(anchorRing, 0, grid.rings - 2);
  const below = volumeBetween(grid, 0, anchor);
  const above = volumeBetween(grid, anchor, grid.rings - 1);
  if (above < 1e-10) {
    conserveByRadius(grid, target);
    return;
  }
  const factor = clamp((target - below) / above, 0.22, 4.5);
  scaleGaps(grid, anchor, factor);
  const now = volume(grid);
  if (now > 1e-12 && Math.abs(now - target) / target > 0.004) {
    scaleRadii(grid, Math.sqrt(target / now));
  }
}

/** Uniform radius scale so the frustum volume hits `target` exactly. */
export function conserveByRadius(grid: ClayGrid, target: number, ring0 = 0, ring1 = grid.rings): void {
  const now = volume(grid);
  if (now < 1e-12 || target <= 0) return;
  const factor = Math.sqrt(target / now);
  if (Math.abs(factor - 1) < 0.0004) return;
  // A global correction is exact for the quadratic frustum formula and keeps
  // the shape we just carved. Upper-only corrections are used by compress.
  if (ring0 <= 0 && ring1 >= grid.rings) {
    scaleRadii(grid, factor);
    return;
  }
  // Newton on the upper radii: a few passes, the response is nearly quadratic.
  let guard = 0;
  while (guard++ < 8) {
    const current = volume(grid);
    if (Math.abs(current - target) / target < 0.003) break;
    const step = clamp(Math.sqrt(target / current), 0.86, 1.16);
    scaleRadii(grid, step, ring0, ring1);
  }
}

export function sanitizeGrid(grid: ClayGrid): void {
  const segs = grid.segments;
  for (let r = 0; r < grid.rings; r++) {
    if (r > 0 && grid.y[r] < grid.y[r - 1] + 0.0003) grid.y[r] = grid.y[r - 1] + 0.0003;
    const base = r * segs;
    for (let s = 0; s < segs; s++) {
      let inner = grid.inner[base + s];
      let outer = grid.outer[base + s];
      if (inner < 0) inner = 0;
      if (outer < 0.001) outer = 0.001;
      if (outer > 0.2) outer = 0.2;
      if (inner > outer) inner = outer;
      grid.inner[base + s] = inner;
      grid.outer[base + s] = outer;
    }
  }
  const maxH = 0.28;
  const h = pieceHeight(grid);
  if (h > maxH && h > 0) {
    const anchor = grid.y[0];
    const factor = maxH / h;
    for (let r = 1; r < grid.rings; r++) grid.y[r] = anchor + (grid.y[r] - anchor) * factor;
  }
}

function polarRadius(radius: number, shift: number, theta: number): number {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const disc = radius * radius - shift * shift * s * s;
  if (disc <= 0) return radius;
  return shift * c + Math.sqrt(disc);
}

export interface CreateGridOptions {
  rings?: number;
  segments?: number;
  /** Center offset as a fraction of radius. 0 is already round. */
  wobble?: number;
}

/** A throwing lump: domed cylinder, slightly off-center, volume matched exactly. */
export function createClayGrid(volumeM3: number, options: CreateGridOptions = {}): ClayGrid {
  const rings = options.rings ?? CLAY_RINGS;
  const segments = options.segments ?? CLAY_SEGMENTS;
  const wobble = options.wobble ?? 0.16;
  const aspect = 0.92;
  const baseRadius = Math.cbrt(volumeM3 / (Math.PI * aspect * 0.82));
  const height = aspect * baseRadius;
  const shift = baseRadius * wobble;

  const grid = allocateGrid(rings, segments);
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    grid.y[r] = height * t;
    let profile = baseRadius;
    if (t > 0.7) {
      const u = (t - 0.7) / 0.3;
      const dome = (1 - Math.cos(u * Math.PI)) * 0.5;
      profile = baseRadius * (1 - 0.58 * dome);
    }
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const dent = baseRadius * 0.028 * Math.exp(-((theta - 2.1) ** 2) / 0.18);
      const radius = Math.max(0.004, polarRadius(profile, shift, theta) - dent);
      grid.outer[clayIndex(r, s, segments)] = radius;
      grid.inner[clayIndex(r, s, segments)] = 0;
    }
  }
  const current = volume(grid);
  if (current > 0) {
    const k = Math.cbrt(volumeM3 / current);
    for (let r = 0; r < rings; r++) grid.y[r] *= k;
    scaleRadii(grid, k);
  }
  grid.revision = 1;
  return grid;
}

/** Straight test cylinder. `innerRadius` opens every ring above `floor`. */
export function createCylinderGrid(options: {
  rings?: number;
  segments?: number;
  radius: number;
  height: number;
  innerRadius?: number;
  floor?: number;
}): ClayGrid {
  const rings = options.rings ?? 40;
  const segments = options.segments ?? 24;
  const grid = allocateGrid(rings, segments);
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    grid.y[r] = options.height * t;
    const hollow = options.innerRadius != null && grid.y[r] >= (options.floor ?? 0);
    for (let s = 0; s < segments; s++) {
      grid.outer[clayIndex(r, s, segments)] = options.radius;
      grid.inner[clayIndex(r, s, segments)] = hollow ? options.innerRadius! : 0;
    }
  }
  grid.revision = 1;
  return grid;
}

export function allocateGrid(rings: number, segments: number): ClayGrid {
  const n = rings * segments;
  const moisture = new Float32Array(rings);
  moisture.fill(1);
  return {
    rings,
    segments,
    y: new Float32Array(rings),
    outer: new Float32Array(n),
    inner: new Float32Array(n),
    moisture,
    torn: new Uint8Array(n),
    arcOuter: null,
    arcInner: null,
    uvFrozen: false,
    stress: 0,
    failure: null,
    revision: 0,
  };
}

let arcScratchOuter: Float32Array | null = null;
let arcScratchInner: Float32Array | null = null;
let radiiScratch: Float32Array | null = null;

function scratchArc(channel: 'outer' | 'inner', rings: number): Float32Array {
  if (channel === 'outer') {
    if (!arcScratchOuter || arcScratchOuter.length < rings) arcScratchOuter = new Float32Array(rings);
    return arcScratchOuter;
  }
  if (!arcScratchInner || arcScratchInner.length < rings) arcScratchInner = new Float32Array(rings);
  return arcScratchInner;
}

/** Mean-radius arc length, normalized 0..1, written into `out` (length >= rings). */
export function computeArcInto(grid: ClayGrid, channel: 'outer' | 'inner', out: Float32Array): void {
  const data = channel === 'outer' ? grid.outer : grid.inner;
  if (!radiiScratch || radiiScratch.length < grid.rings) radiiScratch = new Float32Array(grid.rings);
  const radii = radiiScratch;
  for (let r = 0; r < grid.rings; r++) radii[r] = meanChannel(data, r, grid.segments);
  let length = 0;
  out[0] = 0;
  for (let r = 1; r < grid.rings; r++) {
    const dr = radii[r] - radii[r - 1];
    const dy = grid.y[r] - grid.y[r - 1];
    length += Math.hypot(dr, dy);
    out[r] = length;
  }
  if (length < 1e-8) {
    const denom = grid.rings - 1 || 1;
    for (let r = 0; r < grid.rings; r++) out[r] = r / denom;
    return;
  }
  for (let r = 0; r < grid.rings; r++) out[r] /= length;
}

/** Mean-radius arc length, normalized 0..1, one owned sample per ring. */
export function computeArc(grid: ClayGrid, channel: 'outer' | 'inner'): Float32Array {
  const arc = new Float32Array(grid.rings);
  computeArcInto(grid, channel, arc);
  return arc;
}

/**
 * Live arc table. The returned array is reused on the next call for that
 * channel, so callers read it immediately and do not store it. Frozen arcs
 * are the piece's own buffers and stay put.
 */
export function currentArc(grid: ClayGrid, channel: 'outer' | 'inner'): Float32Array {
  if (grid.uvFrozen) {
    const frozen = channel === 'outer' ? grid.arcOuter : grid.arcInner;
    if (frozen && frozen.length === grid.rings) return frozen;
  }
  const arc = scratchArc(channel, grid.rings);
  computeArcInto(grid, channel, arc);
  return arc;
}

/** Freeze profile UVs. Called when the piece leaves the wheel. */
export function freezeProfile(grid: ClayGrid): void {
  grid.arcOuter = computeArc(grid, 'outer');
  grid.arcInner = computeArc(grid, 'inner');
  grid.uvFrozen = true;
  grid.revision++;
}

/** Linear shrink. Used by drying and firing, not by throwing (volume is conserved there). */
export function scaleGrid(grid: ClayGrid, factor: number): void {
  if (factor === 1) return;
  for (let r = 0; r < grid.rings; r++) grid.y[r] *= factor;
  scaleRadii(grid, factor);
  grid.revision++;
}

export function meanMoisture(grid: ClayGrid): number {
  let sum = 0;
  for (let r = 0; r < grid.rings; r++) sum += grid.moisture[r];
  return sum / grid.rings;
}

let smoothScratch: Float32Array | null = null;

export function smoothVertical(
  data: Float32Array,
  rings: number,
  segments: number,
  ring0: number,
  ring1: number,
  amount: number,
): void {
  const n = data.length;
  if (!smoothScratch || smoothScratch.length < n) smoothScratch = new Float32Array(n);
  smoothScratch.set(data);
  const rStart = Math.max(1, ring0);
  const rEnd = Math.min(rings - 2, ring1);
  for (let r = rStart; r <= rEnd; r++) {
    for (let s = 0; s < segments; s++) {
      const i = clayIndex(r, s, segments);
      const a = data[clayIndex(r - 1, s, segments)];
      const c = data[clayIndex(r + 1, s, segments)];
      smoothScratch[i] = data[i] + ((a + c) * 0.5 - data[i]) * amount;
    }
  }
  data.set(smoothScratch.subarray(0, n));
}

export function touchGrid(grid: ClayGrid): void {
  grid.revision++;
}
