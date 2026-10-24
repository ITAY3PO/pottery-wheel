/**
 * STUB — trimming tools and handle UI land here.
 * Trimming is legal only while `canTrim(piece)` is true (leather-hard, on the wheel).
 * Handles attach only while `canAttachHandle(piece)` is true (leather-hard, off the wheel).
 * Add tools under src/tools with allowedStages: ['leather-hard'].
 * Add handle geometry by pushing an Attachment from src/handbuild.
 */
import { canAttachHandle, canTrim, remountOnWheel, skipDrying, unmountFromWheel } from '../core/stateMachine';
import type { Stage } from '../core/types';

export const stage: Stage = {
  id: 'leather-hard',
  label: 'Leather-hard',
  order: 20,
  mountsOnWheel: true,
  allowOrbit: true,
  hint: (ctx) => {
    if (!ctx) return 'Leather-hard. Trim on the wheel, or add a handle.';
    if (canTrim(ctx.piece)) return 'Back on the wheel. Trimming tools are not on this head yet — take it off when you’re done looking.';
    if (canAttachHandle(ctx.piece)) return 'Leather-hard and off the wheel. A handle can join here. Dry on when you want it bone-dry.';
    return 'Leather-hard.';
  },
  actions: [
    {
      id: 'remount',
      label: 'Back on the wheel',
      enabled: (ctx) => !ctx.piece.onWheel,
      run: (ctx) => {
        remountOnWheel(ctx.piece);
      },
    },
    {
      id: 'unmount',
      label: 'Take off the wheel',
      enabled: (ctx) => ctx.piece.onWheel,
      run: (ctx) => {
        unmountFromWheel(ctx.piece);
      },
    },
    {
      id: 'dry-bone',
      label: 'Dry to bone-dry',
      enabled: (ctx) => !ctx.piece.onWheel,
      run: (ctx) => {
        skipDrying(ctx.piece);
      },
    },
  ],
};
