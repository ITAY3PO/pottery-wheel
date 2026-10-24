/**
 * STUB — handbuild agent owns this folder.
 *
 * At leather-hard, and only when `canAttachHandle(piece)` is true, build an
 * Attachment with `createAttachment` and push it onto `piece.attachments`.
 * Also call `ensureAttachmentSurface(piece, attachment.id)`.
 * The renderer sweeps a tube along `points` in piece-local space, flares the
 * ends by `joinBlend`, and sets UVs (u around the tube, v along the spline).
 * Do not edit src/core/registry.ts — if you need a tool, add src/tools/handle.ts.
 */
import { createAttachment } from '../core/attachment';
import { canAttachHandle } from '../core/stateMachine';
import { ensureAttachmentSurface } from '../core/surfaceMap';
import type { Attachment, PieceState } from '../core/types';

export function attachHandle(piece: PieceState, attachment: Attachment): void {
  if (!canAttachHandle(piece)) {
    throw new Error('Handles join only at leather-hard, off the wheel');
  }
  piece.attachments.push(attachment);
  ensureAttachmentSurface(piece, attachment.id);
  piece.updatedAt = Date.now();
}

export { createAttachment };
