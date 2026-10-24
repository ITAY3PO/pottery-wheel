import { deserializePiece, serializePiece } from '../core/piece';
import type { ClayTypeId, PieceState, StageId } from '../core/types';

/** Index of finished (and in-progress) pots. Piece bodies live in their own keys. */
export const GALLERY_INDEX_KEY = 'pottery-wheel:gallery';

export interface GalleryEntry {
  id: string;
  clayTypeId: ClayTypeId;
  stage: StageId;
  weightKg: number;
  createdAt: number;
  savedAt: number;
}

export type GallerySaveResult =
  | { ok: true; id: string; pruned: number; replaced: boolean }
  | { ok: false; reason: 'quota' | 'unavailable' };

export function galleryPieceKey(id: string): string {
  return `pottery-wheel:gallery:${id}`;
}

export function listGallery(storage: Storage = localStorage): GalleryEntry[] {
  try {
    return readIndex(storage);
  } catch {
    return [];
  }
}

export function loadGalleryPiece(id: string, storage: Storage = localStorage): PieceState | null {
  try {
    const raw = storage.getItem(galleryPieceKey(id));
    if (!raw) return null;
    return deserializePiece(raw);
  } catch {
    return null;
  }
}

export function deleteGalleryPiece(id: string, storage: Storage = localStorage): void {
  try {
    storage.removeItem(galleryPieceKey(id));
    const entries = readIndex(storage).filter((entry) => entry.id !== id);
    storage.setItem(GALLERY_INDEX_KEY, JSON.stringify(entries));
  } catch {
    // A failed delete leaves the shelf as it was, or missing one key.
  }
}

/**
 * Store `serializePiece` output. If the origin is over quota, drop the oldest
 * pots until this one fits. If this one pot cannot fit, restore what was removed.
 */
export function saveGalleryPiece(piece: PieceState, storage: Storage = localStorage): GallerySaveResult {
  let serialized: string;
  try {
    serialized = serializePiece(piece);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  try {
    const existing = readIndex(storage);
    const replaced = existing.some((entry) => entry.id === piece.id);
    const previousRaw = safeGet(storage, galleryPieceKey(piece.id));
    const entry = toEntry(piece);
    const held: { id: string; raw: string | null }[] = [];
    let survivors = [entry, ...existing.filter((item) => item.id !== piece.id)];

    while (true) {
      try {
        storage.setItem(galleryPieceKey(piece.id), serialized);
        storage.setItem(GALLERY_INDEX_KEY, JSON.stringify(survivors));
        return { ok: true, id: piece.id, pruned: held.length, replaced };
      } catch (error) {
        if (!isQuotaError(error)) return { ok: false, reason: 'unavailable' };
        const oldest = survivors.length > 1 ? survivors[survivors.length - 1] : undefined;
        if (!oldest || oldest.id === piece.id) {
          restore(storage, piece.id, previousRaw, existing, held);
          return { ok: false, reason: 'quota' };
        }
        held.push({ id: oldest.id, raw: safeGet(storage, galleryPieceKey(oldest.id)) });
        safeRemove(storage, galleryPieceKey(oldest.id));
        survivors = survivors.slice(0, -1);
      }
    }
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

function restore(
  storage: Storage,
  incomingId: string,
  previousRaw: string | null,
  previous: GalleryEntry[],
  held: { id: string; raw: string | null }[],
): void {
  const key = galleryPieceKey(incomingId);
  if (previousRaw == null) safeRemove(storage, key);
  else {
    try {
      storage.setItem(key, previousRaw);
    } catch {
      safeRemove(storage, key);
    }
  }
  for (const item of held) {
    if (item.raw != null) {
      try {
        storage.setItem(galleryPieceKey(item.id), item.raw);
      } catch {
        // The shelf may stay short if the origin is still over quota.
      }
    }
  }
  try {
    storage.setItem(GALLERY_INDEX_KEY, JSON.stringify(previous));
  } catch {
    // Index write can fail when the origin is wedged. The piece keys were put back.
  }
}

function toEntry(piece: PieceState): GalleryEntry {
  return {
    id: piece.id,
    clayTypeId: piece.clayTypeId,
    stage: piece.stage,
    weightKg: piece.weightKg,
    createdAt: piece.createdAt,
    savedAt: Date.now(),
  };
}

function readIndex(storage: Storage): GalleryEntry[] {
  const raw = storage.getItem(GALLERY_INDEX_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isEntry);
}

function isEntry(value: unknown): value is GalleryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<GalleryEntry>;
  return typeof entry.id === 'string' && entry.id.length > 0 && typeof entry.clayTypeId === 'string' && typeof entry.stage === 'string';
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  const code = 'code' in error ? Number(error.code) : NaN;
  return code === 22 || code === 1014;
}

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore. The next write reports quota or unavailable.
  }
}
