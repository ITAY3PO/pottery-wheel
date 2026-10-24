/**
 * Hand-building at leather-hard, off the wheel.
 *
 * Draw a handle, coil, or sprig with the tools in `src/tools`. Press to pinch
 * a section thinner; drag an attachment to twist it. Score and slip the join
 * first — `scored` and `slipped` are stored on the attachment for the kiln.
 * If either flag is missing or false, `attachmentWillCrack` is true.
 */
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

export { createAttachment } from '../core/attachment';
export { attachmentWillCrack, readJoin, writeJoin } from './join';
