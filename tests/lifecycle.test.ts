import { describe, expect, it } from 'vitest';
import { pieceHeight } from '../src/clay/grid';
import { createPiece, deserializePiece, serializePiece } from '../src/core/piece';
import {
  canAttachHandle,
  canThrow,
  canTrim,
  canTransition,
  remountOnWheel,
  skipDrying,
  transition,
  unmountFromWheel,
} from '../src/core/stateMachine';
import { loadPiece, savePiece } from '../src/core/storage';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('lifecycle', () => {
  it('dries, gates trimming and handles, and refuses illegal fires', () => {
    const piece = createPiece('stoneware', 1);
    const wetHeight = pieceHeight(piece.grid);
    expect(canThrow(piece)).toBe(true);
    expect(canTrim(piece)).toBe(false);
    expect(canAttachHandle(piece)).toBe(false);

    expect(skipDrying(piece)).toBe(true);
    expect(piece.stage).toBe('leather-hard');
    expect(piece.onWheel).toBe(false);
    expect(piece.grid.uvFrozen).toBe(true);
    expect(piece.surfaces.some((surface) => surface.meshId === 'body')).toBe(true);
    expect(pieceHeight(piece.grid)).toBeLessThan(wetHeight);
    expect(canAttachHandle(piece)).toBe(true);
    expect(canTrim(piece)).toBe(false);

    expect(remountOnWheel(piece)).toBe(true);
    expect(canTrim(piece)).toBe(true);
    expect(canAttachHandle(piece)).toBe(false);
    expect(remountOnWheel(createPiece('porcelain', 0.5))).toBe(false);

    unmountFromWheel(piece);
    expect(skipDrying(piece)).toBe(true);
    expect(piece.stage).toBe('bone-dry');
    expect(skipDrying(piece)).toBe(false);
    expect(canTransition('bone-dry', 'bisque')).toBe(true);
    expect(transition(piece, 'glaze-fired')).toBe(false);
    expect(transition(piece, 'bisque')).toBe(true);
    expect(transition(piece, 'glazed')).toBe(true);
    expect(transition(piece, 'glaze-fired')).toBe(true);
    expect(piece.stage).toBe('glaze-fired');
  });

  it('round-trips a piece through save and load', () => {
    const piece = createPiece('earthenware', 0.8);
    skipDrying(piece);
    piece.grid.outer[10] = 0.042;
    piece.attachments.push({
      id: 'handle-1',
      kind: 'handle',
      joinBlend: 0.15,
      tubularSegments: 12,
      radialSegments: 8,
      points: [
        { x: 0.04, y: 0.03, z: 0, radius: 0.005 },
        { x: 0.06, y: 0.06, z: 0, radius: 0.005 },
      ],
    });
    const storage = memoryStorage();
    savePiece(piece, storage);
    const loaded = loadPiece(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.stage).toBe('leather-hard');
    expect(loaded?.clayTypeId).toBe('earthenware');
    expect(loaded?.grid.outer[10]).toBeCloseTo(0.042, 5);
    expect(loaded?.grid.outer.length).toBe(piece.grid.outer.length);
    expect(loaded?.attachments[0]?.kind).toBe('handle');
    expect(loaded?.grid.uvFrozen).toBe(true);
    expect(deserializePiece(serializePiece(piece)).id).toBe(piece.id);
  });
});
