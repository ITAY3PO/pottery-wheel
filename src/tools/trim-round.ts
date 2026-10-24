import type { Tool } from '../core/types';
import { applyLoop } from './trim-carve';

/** Round loop. A curved bite that hollows a bowl inside the foot ring. */
export const tool: Tool = {
  id: 'trim-round',
  name: 'Round loop',
  label: 'Round',
  order: 90,
  allowedStages: ['leather-hard'],
  requiresWheel: true,
  instruction: 'Press the round loop into the base to carve a curved foot. Too deep cuts through.',
  haptics: { down: 10, move: [5, 8], moveIntervalMs: 70 },
  onPointerDown: (ctx) => applyLoop(ctx, 'round'),
  onPointerMove: (ctx) => applyLoop(ctx, 'round'),
  onPointerUp() {},
};
