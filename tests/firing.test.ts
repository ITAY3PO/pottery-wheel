import { describe, expect, it } from 'vitest';
import { createCylinderGrid, pieceHeight } from '../src/clay/grid';
import { tornCount } from '../src/clay/integrity';
import { createAttachment } from '../src/core/attachment';
import { createPiece } from '../src/core/piece';
import { shrinkageScale, skipDrying, transition } from '../src/core/stateMachine';
import { ensureBodySurface } from '../src/core/surfaceMap';
import type { AttachmentKind, ClayTypeId, PieceState } from '../src/core/types';
import { fireBisque, fireGlaze, lastFiringNote } from '../src/firing/outcome';
import { writeJoin } from '../src/handbuild/join';

function boneDry(clay: ClayTypeId = 'stoneware'): PieceState {
  const piece = createPiece(clay, 1);
  skipDrying(piece);
  skipDrying(piece);
  return piece;
}

function glazed(clay: ClayTypeId = 'stoneware'): PieceState {
  const piece = boneDry(clay);
  fireBisque(piece, 999);
  transition(piece, 'glazed');
  return piece;
}

function attach(piece: PieceState, kind: AttachmentKind, id: string, scored?: boolean, slipped?: boolean): void {
  const attachment = createAttachment({
    id,
    kind,
    points: [
      { x: 0.04, y: 0.02, z: 0, radius: 0.008 },
      { x: 0.07, y: 0.06, z: 0.01, radius: 0.007 },
      { x: 0.04, y: 0.1, z: 0, radius: 0.008 },
    ],
  });
  if (scored != null && slipped != null) writeJoin(attachment, scored, slipped);
  piece.attachments.push(attachment);
}

describe('kiln outcomes', () => {
  it('shrinks about twelve percent from wet clay to a glaze firing', () => {
    const shrinkage = 0.12;
    const scale =
      shrinkageScale(shrinkage, 'wet', 'leather-hard') *
      shrinkageScale(shrinkage, 'leather-hard', 'bone-dry') *
      shrinkageScale(shrinkage, 'bone-dry', 'bisque') *
      shrinkageScale(shrinkage, 'glazed', 'glaze-fired');
    expect(1 - scale).toBeCloseTo(0.12, 2);
  });

  it('bisque-fires bone-dry clay and keeps the surface map', () => {
    const piece = boneDry();
    const before = pieceHeight(piece.grid);
    const map = ensureBodySurface(piece).map;
    map.glazeId[20] = 4;
    map.thickness[20] = 0.3;
    const plan = fireBisque(piece, 999);
    expect(plan.advance).toBe(true);
    expect(plan.moisture).toBe('ok');
    expect(plan.heat).toBe('ok');
    expect(piece.stage).toBe('bisque');
    expect(pieceHeight(piece.grid)).toBeCloseTo(before * shrinkageScale(0.12, 'bone-dry', 'bisque'), 5);
    const kept = piece.surfaces.find((surface) => surface.meshId === 'body');
    expect(kept?.map.glazeId[20]).toBe(4);
    expect(kept?.map.thickness[20]).toBeCloseTo(0.3, 5);
    expect(lastFiringNote).toBe('');
  });

  it('lets earthenware through cone 04 and refuses a wet, overfired load', () => {
    const earthen = boneDry('earthenware');
    fireBisque(earthen, 1060);
    expect(earthen.stage).toBe('bisque');
    expect(earthen.grid.failure).toBeNull();

    const wet = createPiece('earthenware', 1);
    attach(wet, 'handle', 'wet-handle');
    fireBisque(wet, 1222);
    expect(wet.stage).toBe('wet');
    expect(wet.grid.failure).toBe('torn');
    expect(tornCount(wet.grid)).toBeGreaterThan(wet.grid.torn.length * 0.3);
    expect(wet.attachments.map((attachment) => attachment.id)).toEqual(['wet-handle']);
    expect(lastFiringNote).toMatch(/exploded/i);
  });

  it('cracks leather-hard clay and leaves it on that stage', () => {
    const piece = createPiece('stoneware', 1);
    skipDrying(piece);
    fireBisque(piece, 999);
    expect(piece.stage).toBe('leather-hard');
    expect(piece.grid.failure).toBe('torn');
    const torn = tornCount(piece.grid);
    expect(torn).toBeGreaterThan(piece.grid.torn.length * 0.1);
    expect(torn).toBeLessThan(piece.grid.torn.length * 0.2);
    expect(lastFiringNote).toMatch(/cracked/i);
  });

  it('slumps earthenware at cone 6 and leaves stoneware and porcelain standing', () => {
    const hotEarth = glazed('earthenware');
    fireGlaze(hotEarth, 1222);
    expect(hotEarth.stage).toBe('glaze-fired');
    expect(hotEarth.grid.failure).toBe('slumped');
    expect(lastFiringNote).toMatch(/slumped/i);

    const tall = glazed('earthenware');
    tall.grid = createCylinderGrid({
      rings: 24,
      segments: 16,
      radius: 0.045,
      height: 0.16,
      innerRadius: 0.03,
      floor: 0.012,
    });
    tall.grid.moisture.fill(0);
    const before = pieceHeight(tall.grid);
    fireGlaze(tall, 1222);
    const height = pieceHeight(tall.grid);
    expect(tall.grid.failure).toBe('slumped');
    expect(height).toBeLessThan(before * 0.9);
    expect(height).toBeGreaterThan(before * 0.4);

    const stone = glazed('stoneware');
    fireGlaze(stone, 1222);
    expect(stone.stage).toBe('glaze-fired');
    expect(stone.grid.failure).toBeNull();

    const stoneHot = glazed('stoneware');
    fireGlaze(stoneHot, 1305);
    expect(stoneHot.grid.failure).toBe('slumped');
    expect(stoneHot.stage).toBe('glaze-fired');

    const porcelain = glazed('porcelain');
    fireGlaze(porcelain, 1305);
    expect(porcelain.stage).toBe('glaze-fired');
    expect(porcelain.grid.failure).toBeNull();
  });

  it('cracks off a join unless it was both scored and slipped', () => {
    const bisque = boneDry();
    attach(bisque, 'handle', 'bare-handle');
    attach(bisque, 'handle', 'scored-only', true, false);
    attach(bisque, 'coil', 'ready-coil', true, true);
    fireBisque(bisque, 999);
    expect(bisque.attachments.map((attachment) => attachment.id)).toEqual(['ready-coil']);
    expect(lastFiringNote).toMatch(/cracked off/i);

    const glaze = glazed();
    attach(glaze, 'coil', 'loose-coil');
    attach(glaze, 'handle', 'ready-handle', true, true);
    fireGlaze(glaze, 1222);
    expect(glaze.attachments.map((attachment) => attachment.id)).toEqual(['ready-handle']);
    expect(glaze.grid.failure).toBeNull();
  });
});
