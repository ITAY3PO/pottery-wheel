import type { PieceState } from '../core/types';

let mark: (meshId: string) => void = () => {};

/** Studio upload, bound from the app. A no-op until then (tests, headless). */
export function bindSurfaceDirty(fn: (meshId: string) => void): void {
  mark = fn;
}

export function markPieceSurfaces(piece: PieceState): void {
  for (const surface of piece.surfaces) mark(surface.meshId);
}
