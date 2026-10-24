import type { PieceState } from '../core/types';
import { bindGallery } from './actions';
import './gallery.css';
import { bindShareHash } from './hash';
import { mountGallery } from './panel';

/**
 * Mounts the gallery overlay. `currentPiece` is the pot on the wheel, so it
 * can be saved before glaze firing. The app boot reads that pot from
 * `piece-change` and does not add a control to the top-right bar.
 */
export function startGallery(options: { root: HTMLElement; currentPiece: () => PieceState | null }): void {
  const panel = mountGallery(options);
  bindGallery(panel);
  bindShareHash(window, () => window.location.hash, (hash) => {
    void panel.openShared(hash);
  });
}
