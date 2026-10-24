import type { Tool } from '../core/types';
import { applyLoop } from './trim-carve';

/** Square loop. A flat shelf and a crisp corner on the foot ring. */
export const tool: Tool = {
  id: 'trim-square',
  name: 'Square loop',
  label: 'Square',
  order: 100,
  allowedStages: ['leather-hard'],
  requiresWheel: true,
  instruction: 'The square loop cuts a flat recess and a sharp foot ring. Stay above the floor.',
  haptics: { down: 14, move: 9, moveIntervalMs: 80 },
  onPointerDown: (ctx) => applyLoop(ctx, 'square'),
  onPointerMove: (ctx) => applyLoop(ctx, 'square'),
  onPointerUp() {},
};
