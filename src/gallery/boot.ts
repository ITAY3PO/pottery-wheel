import { events } from '../core/events';
import type { PieceState } from '../core/types';
import { startGallery } from './start';

/**
 * Loaded by `core/listeners` with the other gallery modules. Tracks the open
 * pot from `piece-change` (the same object the tools mutate) and mounts the
 * shelf. Help and mute own the top-right bar, so this file does not touch them.
 */
let live: PieceState | null = null;

events.on('piece-change', ({ piece }) => {
  live = piece;
});

const root = typeof document === 'undefined' ? null : document.querySelector('#app');
if (root instanceof HTMLElement) {
  startGallery({ root, currentPiece: () => live });
}
