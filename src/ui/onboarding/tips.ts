import { centeredness, meanChannel, pieceHeight } from '../../clay/grid';
import { canAttachHandle, canTrim, nextStage, pieceMoisture } from '../../core/stateMachine';
import type { Attachment, AttachmentKind, ClayGrid, PieceState } from '../../core/types';
import { lastFiringNote } from '../../firing/outcome';
import { readJoin } from '../../handbuild/join';

export interface CoachTip {
  id: string;
  tone: 'info' | 'caution';
  text: string;
}

/** A well this deep counts as opened, in meters. */
const OPENED_INNER_M = 0.008;
/** Height / radius above this counts as a pulled wall. A fresh lump sits near 0.9. */
const PULLED_ASPECT = 1.2;
/** Seconds of tall-wall stress before throwing should pause and dry. */
const WET_STRESS_S = 0.75;
/** Leather-hard work wants moisture under this. Fresh wet clay is 1. */
const LEATHER_MOISTURE = 0.7;

/** A registry tool the coaching line can name. Instruction is unused here. */
export interface CoachTool {
  id: string;
  label: string;
}

const TOOL_LABELS: Record<string, string> = {
  handle: 'Handle',
  coil: 'Coil',
  sprig: 'Sprig',
  score: 'Score',
  slip: 'Slip',
};

/**
 * One coaching line from the piece itself: moisture, stress, failure,
 * the well, the wall, attachments, and whatever is already on the surface map.
 * Handle, score, and slip names come from the tool registry when it is passed.
 */
export function coachTip(piece: PieceState | null, tools?: readonly CoachTool[]): CoachTip | null {
  if (!piece) {
    return {
      id: 'setup',
      tone: 'info',
      text: 'Choose a clay and a weight, then sit down and throw.',
    };
  }

  if (lastFiringNote) {
    return { id: 'kiln-note', tone: 'caution', text: lastFiringNote };
  }
  if (piece.grid.failure === 'slumped') {
    return { id: 'slumped', tone: 'caution', text: 'Too wet, let it dry. The wall slumped.' };
  }
  if (piece.grid.failure === 'torn') {
    return { id: 'torn', tone: 'caution', text: 'The wall tore. Keep it thicker than this clay allows.' };
  }
  if (piece.stage === 'wet' && !piece.onWheel) {
    return {
      id: 'dry-leather',
      tone: 'caution',
      text: 'Too wet, let it dry to leather-hard before you trim or add a handle.',
    };
  }
  if (piece.stage === 'wet' && piece.grid.stress >= WET_STRESS_S) {
    return { id: 'too-wet', tone: 'caution', text: 'Too wet, let it dry before you pull any higher.' };
  }
  if (piece.stage === 'leather-hard' && pieceMoisture(piece) > LEATHER_MOISTURE) {
    return {
      id: 'too-wet-leather',
      tone: 'caution',
      text: 'Too wet, let it dry. Trimming and handles want leather-hard clay.',
    };
  }
  if (canAttachHandle(piece)) return handleTip(piece, tools);
  if (canTrim(piece)) {
    return { id: 'trim', tone: 'info', text: 'Trim the foot while it is on the wheel. Take it off to add a handle.' };
  }
  if (piece.stage === 'bone-dry') {
    return { id: 'bisque-fire', tone: 'info', text: 'Bone-dry and fragile. The bisque kiln is the next step.' };
  }
  if (piece.stage === 'bisque') return bisqueTip(piece);
  if (piece.stage === 'glazed') {
    return { id: 'glaze-fire', tone: 'info', text: 'The glaze is on. The glaze kiln comes next.' };
  }
  if (nextStage(piece.stage) === null) {
    return { id: 'gallery', tone: 'info', text: 'Out of the kiln. This piece can go to the gallery.' };
  }
  if (piece.stage === 'wet' && piece.onWheel) return throwingTip(piece.grid);
  return null;
}

function bisqueTip(piece: PieceState): CoachTip {
  const coat = surfaceCoat(piece);
  if (!coat.wax) {
    return {
      id: 'wax-foot',
      tone: 'info',
      text: 'Wax the foot before you glaze, so the base will not stick in the kiln.',
    };
  }
  if (!coat.glaze) {
    return { id: 'glaze', tone: 'info', text: 'The foot is waxed. Glaze the rest of the piece.' };
  }
  return { id: 'glaze-even', tone: 'info', text: 'Glaze is on. Even the coat, then the glaze kiln can take it.' };
}

function throwingTip(grid: ClayGrid): CoachTip {
  if (centeredness(grid) < 0.72) {
    return { id: 'center', tone: 'info', text: 'Press into the side until the lump runs true.' };
  }
  if (!isOpened(grid)) {
    return { id: 'open', tone: 'info', text: 'It is running true. Open the middle with a steady push.' };
  }
  if (!isPulled(grid)) {
    return { id: 'pull', tone: 'info', text: 'The well is open. Pull up the wall to raise a mug.' };
  }
  return { id: 'wire', tone: 'info', text: 'The wall is up. Take it off the wheel when the mug feels right.' };
}

function handleTip(piece: PieceState, tools: readonly CoachTool[] | undefined): CoachTip {
  const score = toolLabel(tools, 'score');
  const slip = toolLabel(tools, 'slip');
  const handle = toolLabel(tools, 'handle');
  const drawn = piece.attachments;
  if (drawn.length === 0) {
    return {
      id: 'draw-handle',
      tone: 'info',
      text: `Draw a ${handle}, then ${score} and ${slip} the join.`,
    };
  }
  const unscored = drawn.find((attachment) => !readJoin(attachment).scored);
  if (unscored) {
    return {
      id: 'score-join',
      tone: 'caution',
      text: `Scratch the join with ${score}. A ${kindLabel(unscored, tools)} that was never scored cracks off in the kiln.`,
    };
  }
  const unslipped = drawn.find((attachment) => !readJoin(attachment).slipped);
  if (unslipped) {
    return {
      id: 'slip-join',
      tone: 'caution',
      text: `Brush ${slip} on the score. Without slip the ${kindLabel(unslipped, tools)} lets go in the fire.`,
    };
  }
  return {
    id: 'handle-on',
    tone: 'info',
    text: 'The join is scored and slipped. Dry to bone-dry when it looks sound.',
  };
}

function kindLabel(attachment: Attachment, tools: readonly CoachTool[] | undefined): string {
  return toolLabel(tools, toolIdForKind(attachment.kind));
}

function toolIdForKind(kind: AttachmentKind): string {
  return kind === 'sculpt' ? 'sprig' : kind;
}

function toolLabel(tools: readonly CoachTool[] | undefined, id: string): string {
  const label = tools?.find((tool) => tool.id === id)?.label;
  if (label) return label;
  return TOOL_LABELS[id] ?? id;
}

function surfaceCoat(piece: PieceState): { wax: boolean; glaze: boolean } {
  let wax = false;
  let glaze = false;
  for (const surface of piece.surfaces) {
    const map = surface.map;
    const count = map.wax.length;
    for (let i = 0; i < count; i++) {
      if (map.wax[i]) wax = true;
      if (map.glazeId[i]) glaze = true;
      if (wax && glaze) return { wax, glaze };
    }
  }
  return { wax, glaze };
}

function meanRange(data: Float32Array, grid: ClayGrid, ring0: number, ring1: number): number {
  let sum = 0;
  let n = 0;
  const last = Math.min(grid.rings - 1, ring1);
  for (let ring = Math.max(0, ring0); ring <= last; ring++) {
    sum += meanChannel(data, ring, grid.segments);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

function isOpened(grid: ClayGrid): boolean {
  const start = Math.floor(grid.rings * 0.4);
  const end = Math.floor(grid.rings * 0.85);
  return meanRange(grid.inner, grid, start, end) > OPENED_INNER_M;
}

function isPulled(grid: ClayGrid): boolean {
  const start = Math.floor(grid.rings * 0.35);
  const end = Math.floor(grid.rings * 0.7);
  const radius = Math.max(0.01, meanRange(grid.outer, grid, start, end));
  return pieceHeight(grid) > radius * PULLED_ASPECT;
}
