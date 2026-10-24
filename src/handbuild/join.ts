import type { Attachment } from '../core/types';

/**
 * Kiln contract. These fields live on each attachment inside `PieceState`
 * and round-trip through `serializePiece`. Both have to be true or the join
 * cracks off in the fire. A missing flag means the same thing as false.
 */
export interface JoinPrep {
  scored: boolean;
  slipped: boolean;
}

type JoinFields = Attachment & Partial<JoinPrep>;

export function readJoin(attachment: Attachment | undefined): JoinPrep {
  const extra = attachment as JoinFields | undefined;
  return { scored: extra?.scored === true, slipped: extra?.slipped === true };
}

export function writeJoin(attachment: Attachment, scored: boolean, slipped: boolean): void {
  Object.assign(attachment, { scored, slipped });
}

/** True when the kiln should crack this attachment off the pot. */
export function attachmentWillCrack(attachment: Attachment | undefined): boolean {
  const join = readJoin(attachment);
  return !join.scored || !join.slipped;
}
