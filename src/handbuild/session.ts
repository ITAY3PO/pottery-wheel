import { createAttachment } from '../core/attachment';
import { canAttachHandle } from '../core/stateMachine';
import type { Attachment, AttachmentKind, AttachmentPoint, PieceState, ToolContext } from '../core/types';
import { attachHandle } from './handles';
import { readJoin, writeJoin, type JoinPrep } from './join';
import { markDirty, placeSample, type Sample } from './place';
import {
  add,
  distanceToSpline,
  joinBlendFor,
  lengthOf,
  normalize,
  pinchPoints,
  polylineLength,
  radiusFor,
  reject,
  scale,
  shapeCoil,
  shapeHandle,
  shapeSculpt,
  signedAngle,
  sub,
  twistPoints,
  type Vec3,
} from './spline';

const NEAR_CLAY = 0.016;

interface DrawStroke {
  mode: 'draw';
  kind: AttachmentKind;
  raw: AttachmentPoint[];
  attachmentId: string | null;
  normal: Vec3 | null;
  prep: JoinPrep;
}

interface ShapeStroke {
  mode: 'shape';
  attachmentId: string;
  snapshot: AttachmentPoint[];
  origin: Vec3;
}

let pieceId: string | null = null;
let prep: JoinPrep = { scored: false, slipped: false };
let stroke: DrawStroke | ShapeStroke | null = null;
let latestId: string | null = null;

export function resetHandbuild(): void {
  pieceId = null;
  prep = { scored: false, slipped: false };
  stroke = null;
  latestId = null;
}

function watch(piece: PieceState): void {
  if (piece.id === pieceId) return;
  pieceId = piece.id;
  prep = { scored: false, slipped: false };
  stroke = null;
  latestId = null;
}

function fingerPoint(sample: Sample, kind: AttachmentKind): Vec3 {
  if (kind !== 'handle' && sample.body) return sample.body;
  return sample.air;
}

function findAttachment(piece: PieceState, id: string | null): Attachment | null {
  if (!id) return null;
  return piece.attachments.find((attachment) => attachment.id === id) ?? null;
}

function nearestAttachment(piece: PieceState, point: Vec3): Attachment | null {
  let best: Attachment | null = null;
  let bestDistance = NEAR_CLAY;
  for (const attachment of piece.attachments) {
    const distance = distanceToSpline(attachment.points, point);
    if (distance < bestDistance) {
      best = attachment;
      bestDistance = distance;
    }
  }
  return best;
}

function targetAttachment(piece: PieceState, sample: Sample): Attachment | null {
  if (sample.meshId && sample.meshId !== 'body') {
    const hit = findAttachment(piece, sample.meshId);
    if (hit) return hit;
  }
  return nearestAttachment(piece, sample.body ?? sample.air) ?? findAttachment(piece, latestId);
}

function shapedPoints(piece: PieceState, kind: AttachmentKind, raw: readonly AttachmentPoint[], normal: Vec3 | null): AttachmentPoint[] {
  if (kind === 'handle') return shapeHandle(piece.grid, raw);
  if (kind === 'coil') return shapeCoil(piece.grid, raw);
  return shapeSculpt(piece.grid, raw, normal);
}

function remember(piece: PieceState, attachment: Attachment): void {
  latestId = attachment.id;
  piece.updatedAt = Date.now();
}

function upsert(piece: PieceState, draw: DrawStroke): void {
  const points = shapedPoints(piece, draw.kind, draw.raw, draw.normal);
  if (points.length < 2) return;
  const blend = joinBlendFor(draw.kind, polylineLength(draw.raw));
  const existing = findAttachment(piece, draw.attachmentId);
  if (existing) {
    existing.points = points;
    existing.joinBlend = blend;
    remember(piece, existing);
    return;
  }
  const attachment = createAttachment({ kind: draw.kind, points, joinBlend: blend });
  writeJoin(attachment, draw.prep.scored, draw.prep.slipped);
  attachHandle(piece, attachment);
  draw.attachmentId = attachment.id;
  remember(piece, attachment);
}

function discard(piece: PieceState, id: string | null): void {
  if (!id) return;
  piece.attachments = piece.attachments.filter((attachment) => attachment.id !== id);
  piece.surfaces = piece.surfaces.filter((surface) => surface.meshId !== id);
  if (latestId === id) latestId = piece.attachments[piece.attachments.length - 1]?.id ?? null;
  piece.updatedAt = Date.now();
}

function minimumLength(kind: AttachmentKind): number {
  if (kind === 'handle') return 0.02;
  if (kind === 'coil') return 0.012;
  return 0;
}

export function handbuildDown(ctx: ToolContext, kind: AttachmentKind): void {
  watch(ctx.piece);
  stroke = null;
  if (!canAttachHandle(ctx.piece)) return;
  const sample = placeSample(ctx);
  if (!sample) return;
  const point = fingerPoint(sample, kind);
  const touched = sample.meshId && sample.meshId !== 'body' ? findAttachment(ctx.piece, sample.meshId) : nearestAttachment(ctx.piece, point);
  if (touched && touched.points.length >= 2) {
    stroke = {
      mode: 'shape',
      attachmentId: touched.id,
      snapshot: touched.points.map((entry) => ({ ...entry })),
      origin: sample.contact ?? point,
    };
    latestId = touched.id;
    return;
  }
  const radius = radiusFor(kind, sample.pressure);
  stroke = {
    mode: 'draw',
    kind,
    raw: [{ ...point, radius }],
    attachmentId: null,
    normal: sample.normal,
    prep: { ...prep },
  };
  prep = { scored: false, slipped: false };
  if (kind === 'sculpt') upsert(ctx.piece, stroke);
}

export function handbuildMove(ctx: ToolContext): void {
  watch(ctx.piece);
  if (!stroke || !canAttachHandle(ctx.piece)) return;
  const sample = placeSample(ctx);
  if (!sample) return;
  if (stroke.mode === 'shape') {
    shapeAttachment(ctx.piece, stroke, sample);
    return;
  }
  const point = fingerPoint(sample, stroke.kind);
  const last = stroke.raw[stroke.raw.length - 1];
  if (last && lengthOf(sub(point, last)) < 0.0035) return;
  if (!stroke.normal && sample.normal) stroke.normal = sample.normal;
  stroke.raw.push({ ...point, radius: radiusFor(stroke.kind, sample.pressure) });
  if (stroke.raw.length >= 2 || stroke.kind === 'sculpt') upsert(ctx.piece, stroke);
}

export function handbuildUp(ctx: ToolContext): void {
  watch(ctx.piece);
  const current = stroke;
  stroke = null;
  if (!current || !canAttachHandle(ctx.piece)) return;
  if (current.mode === 'shape') {
    markDirty(ctx, current.attachmentId);
    return;
  }
  const longEnough = polylineLength(current.raw) >= minimumLength(current.kind) || current.kind === 'sculpt';
  if (!longEnough) {
    discard(ctx.piece, current.attachmentId);
    prep = current.prep;
    return;
  }
  upsert(ctx.piece, current);
  if (current.attachmentId) markDirty(ctx, current.attachmentId);
}

function shapeAttachment(piece: PieceState, current: ShapeStroke, sample: Sample): void {
  const attachment = findAttachment(piece, current.attachmentId);
  if (!attachment) return;
  const point = sample.contact ?? sample.body ?? sample.air;
  const startRadial = Math.hypot(current.origin.x, current.origin.z);
  const radial = Math.hypot(point.x, point.z);
  const inward = startRadial - radial;
  const pressurePinch = 1 - Math.max(0, sample.pressure - 0.2) * 0.5;
  const dragPinch = 1 - inward / 0.03;
  const factor = Math.max(0.45, Math.min(1.35, dragPinch * pressurePinch));
  const axis = normalize(sub(current.snapshot[current.snapshot.length - 1], current.snapshot[0]));
  let angle = 0;
  if (axis) {
    const mid = scale(add(current.snapshot[0], current.snapshot[current.snapshot.length - 1]), 0.5);
    angle = signedAngle(reject(sub(current.origin, mid), axis), reject(sub(point, mid), axis), axis);
  }
  attachment.points = twistPoints(pinchPoints(current.snapshot, factor), angle);
  piece.updatedAt = Date.now();
}

function stamp(ctx: ToolContext, field: keyof JoinPrep): void {
  watch(ctx.piece);
  if (!canAttachHandle(ctx.piece)) return;
  const sample = placeSample(ctx);
  const attachment = sample ? targetAttachment(ctx.piece, sample) : findAttachment(ctx.piece, latestId);
  if (attachment) {
    const join = readJoin(attachment);
    writeJoin(attachment, field === 'scored' ? true : join.scored, field === 'slipped' ? true : join.slipped);
    ctx.piece.updatedAt = Date.now();
    markDirty(ctx, attachment.id);
    latestId = attachment.id;
    return;
  }
  prep = { ...prep, [field]: true };
  markDirty(ctx, 'body');
}

export function scoreJoin(ctx: ToolContext): void {
  stamp(ctx, 'scored');
}

export function slipJoin(ctx: ToolContext): void {
  stamp(ctx, 'slipped');
}
