import { deserializePiece, serializePiece } from './piece';
import type { PieceState } from './types';

export const PIECE_STORAGE_KEY = 'pottery-wheel:piece';

export function savePiece(piece: PieceState, storage: Storage = localStorage): void {
  piece.updatedAt = Date.now();
  storage.setItem(PIECE_STORAGE_KEY, serializePiece(piece));
}

export function loadPiece(storage: Storage = localStorage): PieceState | null {
  const raw = storage.getItem(PIECE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return deserializePiece(raw);
  } catch {
    return null;
  }
}

export function clearPiece(storage: Storage = localStorage): void {
  storage.removeItem(PIECE_STORAGE_KEY);
}

export function hasSavedPiece(storage: Storage = localStorage): boolean {
  return storage.getItem(PIECE_STORAGE_KEY) != null;
}
