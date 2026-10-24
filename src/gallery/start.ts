import type { PieceState } from '../core/types';
import { bindGallery } from './actions';
import './gallery.css';
import { mountGallery } from './panel';

/**
 * Mounts the gallery overlay. `currentPiece` is the pot on the wheel, so it
 * can be saved before glaze firing exists. When the core events hook lands,
 * keep this call and read the latest piece from 'piece-change'.
 */
export function startGallery(options: { root: HTMLElement; currentPiece: () => PieceState | null }): void {
  const panel = mountGallery(options);
  bindGallery(panel);
  if (window.location.hash.includes('p1.')) void panel.openShared(window.location.hash);
}
