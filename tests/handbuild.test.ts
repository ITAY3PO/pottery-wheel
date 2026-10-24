import { beforeEach, describe, expect, it } from 'vitest';
import { createCylinderGrid } from '../src/clay/grid';
import { createAttachment } from '../src/core/attachment';
import { createPiece, deserializePiece, serializePiece } from '../src/core/piece';
import { toolsFor } from '../src/core/registry';
import { canAttachHandle } from '../src/core/stateMachine';
import type { AttachmentPoint, PieceState, ToolContext } from '../src/core/types';
import { Wheel } from '../src/core/wheel';
import { attachHandle, attachmentWillCrack, readJoin } from '../src/handbuild/handles';
import { attachmentWillCrack as crackFromJoin } from '../src/handbuild/join';
import { drawingPlanePoint, placeSample, readRay, worldToPiece, type HandHit, type HandRay } from '../src/handbuild/place';
import { handbuildDown, handbuildMove, handbuildUp, resetHandbuild, scoreJoin, slipJoin } from '../src/handbuild/session';
import {
  PIECE_LIFT,
  pinchPoints,
  pointOnOuter,
  polylineLength,
  shapeCoil,
  shapeHandle,
  shapeKnob,
  twistPoints,
  wallRadius,
} from '../src/handbuild/spline';
import { buildAttachmentGeometry } from '../src/render/attachmentMesh';

function pot(): PieceState {
  const piece = createPiece('stoneware', 1);
  piece.stage = 'leather-hard';
  piece.onWheel = false;
  piece.grid = createCylinderGrid({
    radius: 0.045,
    height: 0.09,
    innerRadius: 0.038,
    floor: 0.01,
    rings: 30,
    segments: 24,
  });
  return piece;
}

function ctx(
  piece: PieceState,
  point: { x: number; y: number; z: number },
  extra: {
    pressure?: number;
    hit?: HandHit;
    ray?: HandRay;
    raycaster?: { ray: HandRay };
    mark?: (meshId: string) => void;
    angle?: number;
  } = {},
): ToolContext {
  const wheel = new Wheel();
  wheel.angle = extra.angle ?? 0;
  return {
    piece,
    wheel,
    pointer: {
      radius: Math.hypot(point.x, point.z),
      height: point.y,
      pressure: extra.pressure ?? 0.15,
      side: 1,
      segment: 0,
      x: point.x,
      y: point.y,
    },
    previous: null,
    dt: 0.016,
    surfaceHit: extra.hit ?? null,
    ray: extra.ray,
    raycaster: extra.raycaster,
    markSurfaceDirty: extra.mark ?? (() => {}),
    screen: { x: 0, y: 0 },
    ndc: { x: 0, y: 0 },
    events: { on: () => () => {}, off() {}, emit() {} },
  } as unknown as ToolContext;
}

/** Ray from +Z through a piece-local point on the z=0 drawing plane. */
function rayThrough(point: { x: number; y: number }): HandRay {
  const worldY = point.y + PIECE_LIFT;
  return {
    origin: { x: 0, y: worldY, z: 0.4 },
    direction: { x: point.x, y: 0, z: -0.4 },
  };
}

function drawHandle(piece: PieceState, points: { x: number; y: number; pressure?: number }[], useRay = false): void {
  points.forEach((point, index) => {
    const sample = ctx(piece, { x: useRay ? 0 : point.x, y: useRay ? 0 : point.y, z: 0 }, {
      pressure: point.pressure ?? 0.15,
      ray: useRay ? rayThrough(point) : undefined,
    });
    if (index === 0) handbuildDown(sample, 'handle');
    else handbuildMove(sample);
  });
  handbuildUp(ctx(piece, { x: 0, y: 0, z: 0 }));
}

beforeEach(() => {
  resetHandbuild();
});

describe('handle geometry', () => {
  it('plants a drawn bow on the wall and keeps the spline outside it', () => {
    const grid = pot().grid;
    const raw: AttachmentPoint[] = [
      { x: 0.05, y: 0.025, z: 0, radius: 0.006 },
      { x: 0.09, y: 0.05, z: 0.002, radius: 0.006 },
      { x: 0.05, y: 0.075, z: 0, radius: 0.006 },
    ];
    const shaped = shapeHandle(grid, raw);
    expect(shaped).toHaveLength(14);
    const radial = (point: AttachmentPoint) => Math.hypot(point.x, point.z);
    expect(radial(shaped[0])).toBeLessThan(0.045);
    expect(radial(shaped[shaped.length - 1])).toBeLessThan(0.045);
    expect(radial(shaped[7])).toBeGreaterThan(0.07);
    expect(shaped[0].y).toBeLessThan(shaped[7].y);
    expect(shaped[shaped.length - 1].y).toBeGreaterThan(shaped[7].y);
  });

  it('bows a stroke that never left the wall', () => {
    const grid = pot().grid;
    const raw: AttachmentPoint[] = [
      { x: 0.045, y: 0.02, z: 0, radius: 0.006 },
      { x: 0.045, y: 0.05, z: 0, radius: 0.006 },
      { x: 0.045, y: 0.08, z: 0, radius: 0.006 },
    ];
    const shaped = shapeHandle(grid, raw);
    const radial = (point: AttachmentPoint) => Math.hypot(point.x, point.z);
    expect(radial(shaped[7])).toBeGreaterThan(radial(shaped[0]) + 0.012);
  });

  it('pinches radii down and twists the bow around the chord', () => {
    const points: AttachmentPoint[] = [
      { x: 0, y: 0, z: 0, radius: 0.008 },
      { x: 0.02, y: 0.04, z: 0, radius: 0.008 },
      { x: 0, y: 0.08, z: 0, radius: 0.008 },
    ];
    const pinched = pinchPoints(points, 0.5);
    expect(pinched[1].radius).toBeCloseTo(0.004, 5);
    expect(pinched[1].x).toBeCloseTo(0.02, 5);
    const twisted = twistPoints(points, Math.PI / 2);
    expect(twisted[0].x).toBeCloseTo(0, 5);
    expect(twisted[2].y).toBeCloseTo(0.08, 5);
    expect(twisted[1].x).toBeCloseTo(0, 4);
    expect(twisted[1].z).toBeCloseTo(-0.02, 4);
    expect(twisted[1].radius).toBe(0.008);
  });

  it('seats a coil on the wall and stands a knob off it', () => {
    const grid = pot().grid;
    expect(wallRadius(grid, 0.04, 0.4)).toBeCloseTo(0.045, 4);
    const onWall = pointOnOuter(grid, 0.25, 0.5, 0.004);
    expect(onWall.x).toBeCloseTo(0.045, 3);
    expect(onWall.z).toBeCloseTo(0, 3);
    expect(onWall.y).toBeGreaterThan(0.04);
    expect(onWall.y).toBeLessThan(0.05);
    const coil = shapeCoil(grid, [
      { x: 0.02, y: 0.03, z: 0.04, radius: 0.004 },
      { x: -0.01, y: 0.05, z: 0.05, radius: 0.004 },
      { x: -0.03, y: 0.07, z: 0.02, radius: 0.004 },
    ]);
    for (const point of coil) {
      const gap = Math.hypot(point.x, point.z) - 0.045;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(0.008);
    }
    const knob = shapeKnob(grid, onWall, { x: 1, y: 0, z: 0 });
    expect(knob).toHaveLength(3);
    expect(Math.hypot(knob[2].x, knob[2].z)).toBeGreaterThan(Math.hypot(knob[0].x, knob[0].z) + 0.01);
  });
});

describe('placement from the tool ray and surface hit', () => {
  it('puts a ray sample on the camera-facing plane and ignores the profile pointer', () => {
    const piece = pot();
    const ray = rayThrough({ x: 0.08, y: 0.05 });
    expect(drawingPlanePoint(ray)?.x).toBeCloseTo(0.08, 5);
    expect(worldToPiece({ x: 0.05, y: 0.02, z: 0 }, Math.PI / 2, 0).z).toBeCloseTo(0.05, 5);
    const nested = readRay({ ray: { origin: ray.origin, direction: ray.direction } });
    expect(nested?.origin.z).toBeCloseTo(0.4, 5);
    const sample = placeSample(ctx(piece, { x: 0, y: 0, z: 0 }, { ray }));
    expect(sample?.air.x).toBeCloseTo(0.08, 4);
    expect(sample?.air.y).toBeCloseTo(0.05, 4);
    expect(sample?.air.z).toBeCloseTo(0, 4);
  });

  it('reads the tool raycaster and keeps a piece-local hit where it landed', () => {
    const piece = pot();
    const sample = placeSample(
      ctx(piece, { x: 0, y: 0, z: 0 }, {
        angle: Math.PI / 2,
        raycaster: { ray: rayThrough({ x: 0.08, y: 0.05 }) },
        hit: {
          meshId: 'body',
          u: 0.25,
          v: 0.5,
          point: { x: 0.02, y: 0.03, z: 0.04 },
          normal: { x: 0, y: 0, z: 1 },
        },
      }),
    );
    expect(sample?.air.y).toBeCloseTo(0.05, 4);
    expect(sample?.air.z).toBeCloseTo(0.08, 4);
    expect(sample?.contact).toEqual({ x: 0.02, y: 0.03, z: 0.04 });
    expect(sample?.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(sample?.body?.x).toBeCloseTo(0.045, 3);
  });

  it('reads a body hit as a point on the outer wall', () => {
    const piece = pot();
    const sample = placeSample(
      ctx(piece, { x: 0, y: 0, z: 0 }, {
        hit: { meshId: 'body', u: 0.25, v: 0.5, normal: { x: 1, y: 0, z: 0 } },
      }),
    );
    expect(sample?.meshId).toBe('body');
    expect(sample?.body?.x).toBeCloseTo(0.045, 3);
    expect(sample?.normal?.x).toBeCloseTo(1, 5);
  });
});

describe('hand-building a mug', () => {
  it('offers handles off the wheel and leaves trimming on it', () => {
    const off = toolsFor('leather-hard', false).map((tool) => tool.id);
    const on = toolsFor('leather-hard', true).map((tool) => tool.id);
    for (const id of ['handle', 'coil', 'sprig', 'score', 'slip']) {
      expect(off).toContain(id);
      expect(on).not.toContain(id);
    }
    expect(on).toEqual(expect.arrayContaining(['trim-center', 'trim-round', 'trim-ribbon']));
    expect(off).not.toContain('trim-square');
  });

  it('sweeps a handle from a finger ray, then pinches and twists it', () => {
    const piece = pot();
    expect(canAttachHandle(piece)).toBe(true);
    drawHandle(
      piece,
      [
        { x: 0.05, y: 0.028 },
        { x: 0.09, y: 0.05 },
        { x: 0.05, y: 0.072 },
      ],
      true,
    );
    expect(piece.attachments).toHaveLength(1);
    const handle = piece.attachments[0];
    expect(handle.kind).toBe('handle');
    expect(handle.joinBlend).toBeCloseTo(0.22, 5);
    expect(handle.points.length).toBeGreaterThan(4);
    const radial = (point: AttachmentPoint) => Math.hypot(point.x, point.z);
    expect(radial(handle.points[0])).toBeLessThan(0.045);
    const mid = handle.points[Math.floor(handle.points.length / 2)];
    expect(radial(mid)).toBeGreaterThan(0.06);
    expect(mid.y).toBeGreaterThan(0.035);
    expect(mid.y).toBeLessThan(0.065);
    expect(piece.surfaces.some((surface) => surface.meshId === handle.id)).toBe(true);
    expect(attachmentWillCrack(handle)).toBe(true);

    const before = handle.points.map((point) => point.radius);
    const marked: string[] = [];
    const shape = ctx(piece, { x: 0.08, y: 0.05, z: 0 }, {
      pressure: 0.15,
      hit: { meshId: handle.id, u: 0.5, v: 0.5, point: { x: 0.08, y: 0.064, z: 0 } },
      mark: (meshId) => marked.push(meshId),
    });
    handbuildDown(shape, 'handle');
    handbuildMove(ctx(piece, { x: 0.05, y: 0.05, z: 0 }, { pressure: 1, hit: { meshId: handle.id, u: 0.5, v: 0.5 } }));
    handbuildUp(shape);
    const afterPinch = handle.points.reduce((sum, point) => sum + point.radius, 0) / handle.points.length;
    const beforeMean = before.reduce((sum, radius) => sum + radius, 0) / before.length;
    expect(afterPinch).toBeLessThan(beforeMean * 0.75);
    expect(marked).toContain(handle.id);

    const atBow = (z: number) =>
      ctx(piece, { x: 0.08, y: 0.05, z: 0 }, {
        hit: { meshId: handle.id, u: 0.2, v: 0.5, point: { x: 0.08, y: 0.064, z } },
      });
    handbuildDown(atBow(0), 'handle');
    handbuildMove(atBow(0.04));
    handbuildUp(atBow(0.04));
    expect(Math.max(...handle.points.map((point) => Math.abs(point.z)))).toBeGreaterThan(0.004);

    const geometry = buildAttachmentGeometry(handle);
    const uv = geometry.getAttribute('uv');
    let minU = 1;
    let maxU = 0;
    let minV = 1;
    let maxV = 0;
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
      minV = Math.min(minV, uv.getY(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    expect(minU).toBe(0);
    expect(maxU).toBe(1);
    expect(minV).toBe(0);
    expect(maxV).toBe(1);
    expect(uv.count).toBe((handle.tubularSegments + 1) * (handle.radialSegments + 1));
  });

  it('records score and slip on the attachment for the kiln, including a save', () => {
    const piece = pot();
    const marked: string[] = [];
    scoreJoin(ctx(piece, { x: 0.045, y: 0.04, z: 0 }, { mark: (meshId) => marked.push(meshId) }));
    slipJoin(ctx(piece, { x: 0.045, y: 0.06, z: 0 }));
    expect(marked).toContain('body');
    drawHandle(piece, [
      { x: 0.05, y: 0.03 },
      { x: 0.08, y: 0.05 },
      { x: 0.05, y: 0.07 },
    ]);
    const handle = piece.attachments[0];
    expect(readJoin(handle)).toEqual({ scored: true, slipped: true });
    expect(attachmentWillCrack(handle)).toBe(false);
    expect(crackFromJoin(handle)).toBe(false);
    const saved = JSON.parse(serializePiece(piece)) as { attachments: { scored: boolean; slipped: boolean }[] };
    expect(saved.attachments[0].scored).toBe(true);
    expect(saved.attachments[0].slipped).toBe(true);
    const loaded = deserializePiece(serializePiece(piece));
    expect(readJoin(loaded.attachments[0])).toEqual({ scored: true, slipped: true });
    expect(loaded.attachments[0].kind).toBe('handle');
  });

  it('keeps an unscored join flagged so the kiln can crack it off', () => {
    const piece = pot();
    drawHandle(piece, [
      { x: 0.05, y: 0.03, pressure: 0 },
      { x: 0.085, y: 0.05, pressure: 1 },
      { x: 0.05, y: 0.07, pressure: 0 },
    ]);
    const handle = piece.attachments[0];
    expect(readJoin(handle)).toEqual({ scored: false, slipped: false });
    expect(attachmentWillCrack(handle)).toBe(true);
    const mid = handle.points[Math.floor(handle.points.length / 2)].radius;
    expect(mid).toBeLessThan(handle.points[0].radius);
  });

  it('adds a coil and a sprig with their own surfaces', () => {
    const piece = pot();
    const hits = [0.02, 0.08, 0.14].map((u) => ({ meshId: 'body', u, v: 0.55 }));
    hits.forEach((hit, index) => {
      const sample = ctx(piece, { x: 0, y: 0.05, z: 0 }, { hit });
      if (index === 0) handbuildDown(sample, 'coil');
      else handbuildMove(sample);
    });
    handbuildUp(ctx(piece, { x: 0, y: 0.05, z: 0 }));
    expect(piece.attachments[0].kind).toBe('coil');
    expect(piece.attachments[0].joinBlend).toBeGreaterThan(0);
    expect(piece.attachments[0].joinBlend).toBeLessThanOrEqual(0.45);
    for (const point of piece.attachments[0].points) {
      expect(Math.hypot(point.x, point.z)).toBeGreaterThan(0.045);
      expect(Math.hypot(point.x, point.z)).toBeLessThan(0.055);
    }

    const tap = ctx(piece, { x: 0, y: 0, z: 0 }, { hit: { meshId: 'body', u: 0.5, v: 0.3, normal: { x: 0, y: 0, z: -1 } } });
    handbuildDown(tap, 'sculpt');
    handbuildUp(tap);
    const sprig = piece.attachments[1];
    expect(sprig.kind).toBe('sculpt');
    expect(sprig.points).toHaveLength(3);
    expect(Math.hypot(sprig.points[2].x, sprig.points[2].z)).toBeGreaterThan(Math.hypot(sprig.points[0].x, sprig.points[0].z));
    expect(piece.surfaces.map((surface) => surface.meshId)).toEqual([piece.attachments[0].id, sprig.id]);
    expect(polylineLength(sprig.points)).toBeGreaterThan(0.01);
  });

  it('refuses to add clay while the piece is wet or back on the wheel', () => {
    const wet = createPiece('porcelain', 0.8);
    expect(() => attachHandle(wet, createAttachment({ kind: 'handle', points: [{ x: 0, y: 0, z: 0, radius: 0.01 }, { x: 0, y: 0.02, z: 0, radius: 0.01 }] }))).toThrow(/leather-hard/);
    handbuildDown(ctx(wet, { x: 0.06, y: 0.04, z: 0 }), 'handle');
    handbuildMove(ctx(wet, { x: 0.08, y: 0.06, z: 0 }));
    handbuildUp(ctx(wet, { x: 0.06, y: 0.08, z: 0 }));
    expect(wet.attachments).toHaveLength(0);

    const mounted = pot();
    mounted.onWheel = true;
    drawHandle(mounted, [
      { x: 0.05, y: 0.03 },
      { x: 0.08, y: 0.05 },
      { x: 0.05, y: 0.07 },
    ]);
    expect(mounted.attachments).toHaveLength(0);
  });

  it('drops a stroke that is too short to be a handle', () => {
    const piece = pot();
    drawHandle(piece, [
      { x: 0.05, y: 0.04 },
      { x: 0.052, y: 0.042 },
    ]);
    expect(piece.attachments).toHaveLength(0);
  });
});
