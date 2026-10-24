import { ensureAttachmentSurface, ensureBodySurface } from '../core/surfaceMap';
import type { PieceState } from '../core/types';
import { getGlaze } from './catalog';
import { dipCoat, pourCoat } from './paint';
import { painter } from './session';

/** Full dip. The body's foot ring stays bare; attachments take the coat too. */
export function dipPiece(piece: PieceState, glazeId = painter.glazeId): void {
  const glaze = getGlaze(glazeId);
  const body = ensureBodySurface(piece);
  dipCoat(body.map, glaze.id, glaze.coatMm, true);
  for (const attachment of piece.attachments) {
    const surface = ensureAttachmentSurface(piece, attachment.id);
    dipCoat(surface.map, glaze.id, glaze.coatMm * 0.85, false);
  }
  piece.updatedAt = Date.now();
}

/** Pour from the rim. Each call uses a new seed so the runs shift. */
export function pourPiece(piece: PieceState, glazeId = painter.glazeId): void {
  const glaze = getGlaze(glazeId);
  const seed = painter.pourSeed;
  painter.pourSeed += 1;
  const body = ensureBodySurface(piece);
  pourCoat(body.map, glaze.id, glaze.coatMm, seed, true);
  for (const attachment of piece.attachments) {
    const surface = ensureAttachmentSurface(piece, attachment.id);
    pourCoat(surface.map, glaze.id, glaze.coatMm * 0.7, seed + 0.37, false);
  }
  piece.updatedAt = Date.now();
}
