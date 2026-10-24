import type { Tool } from '../core/types';
import { applyLoop } from './trim-carve';

/** Ribbon tool. A wide, shallow shaving that lightens the wall and the base. */
export const tool: Tool = {
  id: 'trim-ribbon',
  name: 'Ribbon',
  label: 'Ribbon',
  order: 110,
  allowedStages: ['leather-hard'],
  requiresWheel: true,
  instruction: 'Draw the ribbon over the foot to shave weight off the wall. It cuts shallow.',
  haptics: { down: 6, move: 4, moveIntervalMs: 55 },
  onPointerDown: (ctx) => applyLoop(ctx, 'ribbon'),
  onPointerMove: (ctx) => applyLoop(ctx, 'ribbon'),
  onPointerUp() {},
};
