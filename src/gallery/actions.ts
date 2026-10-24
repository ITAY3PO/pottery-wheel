import type { PieceState } from '../core/types';

/** Stage actions call these. `startGallery` binds them when the overlay mounts. */
export interface GalleryActions {
  save(piece: PieceState): void;
  share(piece: PieceState): void;
}

let actions: GalleryActions | null = null;

export function bindGallery(next: GalleryActions): void {
  actions = next;
}

export function openSave(piece: PieceState): void {
  actions?.save(piece);
}

export function openShare(piece: PieceState): void {
  actions?.share(piece);
}
