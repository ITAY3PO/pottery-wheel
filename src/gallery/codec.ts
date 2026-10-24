import { clampWeight } from '../core/piece';
import type {
  Attachment,
  AttachmentKind,
  ClayGrid,
  ClayTypeId,
  FailureKind,
  MeshSurface,
  PieceState,
  StageId,
  SurfaceMap,
} from '../core/types';
import { projectPiece } from './resample';

/**
 * Share links live in the URL hash: `#p1.` plus a base64url deflate stream.
 * The payload quantizes the grid (10µm steps, predicted per ring). If that
 * hash is too long for a chat app, the grid and surface maps step down.
 */
export const SHARE_HASH_BUDGET = 3500;
/** Reject anything longer than this before base64 or inflate. */
export const SHARE_HASH_MAX_CHARS = 16_000;
/** Stop inflate once the output passes this, so a short hash cannot expand without limit. */
export const SHARE_INFLATE_MAX_BYTES = 2 * 1024 * 1024;
const HASH_PREFIX = 'p1.';
const HARD_HASH_LIMIT = SHARE_HASH_MAX_CHARS;

const CLAYS: readonly ClayTypeId[] = ['stoneware', 'porcelain', 'earthenware'];
const STAGES: readonly StageId[] = ['wet', 'leather-hard', 'bone-dry', 'bisque', 'glazed', 'glaze-fired'];
const KINDS: readonly AttachmentKind[] = ['handle', 'coil', 'sculpt'];

const FLAG_ON_WHEEL = 1;
const FLAG_UV_FROZEN = 2;
const FLAG_TORN = 4;
const FLAG_ARC = 8;

const SURF_GLAZE = 1;
const SURF_THICK = 2;
const SURF_WAX = 4;
const SURF_UNDER = 8;

const UNIT_BASE = 1e-5;
const POINT_UNIT = 1e-4;

export interface EncodedShare {
  hash: string;
  /** True when rings, segments, or surface maps were reduced so the link would fit. */
  degraded: boolean;
  /** True when the shortest encoding is still over `maxChars`. */
  oversize: boolean;
  rings: number;
  segments: number;
}

export async function encodeShare(
  piece: PieceState,
  options?: { maxChars?: number },
): Promise<EncodedShare | null> {
  if (!canCompress() || !piece?.grid || piece.grid.rings < 2 || piece.grid.segments < 3) return null;
  const budget = options?.maxChars ?? SHARE_HASH_BUDGET;
  const grids = gridSteps(piece.grid.rings, piece.grid.segments);
  const surfaces = surfaceSteps(piece);
  let best: EncodedShare | null = null;

  for (const [rings, segments] of grids) {
    for (const surfaceEdge of surfaces) {
      const view = projectPiece(piece, rings, segments, surfaceEdge);
      const payload = packPiece(view);
      if (!payload) continue;
      let compressed: Uint8Array;
      try {
        compressed = await deflateRaw(payload);
      } catch {
        continue;
      }
      const hash = HASH_PREFIX + bytesToBase64Url(compressed);
      const degraded = rings !== piece.grid.rings || segments !== piece.grid.segments || surfaceEdge != null;
      const encoded: EncodedShare = {
        hash,
        degraded,
        oversize: hash.length > budget,
        rings,
        segments,
      };
      if (!best || hash.length < best.hash.length) best = encoded;
      if (hash.length <= budget) return encoded;
    }
  }

  if (!best || best.hash.length > HARD_HASH_LIMIT) return null;
  return best;
}

export async function decodeShare(input: string): Promise<PieceState | null> {
  if (!canCompress()) return null;
  const hash = hashPayload(input);
  if (!hash || HASH_PREFIX.length + hash.length > SHARE_HASH_MAX_CHARS) return null;
  try {
    const compressed = base64UrlToBytes(hash);
    const payload = await inflateRaw(compressed, SHARE_INFLATE_MAX_BYTES);
    if (!payload) return null;
    return unpackPiece(payload);
  } catch {
    return null;
  }
}

export function withShareHash(pageUrl: string, hash: string): string {
  const url = new URL(pageUrl);
  url.hash = hash.replace(/^#/, '');
  return url.href;
}

function hashPayload(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hash = trimmed.includes('#') ? trimmed.slice(trimmed.indexOf('#') + 1) : trimmed.replace(/^#/, '');
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const payload = hash.slice(HASH_PREFIX.length);
  return payload.length > 0 ? payload : null;
}

function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

function gridSteps(rings: number, segments: number): Array<[number, number]> {
  const steps: Array<[number, number]> = [[rings, segments]];
  let r = rings;
  let s = segments;
  while (r > 24 || s > 16) {
    const nextR = Math.max(24, Math.round(r / 2));
    const nextS = Math.max(16, Math.round(s / 2));
    if (nextR === r && nextS === s) break;
    r = nextR;
    s = nextS;
    steps.push([r, s]);
  }
  if (r > 12 || s > 12) steps.push([Math.min(r, 12), Math.min(s, 12)]);
  return dedupeSteps(steps);
}

function dedupeSteps(steps: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const step of steps) {
    const key = `${step[0]}x${step[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(step);
  }
  return out;
}

function surfaceSteps(piece: PieceState): Array<number | null> {
  if (piece.surfaces.length === 0) return [null];
  let maxDim = 0;
  for (const surface of piece.surfaces) maxDim = Math.max(maxDim, surface.map.width, surface.map.height);
  const steps: Array<number | null> = [null];
  for (const edge of [64, 32, 16]) {
    if (edge < maxDim) steps.push(edge);
  }
  steps.push(0);
  return steps;
}

class Writer {
  private buf = new Uint8Array(256);
  private n = 0;

  u8(value: number): void {
    this.grow(1);
    this.buf[this.n++] = value & 0xff;
  }

  u16(value: number): void {
    this.grow(2);
    const v = value & 0xffff;
    this.buf[this.n++] = v & 0xff;
    this.buf[this.n++] = (v >> 8) & 0xff;
  }

  u32(value: number): void {
    this.grow(4);
    const v = value >>> 0;
    this.buf[this.n++] = v & 0xff;
    this.buf[this.n++] = (v >> 8) & 0xff;
    this.buf[this.n++] = (v >> 16) & 0xff;
    this.buf[this.n++] = (v >> 24) & 0xff;
  }

  i16(value: number): void {
    let v = Math.max(-32768, Math.min(32767, Math.round(value)));
    if (v < 0) v += 65536;
    this.u16(v);
  }

  bytes(data: Uint8Array): void {
    this.grow(data.length);
    this.buf.set(data, this.n);
    this.n += data.length;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.n);
  }

  private grow(extra: number): void {
    if (this.n + extra <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.n + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
  }
}

class Reader {
  private o = 0;

  constructor(private readonly buf: Uint8Array) {}

  u8(): number {
    if (this.o >= this.buf.length) throw new Error('eof');
    return this.buf[this.o++] ?? 0;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24)) >>> 0;
  }

  i8(): number {
    const v = this.u8();
    return v > 127 ? v - 256 : v;
  }

  i16(): number {
    const v = this.u16();
    return v > 32767 ? v - 65536 : v;
  }

  bytes(length: number): Uint8Array {
    if (length < 0 || this.o + length > this.buf.length) throw new Error('eof');
    const out = this.buf.slice(this.o, this.o + length);
    this.o += length;
    return out;
  }
}

interface QuantRing {
  mode: 0 | 1 | 2;
  outer: number[];
  inner: number[];
}

function packPiece(piece: PieceState): Uint8Array | null {
  const clay = CLAYS.indexOf(piece.clayTypeId);
  const stage = STAGES.indexOf(piece.stage);
  if (clay < 0 || stage < 0) return null;
  const grid = piece.grid;
  if (grid.rings > 400 || grid.segments > 200 || grid.rings < 2 || grid.segments < 3) return null;

  const unitScale = radiusScale(grid);
  const unit = unitScale * UNIT_BASE;
  const yq = quantizeHeights(grid, unit);
  const rings: QuantRing[] = [];
  for (let r = 0; r < grid.rings; r++) rings.push(quantizeRing(grid, r, unit));

  let torn = false;
  for (let i = 0; i < grid.torn.length; i++) {
    if (grid.torn[i]) {
      torn = true;
      break;
    }
  }
  const arcs = grid.arcOuter && grid.arcInner && grid.arcOuter.length === grid.rings && grid.arcInner.length === grid.rings;
  let flags = 0;
  if (piece.onWheel) flags |= FLAG_ON_WHEEL;
  if (grid.uvFrozen) flags |= FLAG_UV_FROZEN;
  if (torn) flags |= FLAG_TORN;
  if (arcs) flags |= FLAG_ARC;

  const idBytes = new TextEncoder().encode(piece.id).slice(0, 80);
  const w = new Writer();
  w.u8(1);
  w.u8(clay);
  w.u8(stage);
  w.u8(flags);
  w.u8(Math.max(0, Math.min(255, Math.round(clampWeight(piece.weightKg) * 10))));
  w.u8(Math.max(0, Math.min(255, Math.round(clamp01(piece.speedSetting) * 255))));
  w.u16(grid.rings);
  w.u16(grid.segments);
  w.u8(unitScale);
  w.u8(piece.grid.failure === 'torn' ? 1 : piece.grid.failure === 'slumped' ? 2 : 0);
  w.u16(Math.max(0, Math.min(65535, Math.round(grid.stress * 100))));
  w.u32(Math.max(0, Math.min(0xffffffff, Math.round(piece.createdAt / 1000))));
  w.u32(Math.max(0, Math.min(0xffffffff, Math.round(piece.updatedAt / 1000))));
  w.u8(idBytes.length);
  w.bytes(idBytes);

  for (const y of yq) w.u16(y);
  for (let r = 0; r < grid.rings; r++) w.u8(Math.max(0, Math.min(255, Math.round(clamp01(grid.moisture[r] ?? 0) * 255))));
  for (const ring of rings) w.u8(ring.mode);
  for (const ring of rings) writeRing(w, ring);

  if (torn) w.bytes(packBits(grid.torn));
  if (arcs && grid.arcOuter && grid.arcInner) {
    for (let r = 0; r < grid.rings; r++) w.u16(Math.round(clamp01(grid.arcOuter[r] ?? 0) * 65535));
    for (let r = 0; r < grid.rings; r++) w.u16(Math.round(clamp01(grid.arcInner[r] ?? 0) * 65535));
  }

  const attachments = piece.attachments.slice(0, 32);
  w.u8(attachments.length);
  for (const attachment of attachments) writeAttachment(w, attachment);

  const surfaces = piece.surfaces.slice(0, 8).filter((surface) => surface.map.width > 0 && surface.map.height > 0 && surface.map.width <= 256 && surface.map.height <= 256);
  w.u8(surfaces.length);
  for (const surface of surfaces) writeSurface(w, surface);
  return w.finish();
}

function writeRing(w: Writer, ring: QuantRing): void {
  if (ring.mode === 0) {
    w.u16(ring.outer[0] ?? 0);
    w.u16(ring.inner[0] ?? 0);
    return;
  }
  if (ring.mode === 1) {
    w.u16(ring.outer[0] ?? 0);
    w.u16(ring.inner[0] ?? 0);
    for (let s = 1; s < ring.outer.length; s++) w.u8((ring.outer[s] ?? 0) - (ring.outer[s - 1] ?? 0));
    for (let s = 1; s < ring.inner.length; s++) w.u8((ring.inner[s] ?? 0) - (ring.inner[s - 1] ?? 0));
    return;
  }
  for (const value of ring.outer) w.u16(value);
  for (const value of ring.inner) w.u16(value);
}

function writeAttachment(w: Writer, attachment: Attachment): void {
  const kind = Math.max(0, KINDS.indexOf(attachment.kind));
  const id = new TextEncoder().encode(attachment.id).slice(0, 80);
  const points = attachment.points.slice(0, 64);
  w.u8(kind);
  w.u8(Math.round((Math.max(0, Math.min(0.45, attachment.joinBlend)) / 0.45) * 255));
  w.u8(Math.max(0, Math.min(255, Math.round(attachment.tubularSegments))));
  w.u8(Math.max(0, Math.min(255, Math.round(attachment.radialSegments))));
  w.u8(id.length);
  w.bytes(id);
  w.u8(points.length);
  for (const point of points) {
    w.i16(point.x / POINT_UNIT);
    w.i16(point.y / POINT_UNIT);
    w.i16(point.z / POINT_UNIT);
    w.i16(point.radius / POINT_UNIT);
  }
}

function writeSurface(w: Writer, surface: MeshSurface): void {
  const map = surface.map;
  const n = map.width * map.height;
  const id = new TextEncoder().encode(surface.meshId).slice(0, 80);
  const glaze = channelBytes(map.glazeId, n);
  const under = channelBytes(map.underglazeId, n);
  const thick = thicknessBytes(map.thickness, n);
  const wax = map.wax.length === n && hasByte(map.wax) ? packBits(map.wax) : null;
  let flags = 0;
  if (glaze) flags |= SURF_GLAZE;
  if (thick) flags |= SURF_THICK;
  if (wax) flags |= SURF_WAX;
  if (under) flags |= SURF_UNDER;
  w.u8(id.length);
  w.bytes(id);
  w.u16(map.width);
  w.u16(map.height);
  w.u8(flags);
  if (glaze) w.bytes(glaze);
  if (thick) w.bytes(thick);
  if (wax) w.bytes(wax);
  if (under) w.bytes(under);
}

function channelBytes(data: Uint8Array, n: number): Uint8Array | null {
  if (data.length !== n || !hasByte(data)) return null;
  return data.slice(0, n);
}

function thicknessBytes(data: Float32Array, n: number): Uint8Array | null {
  if (data.length !== n) return null;
  const out = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const q = Math.max(0, Math.min(255, Math.round((data[i] ?? 0) * 10)));
    if (q) any = true;
    out[i] = q;
  }
  return any ? out : null;
}

function hasByte(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) if (data[i]) return true;
  return false;
}

function radiusScale(grid: ClayGrid): number {
  let max = 0;
  for (let i = 0; i < grid.y.length; i++) max = Math.max(max, grid.y[i] ?? 0);
  for (let i = 0; i < grid.outer.length; i++) {
    max = Math.max(max, grid.outer[i] ?? 0, grid.inner[i] ?? 0);
  }
  const scale = Math.ceil(max / (65535 * UNIT_BASE));
  return Math.max(1, Math.min(255, scale || 1));
}

function quantizeHeights(grid: ClayGrid, unit: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < grid.rings; r++) {
    let q = Math.max(0, Math.min(65535, Math.round((grid.y[r] ?? 0) / unit)));
    if (r > 0 && q < (out[r - 1] ?? 0)) q = out[r - 1] ?? 0;
    out.push(q);
  }
  return out;
}

function quantizeRing(grid: ClayGrid, ring: number, unit: number): QuantRing {
  const outer: number[] = [];
  const inner: number[] = [];
  for (let s = 0; s < grid.segments; s++) {
    const index = ring * grid.segments + s;
    const o = Math.max(0, Math.min(65535, Math.round((grid.outer[index] ?? 0) / unit)));
    const i = Math.max(0, Math.min(o, Math.round((grid.inner[index] ?? 0) / unit)));
    outer.push(o);
    inner.push(i);
  }
  if (outer.every((value) => value === outer[0]) && inner.every((value) => value === inner[0])) {
    return { mode: 0, outer, inner };
  }
  let delta = true;
  for (let s = 1; s < outer.length; s++) {
    if (Math.abs((outer[s] ?? 0) - (outer[s - 1] ?? 0)) > 127) delta = false;
    if (Math.abs((inner[s] ?? 0) - (inner[s - 1] ?? 0)) > 127) delta = false;
  }
  return { mode: delta ? 1 : 2, outer, inner };
}

function packBits(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(data.length / 8));
  for (let i = 0; i < data.length; i++) {
    if (data[i]) out[i >> 3] = (out[i >> 3] ?? 0) | (1 << (i & 7));
  }
  return out;
}

function unpackPiece(buf: Uint8Array): PieceState | null {
  const r = new Reader(buf);
  if (r.u8() !== 1) return null;
  const clay = CLAYS[r.u8()];
  const stage = STAGES[r.u8()];
  if (!clay || !stage) return null;
  const flags = r.u8();
  const weightKg = clampWeight(r.u8() / 10);
  const speedSetting = r.u8() / 255;
  const rings = r.u16();
  const segments = r.u16();
  const scale = r.u8() || 1;
  const failureByte = r.u8();
  const stress = r.u16() / 100;
  const createdAt = r.u32() * 1000;
  const updatedAt = r.u32() * 1000;
  const idLen = r.u8();
  const id = new TextDecoder().decode(r.bytes(idLen)) || `shared-${createdAt}`;
  if (rings < 2 || rings > 400 || segments < 3 || segments > 200) return null;

  const unit = scale * UNIT_BASE;
  const y = new Float32Array(rings);
  let previousY = 0;
  for (let ring = 0; ring < rings; ring++) {
    let height = r.u16() * unit;
    if (height < previousY) height = previousY;
    y[ring] = height;
    previousY = height;
  }
  const moisture = new Float32Array(rings);
  for (let ring = 0; ring < rings; ring++) moisture[ring] = r.u8() / 255;

  const modes: number[] = [];
  for (let ring = 0; ring < rings; ring++) modes.push(r.u8());
  const count = rings * segments;
  const outer = new Float32Array(count);
  const inner = new Float32Array(count);
  for (let ring = 0; ring < rings; ring++) {
    const mode = modes[ring];
    if (mode !== 0 && mode !== 1 && mode !== 2) return null;
    readRing(r, mode ?? 0, segments, unit, outer, inner, ring);
  }

  const torn = new Uint8Array(count);
  if (flags & FLAG_TORN) {
    const bits = r.bytes(Math.ceil(count / 8));
    for (let i = 0; i < count; i++) torn[i] = (bits[i >> 3] ?? 0) & (1 << (i & 7)) ? 1 : 0;
  }

  let arcOuter: Float32Array | null = null;
  let arcInner: Float32Array | null = null;
  if (flags & FLAG_ARC) {
    arcOuter = new Float32Array(rings);
    arcInner = new Float32Array(rings);
    for (let ring = 0; ring < rings; ring++) arcOuter[ring] = r.u16() / 65535;
    for (let ring = 0; ring < rings; ring++) arcInner[ring] = r.u16() / 65535;
  }

  const attachmentCount = r.u8();
  if (attachmentCount > 32) return null;
  const attachments: Attachment[] = [];
  for (let i = 0; i < attachmentCount; i++) {
    const attachment = readAttachment(r);
    if (!attachment) return null;
    attachments.push(attachment);
  }

  const surfaceCount = r.u8();
  if (surfaceCount > 8) return null;
  const surfaces: MeshSurface[] = [];
  for (let i = 0; i < surfaceCount; i++) {
    const surface = readSurface(r);
    if (!surface) return null;
    surfaces.push(surface);
  }

  const failure: FailureKind | null = failureByte === 1 ? 'torn' : failureByte === 2 ? 'slumped' : null;
  const grid: ClayGrid = {
    rings,
    segments,
    y,
    outer,
    inner,
    moisture,
    torn,
    arcOuter,
    arcInner,
    uvFrozen: (flags & FLAG_UV_FROZEN) !== 0,
    stress,
    failure,
    revision: 1,
  };
  return {
    version: 1,
    id,
    clayTypeId: clay,
    weightKg,
    stage,
    onWheel: (flags & FLAG_ON_WHEEL) !== 0,
    grid,
    attachments,
    surfaces,
    speedSetting,
    createdAt: createdAt || Date.now(),
    updatedAt: updatedAt || createdAt || Date.now(),
  };
}

function readRing(
  r: Reader,
  mode: number,
  segments: number,
  unit: number,
  outer: Float32Array,
  inner: Float32Array,
  ring: number,
): void {
  const base = ring * segments;
  if (mode === 0) {
    const o = Math.min(65535, r.u16()) * unit;
    const i = Math.min(o, r.u16() * unit);
    outer.fill(o, base, base + segments);
    inner.fill(i, base, base + segments);
    return;
  }
  if (mode === 1) {
    let o = r.u16();
    let i = r.u16();
    const oq = [o];
    const iq = [Math.min(o, i)];
    for (let s = 1; s < segments; s++) {
      o = Math.max(0, Math.min(65535, o + r.i8()));
      oq.push(o);
    }
    for (let s = 1; s < segments; s++) {
      i = Math.max(0, Math.min(65535, i + r.i8()));
      iq.push(Math.min(oq[s] ?? o, i));
    }
    for (let s = 0; s < segments; s++) {
      outer[base + s] = (oq[s] ?? 0) * unit;
      inner[base + s] = (iq[s] ?? 0) * unit;
    }
    return;
  }
  for (let s = 0; s < segments; s++) outer[base + s] = r.u16() * unit;
  for (let s = 0; s < segments; s++) {
    const o = outer[base + s] ?? 0;
    inner[base + s] = Math.min(o, r.u16() * unit);
  }
}

function readAttachment(r: Reader): Attachment | null {
  const kind = KINDS[r.u8()];
  if (!kind) return null;
  const joinBlend = (r.u8() / 255) * 0.45;
  const tubularSegments = r.u8();
  const radialSegments = r.u8();
  const id = new TextDecoder().decode(r.bytes(r.u8()));
  const count = r.u8();
  if (count > 64) return null;
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: r.i16() * POINT_UNIT,
      y: r.i16() * POINT_UNIT,
      z: r.i16() * POINT_UNIT,
      radius: Math.max(0, r.i16() * POINT_UNIT),
    });
  }
  return { id, kind, points, joinBlend, tubularSegments, radialSegments };
}

function readSurface(r: Reader): MeshSurface | null {
  const meshId = new TextDecoder().decode(r.bytes(r.u8()));
  const width = r.u16();
  const height = r.u16();
  if (width < 1 || height < 1 || width > 256 || height > 256) return null;
  const n = width * height;
  const flags = r.u8();
  const map: SurfaceMap = {
    width,
    height,
    glazeId: new Uint8Array(n),
    thickness: new Float32Array(n),
    wax: new Uint8Array(n),
    underglazeId: new Uint8Array(n),
  };
  if (flags & SURF_GLAZE) map.glazeId.set(r.bytes(n));
  if (flags & SURF_THICK) {
    const bytes = r.bytes(n);
    for (let i = 0; i < n; i++) map.thickness[i] = (bytes[i] ?? 0) / 10;
  }
  if (flags & SURF_WAX) {
    const bits = r.bytes(Math.ceil(n / 8));
    for (let i = 0; i < n; i++) map.wax[i] = (bits[i >> 3] ?? 0) & (1 << (i & 7)) ? 1 : 0;
  }
  if (flags & SURF_UNDER) map.underglazeId.set(r.bytes(n));
  return { meshId, map };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(data: Uint8Array, maxBytes: number): Promise<Uint8Array | null> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
