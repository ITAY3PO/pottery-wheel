import { describe, expect, it } from 'vitest';
import { createSurfaceMap, ensureBodySurface, sampleGlaze } from '../src/core/surfaceMap';
import { createPiece, deserializePiece, serializePiece } from '../src/core/piece';
import { skipDrying } from '../src/core/stateMachine';
import { GLAZES, getGlaze } from '../src/surface/catalog';
import { dipPiece } from '../src/surface/coat';
import {
  brushRadius,
  byteToThickness,
  dipCoat,
  paintGlaze,
  paintWax,
  pourCoat,
  thicknessToByte,
  waxBlocks,
} from '../src/surface/paint';
import { fireBisque } from '../src/firing/outcome';

describe('glaze paint', () => {
  it('wraps the brush in u and clamps v', () => {
    const map = createSurfaceMap(32, 32);
    paintWax(map, 0.001, 0.5, 0.05);
    const row = 16 * 32;
    expect(map.wax[row]).toBe(1);
    expect(map.wax[row + 31]).toBe(1);
    paintWax(map, 0.5, 0, 0.04);
    expect(map.wax[16]).toBe(1);
    expect(map.wax[31 * 32 + 16]).toBe(0);
  });

  it('blocks glaze on wax, for a brush and a dip', () => {
    const map = createSurfaceMap(32, 32);
    const u = 16.5 / 32;
    const v = 16.5 / 32;
    paintWax(map, u, v, 0.04);
    const index = 16 * 32 + 16;
    expect(waxBlocks(map, index)).toBe(true);
    const glaze = getGlaze(3);
    paintGlaze(map, u, v, 0.04, glaze.id, glaze.coatMm);
    dipCoat(map, 6, 0.24, false);
    expect(map.glazeId[index]).toBe(0);
    expect(map.thickness[index]).toBe(0);
    expect(map.wax[index]).toBe(1);
  });

  it('stacks thickness and lets the later glaze win', () => {
    const map = createSurfaceMap(32, 32);
    const u = 16.5 / 32;
    const v = 16.5 / 32;
    const index = 16 * 32 + 16;
    paintGlaze(map, u, v, 0.05, 3, 0.28);
    const first = map.thickness[index] ?? 0;
    expect(first).toBeGreaterThan(0.2);
    expect(map.glazeId[index]).toBe(3);
    paintGlaze(map, u, v, 0.05, 4, 0.28);
    const second = (map.thickness[index] ?? 0) - first;
    expect(second).toBeCloseTo(first, 5);
    expect(map.glazeId[index]).toBe(4);
  });

  it('caps a coat at 2.55 mm', () => {
    const map = createSurfaceMap(8, 8);
    for (let n = 0; n < 20; n++) dipCoat(map, 5, 0.4, false);
    for (let i = 0; i < map.thickness.length; i++) {
      expect(map.thickness[i]).toBeCloseTo(2.55, 5);
      expect(map.glazeId[i]).toBe(5);
    }
  });

  it('dips the wall and spares the foot, and a second dip doubles it', () => {
    const map = createSurfaceMap(32, 32);
    dipCoat(map, 3, 0.28, true);
    expect(map.thickness[0]).toBe(0);
    expect(map.glazeId[0]).toBe(0);
    const mid = 16 * 32;
    expect(map.thickness[mid]).toBeCloseTo(0.28, 5);
    expect(map.glazeId[mid]).toBe(3);
    dipCoat(map, 3, 0.28, true);
    expect(map.thickness[0]).toBe(0);
    expect(map.thickness[mid]).toBeCloseTo(0.56, 5);
  });

  it('pours more glaze near the rim than down the wall', () => {
    const map = createSurfaceMap(48, 48);
    pourCoat(map, 4, 0.32, 1.7, true);
    let high = 0;
    let highN = 0;
    let mid = 0;
    let midN = 0;
    for (let y = 0; y < map.height; y++) {
      const v = (y + 0.5) / map.height;
      let row = 0;
      for (let x = 0; x < map.width; x++) row += map.thickness[y * map.width + x] ?? 0;
      const mean = row / map.width;
      if (v > 0.92) {
        high += mean;
        highN += 1;
      } else if (v > 0.35 && v < 0.6) {
        mid += mean;
        midN += 1;
      }
    }
    expect(high / highN).toBeGreaterThan(mid / midN);
  });

  it('grows the brush with the size control', () => {
    expect(brushRadius(0)).toBeLessThan(brushRadius(0.5));
    expect(brushRadius(0.5)).toBeLessThan(brushRadius(1));
    expect(brushRadius(-2)).toBe(brushRadius(0));
    expect(brushRadius(4)).toBe(brushRadius(1));
  });

  it('round-trips thickness through the byte ramp', () => {
    for (let byte = 0; byte <= 255; byte++) {
      expect(thicknessToByte(byteToThickness(byte))).toBe(byte);
    }
    expect(thicknessToByte(9)).toBe(255);
    expect(thicknessToByte(-1)).toBe(0);
  });

  it('keeps wax, glaze, and a bare foot across save and load', () => {
    const piece = createPiece('stoneware', 1);
    skipDrying(piece);
    skipDrying(piece);
    fireBisque(piece, 999);
    const map = ensureBodySurface(piece).map;
    paintWax(map, 0.5, 0.5, 0.08);
    dipPiece(piece, 3);
    const saved = deserializePiece(serializePiece(piece));
    expect(saved).not.toBeNull();
    const body = saved?.surfaces.find((surface) => surface.meshId === 'body');
    expect(body).toBeTruthy();
    const waxed = sampleGlaze(body!.map, 0.5, 0.5);
    expect(waxed.wax).toBe(1);
    expect(waxed.glazeId).toBe(0);
    expect(waxed.thickness).toBe(0);
    const foot = sampleGlaze(body!.map, 0.25, 0.02);
    expect(foot.glazeId).toBe(0);
    expect(foot.thickness).toBe(0);
    const wall = sampleGlaze(body!.map, 0.12, 0.55);
    expect(wall.glazeId).toBe(3);
    expect(wall.thickness).toBeCloseTo(getGlaze(3).coatMm, 5);
    expect(GLAZES.map((glaze) => glaze.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
