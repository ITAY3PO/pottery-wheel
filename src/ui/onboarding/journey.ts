import { canAttachHandle, canThrow, canTransition, canTrim, nextStage } from '../../core/stateMachine';
import type { PieceState, Stage, StageId } from '../../core/types';

export const JOURNEY_LABELS = ['Throw', 'Trim', 'Handle', 'Wax & glaze', 'Fire', 'Gallery'] as const;

export type JourneyId = 'throw' | 'trim' | 'handle' | 'wax' | 'fire' | 'gallery';

export type JourneyPlace = 'done' | 'current' | 'pending';

export interface JourneyStep {
  id: JourneyId;
  label: string;
  /** Where the piece sits. Trim stays pending at the handle step — leaving the wheel does not finish it. */
  place: JourneyPlace;
  /** Whether the lifecycle API allows this step's work right now. */
  allowed: boolean;
  reason: string;
}

export interface Journey {
  steps: JourneyStep[];
  /** Label from the stage registry, when the caller passed the loaded stages. */
  stageLabel: string | null;
}

const STEP_IDS: readonly JourneyId[] = ['throw', 'trim', 'handle', 'wax', 'fire', 'gallery'];

const STAGE_ORDER: readonly StageId[] = walkStages();

function walkStages(): StageId[] {
  const order: StageId[] = [];
  let cursor: StageId | null = 'wet';
  while (cursor) {
    order.push(cursor);
    cursor = nextStage(cursor);
  }
  return order;
}

function laterThan(stage: StageId, marker: StageId): boolean {
  return STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(marker);
}

/**
 * Throw → Trim → Handle → Wax & glaze → Fire → Gallery.
 * Place comes from the stage (and the wheel, for the two leather-hard jobs).
 * `allowed` comes from canThrow, canTrim, canAttachHandle, and canTransition.
 * Bone-dry sits on Wax & glaze, blocked, while the bisque fire is already legal.
 */
export function buildJourney(piece: PieceState | null, stages: readonly Stage[] = []): Journey {
  const current = hereIndex(piece);
  const steps = STEP_IDS.map((id, index) => ({
    id,
    label: JOURNEY_LABELS[index],
    place: placeFor(index, current, piece),
    allowed: allowedFor(id, piece),
    reason: reasonFor(id, piece),
  }));
  return { steps, stageLabel: labelFor(piece, stages) };
}

export function journeyReason(steps: readonly JourneyStep[], stageLabel: string | null): string {
  const current = steps.find((step) => step.place === 'current');
  if (!current) return '';
  if (!stageLabel) return current.reason;
  return `${stageLabel}. ${current.reason}`;
}

export function journeyStatus(step: JourneyStep): string {
  if (step.place === 'current' && step.allowed) return 'now, ready';
  if (step.place === 'current') return 'now';
  if (step.place === 'done') return 'done';
  if (step.allowed) return 'ready';
  return 'not yet';
}

function hereIndex(piece: PieceState | null): number {
  if (!piece) return 0;
  switch (piece.stage) {
    case 'wet':
      return 0;
    case 'leather-hard':
      return piece.onWheel ? 1 : 2;
    case 'bone-dry':
    case 'bisque':
      return 3;
    case 'glazed':
      return 4;
    case 'glaze-fired':
      return 5;
    default: {
      const unreachable: never = piece.stage;
      return unreachable;
    }
  }
}

function placeFor(index: number, current: number, piece: PieceState | null): JourneyPlace {
  if (index === current) return 'current';
  // Both trim and handle are leather-hard. Taking the piece off does not mean the foot was trimmed.
  if (index === 1 && piece?.stage === 'leather-hard') return 'pending';
  if (index < current) return 'done';
  return 'pending';
}

function allowedFor(id: JourneyId, piece: PieceState | null): boolean {
  if (!piece) return false;
  switch (id) {
    case 'throw':
      return canThrow(piece);
    case 'trim':
      return canTrim(piece);
    case 'handle':
      return canAttachHandle(piece);
    case 'wax':
      return nextStage(piece.stage) === 'glazed';
    case 'fire':
      return canTransition(piece.stage, 'bisque') || canTransition(piece.stage, 'glaze-fired');
    case 'gallery':
      return nextStage(piece.stage) === null;
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

function reasonFor(id: JourneyId, piece: PieceState | null): string {
  switch (id) {
    case 'throw':
      if (!piece) return 'Choose a clay and sit down to throw.';
      if (canThrow(piece)) return 'On the wheel. Center, open, and pull.';
      if (piece.stage === 'wet') return 'Off the wheel. Let it dry to leather-hard when you like the shape.';
      return 'Throwing is finished.';
    case 'trim':
      if (piece && canTrim(piece)) return 'On the wheel. Trim the foot.';
      if (piece?.stage === 'leather-hard') return 'Remount on the wheel to trim.';
      if (piece && laterThan(piece.stage, 'leather-hard')) return 'Only happens at leather-hard.';
      return 'Starts once the clay is leather-hard, on the wheel.';
    case 'handle':
      if (piece && canAttachHandle(piece)) return 'Off the wheel. Score, then attach.';
      if (piece && canTrim(piece)) return 'Take it off the wheel to attach a handle.';
      if (piece && laterThan(piece.stage, 'leather-hard')) return 'That step is past.';
      return 'Joins leather-hard clay, off the wheel.';
    case 'wax':
      if (piece && nextStage(piece.stage) === 'glazed') return 'Wax the foot, then glaze.';
      if (piece?.stage === 'bone-dry') return 'The bisque fire comes before wax and glaze.';
      if (piece && laterThan(piece.stage, 'bisque')) return 'Already on the piece.';
      return 'Waits until the piece is bisque.';
    case 'fire':
      if (piece && canTransition(piece.stage, 'bisque')) return 'Ready for the bisque kiln.';
      if (piece && canTransition(piece.stage, 'glaze-fired')) return 'Ready for the glaze kiln.';
      if (piece && nextStage(piece.stage) === null) return 'Both fires are done.';
      return 'After bone-dry, and again after glaze.';
    case 'gallery':
      if (piece && nextStage(piece.stage) === null) return 'It can go to the gallery.';
      return 'Holds a finished piece.';
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

function labelFor(piece: PieceState | null, stages: readonly Stage[]): string | null {
  const id = piece ? piece.stage : 'setup';
  return stages.find((stage) => stage.id === id)?.label ?? null;
}
