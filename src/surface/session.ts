import type { PieceState } from '../core/types';

export type PainterMode = 'wax' | 'glaze';

export const painter = {
  mode: 'glaze' as PainterMode,
  glazeId: 3,
  brushSize: 0.42,
  pourSeed: 1,
};

let readPiece: () => PieceState | null = () => null;
let publish: () => void = () => {};

export function bindPainter(next: { piece: () => PieceState | null; publish: () => void }): void {
  readPiece = next.piece;
  publish = next.publish;
}

export function currentPiece(): PieceState | null {
  return readPiece();
}

export function publishPainter(): void {
  publish();
}
