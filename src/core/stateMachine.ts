import { getClay } from '../clay/clays';
import { freezeProfile, meanMoisture, scaleGrid } from '../clay/grid';
import { events } from './events';
import { ensureBodySurface } from './surfaceMap';
import type { PieceState, StageId } from './types';

const NEXT: Partial<Record<StageId, StageId>> = {
  wet: 'leather-hard',
  'leather-hard': 'bone-dry',
  'bone-dry': 'bisque',
  bisque: 'glazed',
  glazed: 'glaze-fired',
};

export function nextStage(stage: StageId): StageId | null {
  return NEXT[stage] ?? null;
}

export function canTransition(from: StageId, to: StageId): boolean {
  return NEXT[from] === to;
}

/** Trimming is a leather-hard job, and only back on the wheel. */
export function canTrim(piece: PieceState): boolean {
  return piece.stage === 'leather-hard' && piece.onWheel;
}

/** Handles and coils join leather-hard clay, off the wheel. */
export function canAttachHandle(piece: PieceState): boolean {
  return piece.stage === 'leather-hard' && !piece.onWheel;
}

export function canThrow(piece: PieceState): boolean {
  return piece.stage === 'wet' && piece.onWheel;
}

export function moistureForStage(stage: StageId): number {
  switch (stage) {
    case 'wet':
      return 1;
    case 'leather-hard':
      return 0.42;
    case 'bone-dry':
      return 0.06;
    default:
      return 0;
  }
}

/**
 * Linear scale applied when moving between stages.
 * Drying shrinkage is a bit over half the catalog total; the bisque fire
 * takes most of the rest; the glaze fire settles a little more.
 */
export function shrinkageScale(shrinkage: number, from: StageId, to: StageId): number {
  const drying = shrinkage * 0.55;
  const firing = shrinkage * 0.45;
  if (from === 'wet' && to === 'leather-hard') return 1 - drying * 0.5;
  if (from === 'leather-hard' && to === 'bone-dry') return 1 - drying * 0.5;
  if (from === 'bone-dry' && to === 'bisque') return 1 - firing;
  if (from === 'glazed' && to === 'glaze-fired') return 1 - shrinkage * 0.02;
  return 1;
}

/**
 * Advance one legal step. Applies shrinkage, moisture, and freezes UVs
 * the first time the piece leaves the wet wheel. Returns false if illegal.
 */
export function transition(piece: PieceState, to: StageId): boolean {
  if (!canTransition(piece.stage, to)) return false;
  const from = piece.stage;
  const clay = getClay(piece.clayTypeId);
  const scale = shrinkageScale(clay.shrinkage, piece.stage, to);
  if (scale !== 1) scaleGrid(piece.grid, scale);
  piece.grid.moisture.fill(moistureForStage(to));
  piece.stage = to;
  piece.onWheel = false;
  piece.grid.stress = 0;
  if (!piece.grid.uvFrozen) freezeProfile(piece.grid);
  ensureBodySurface(piece);
  piece.updatedAt = Date.now();
  events.emit('stage-change', { piece, from, to });
  return true;
}

/** Wet → leather-hard, or leather-hard → bone-dry. */
export function skipDrying(piece: PieceState): boolean {
  if (piece.stage !== 'wet' && piece.stage !== 'leather-hard') return false;
  const to = nextStage(piece.stage);
  if (!to) return false;
  return transition(piece, to);
}

/** Wire cut. The piece leaves the wheel and its profile UVs freeze. */
export function removeFromWheel(piece: PieceState): void {
  if (!piece.onWheel) return;
  piece.onWheel = false;
  piece.grid.stress = 0;
  if (!piece.grid.uvFrozen) freezeProfile(piece.grid);
  ensureBodySurface(piece);
  piece.updatedAt = Date.now();
  events.emit('wire-cut', { piece });
}

/** Leather-hard trimming goes back on the head. Other stages stay put. */
export function remountOnWheel(piece: PieceState): boolean {
  if (piece.stage !== 'leather-hard') return false;
  piece.onWheel = true;
  piece.updatedAt = Date.now();
  return true;
}

export function unmountFromWheel(piece: PieceState): void {
  piece.onWheel = false;
  piece.updatedAt = Date.now();
}

export function pieceMoisture(piece: PieceState): number {
  return meanMoisture(piece.grid);
}
