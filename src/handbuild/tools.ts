import type { AttachmentKind, Tool } from '../core/types';
import { handbuildDown, handbuildMove, handbuildUp, scoreJoin, slipJoin } from './session';

function drawTool(kind: AttachmentKind, label: string, order: number, instruction: string): Tool {
  return offWheel({
    id: kind === 'sculpt' ? 'sprig' : kind,
    name: label,
    label,
    order,
    allowedStages: ['leather-hard'],
    requiresWheel: false,
    instruction,
    haptics: { down: 12, move: 6, moveIntervalMs: 80 },
    onPointerDown: (ctx) => handbuildDown(ctx, kind),
    onPointerMove: handbuildMove,
    onPointerUp: handbuildUp,
  });
}

/** Hidden while the piece is mounted. Trimming owns that time. */
function offWheel(tool: Tool): Tool {
  return Object.assign(tool, { offWheel: true });
}

export const handleTool: Tool = drawTool(
  'handle',
  'Handle',
  70,
  'Draw the handle with one finger. Press to pinch it thinner, then drag it to twist. Score and slip the join.',
);

export const coilTool: Tool = drawTool(
  'coil',
  'Coil',
  71,
  'Draw a coil on the wall. Press to thin it. Score and slip before you leave it.',
);

export const sprigTool: Tool = drawTool(
  'sculpt',
  'Sprig',
  72,
  'Tap for a knob, or draw a small sprig. Score and slip where it meets the pot.',
);

export const scoreTool: Tool = offWheel({
  id: 'score',
  name: 'Score',
  label: 'Score',
  order: 73,
  allowedStages: ['leather-hard'],
  requiresWheel: false,
  instruction: 'Scratch the join. A handle that was never scored cracks off in the kiln.',
  haptics: { down: [10, 28, 12] },
  onPointerDown: scoreJoin,
  onPointerMove() {},
  onPointerUp() {},
});

export const slipTool: Tool = offWheel({
  id: 'slip',
  name: 'Slip',
  label: 'Slip',
  order: 74,
  allowedStages: ['leather-hard'],
  requiresWheel: false,
  instruction: 'Brush slip on the score. Without slip the join lets go in the fire.',
  haptics: { down: 16 },
  onPointerDown: slipJoin,
  onPointerMove() {},
  onPointerUp() {},
});
