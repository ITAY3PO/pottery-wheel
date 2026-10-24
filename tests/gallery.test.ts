import { describe, expect, it } from 'vitest';
import { createAttachment } from '../src/core/attachment';
import { createSurfaceMap } from '../src/core/surfaceMap';
import { createPiece, deserializePiece, serializePiece } from '../src/core/piece';
import type { PieceState, StageContext } from '../src/core/types';
import { bindGallery } from '../src/gallery/actions';
import { Turntable, applyTurntableMaterials } from '../src/gallery/view';
import {
  deleteGalleryPiece,
  listGallery,
  loadGalleryPiece,
  saveGalleryPiece,
} from '../src/gallery/store';
import { createClayMaterial } from '../src/render/materials';
import { stage as glazeFired } from '../src/stages/glazeFired';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function quotaStorage(maxChars: number): Storage {
  const values = new Map<string, string>();
  const sizeOf = (entries: Map<string, string>) => {
    let total = 0;
    for (const [key, value] of entries) total += key.length + value.length;
    return total;
  };
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      const next = new Map(values);
      next.set(key, value);
      if (sizeOf(next) > maxChars) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      values.clear();
      for (const [storedKey, stored] of next) values.set(storedKey, stored);
    },
  };
}

describe('gallery storage', () => {
  it('saves with serializePiece, lists, reloads, and deletes', () => {
    const storage = memoryStorage();
    const piece = createPiece('earthenware', 0.8);
    piece.stage = 'leather-hard';
    piece.onWheel = false;
    piece.grid.outer[10] = 0.042;
    const result = saveGalleryPiece(piece, storage);
    expect(result).toMatchObject({ ok: true, id: piece.id, pruned: 0, replaced: false });

    const entries = listGallery(storage);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: piece.id,
      clayTypeId: 'earthenware',
      stage: 'leather-hard',
      weightKg: 0.8,
    });

    const loaded = loadGalleryPiece(piece.id, storage);
    expect(loaded).not.toBeNull();
    const again = deserializePiece(serializePiece(loaded as PieceState));
    expect(again.grid.outer[10]).toBeCloseTo(0.042, 6);
    expect(again.stage).toBe('leather-hard');
    expect(again.clayTypeId).toBe('earthenware');

    deleteGalleryPiece(piece.id, storage);
    expect(listGallery(storage)).toHaveLength(0);
    expect(loadGalleryPiece(piece.id, storage)).toBeNull();
  });

  it('replaces a pot with the same id and keeps a single shelf entry', () => {
    const storage = memoryStorage();
    const piece = createPiece('stoneware', 1);
    saveGalleryPiece(piece, storage);
    piece.stage = 'bisque';
    piece.weightKg = 1;
    const again = saveGalleryPiece(piece, storage);
    expect(again).toMatchObject({ ok: true, replaced: true, pruned: 0 });
    expect(listGallery(storage)).toHaveLength(1);
    expect(listGallery(storage)[0]?.stage).toBe('bisque');
  });

  it('returns quota without throwing when one pot cannot fit', () => {
    const piece = createPiece('porcelain', 1.2);
    const storage = quotaStorage(32);
    expect(saveGalleryPiece(piece, storage)).toEqual({ ok: false, reason: 'quota' });
    expect(listGallery(storage)).toHaveLength(0);
  });

  it('drops the oldest pot when the shelf is full, and restores it if the new pot still cannot fit', () => {
    const small = createPiece('stoneware', 0.5);
    const big = createPiece('porcelain', 1);
    const map = createSurfaceMap();
    map.glazeId[0] = 4;
    big.surfaces = [{ meshId: 'body', map }];
    const smallRaw = serializePiece(small).length;
    const storage = quotaStorage(smallRaw + 2000);

    expect(saveGalleryPiece(small, storage).ok).toBe(true);
    const denied = saveGalleryPiece(big, storage);
    expect(denied).toEqual({ ok: false, reason: 'quota' });
    expect(listGallery(storage).map((entry) => entry.id)).toEqual([small.id]);
    expect(loadGalleryPiece(small.id, storage)?.id).toBe(small.id);
    expect(loadGalleryPiece(big.id, storage)).toBeNull();
  });

  it('prunes an older pot so a new one of the same size can be saved', () => {
    const first = createPiece('stoneware', 0.5);
    const second = createPiece('porcelain', 0.6);
    const third = createPiece('earthenware', 0.7);
    const one = serializePiece(first).length;
    const storage = quotaStorage(one * 2 + 4000);
    expect(saveGalleryPiece(first, storage).ok).toBe(true);
    expect(saveGalleryPiece(second, storage).ok).toBe(true);
    const saved = saveGalleryPiece(third, storage);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.pruned).toBeGreaterThan(0);
    const ids = listGallery(storage).map((entry) => entry.id);
    expect(ids[0]).toBe(third.id);
    expect(ids).not.toContain(first.id);
    expect(loadGalleryPiece(third.id, storage)?.clayTypeId).toBe('earthenware');
  });

  it('wires Save and Share on the finished pot', () => {
    const piece = createPiece('stoneware', 1);
    piece.stage = 'glaze-fired';
    let saved = '';
    let shared = '';
    bindGallery({
      save: (value) => {
        saved = value.id;
      },
      share: (value) => {
        shared = value.id;
      },
    });
    const ctx = { piece, wheel: {} as StageContext['wheel'] };
    expect(glazeFired.actions?.map((action) => action.label)).toEqual(['Save', 'Share']);
    glazeFired.actions?.[0]?.run(ctx);
    glazeFired.actions?.[1]?.run(ctx);
    expect(saved).toBe(piece.id);
    expect(shared).toBe(piece.id);
    bindGallery({
      save: () => undefined,
      share: () => undefined,
    });
  });

  it('applies the fired look to the pot and the attachment on a turntable', () => {
    const piece = createPiece('stoneware', 1);
    piece.stage = 'glaze-fired';
    piece.attachments.push(
      createAttachment({
        id: 'gallery-handle',
        kind: 'handle',
        points: [
          { x: 0.04, y: 0.02, z: 0, radius: 0.008 },
          { x: 0.07, y: 0.06, z: 0.01, radius: 0.007 },
          { x: 0.04, y: 0.1, z: 0, radius: 0.008 },
        ],
      }),
    );
    const body = createClayMaterial();
    const handle = createClayMaterial();
    applyTurntableMaterials(body, handle, piece);
    expect(String(body.userData.hookKey)).toContain('glaze-fire');
    expect(String(handle.userData.hookKey)).toContain('glaze-fire');
    expect(body.userData.pwFire).toBe(1);
    expect(handle.userData.pwFire).toBe(1);
    expect(body.userData.pwFiredMeshId).toBe('body');
    expect(handle.userData.pwFiredMeshId).toBe('gallery-handle');
    applyTurntableMaterials(body, handle, piece);
    expect(String(body.userData.hookKey)).toBe('clay|glaze-fire');

    const bisque = createPiece('porcelain', 0.8);
    bisque.stage = 'bisque';
    const raw = createClayMaterial();
    applyTurntableMaterials(raw, createClayMaterial(), bisque);
    expect(raw.userData.pwFire).toBe(0);
    expect(raw.roughness).toBeCloseTo(0.96);
    expect(Turntable.prototype.show.toString()).toContain('applyTurntableMaterials');
  });

  it('reports unavailable storage instead of throwing', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('blocked');
    };
    expect(saveGalleryPiece(createPiece('stoneware', 1), storage)).toEqual({ ok: false, reason: 'unavailable' });
    storage.getItem = () => {
      throw new Error('blocked');
    };
    expect(listGallery(storage)).toEqual([]);
  });
});
