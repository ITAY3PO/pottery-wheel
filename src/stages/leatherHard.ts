/**
 * Leather-hard. Trimming (base-up, on the wheel) lives in src/tools/trim-*.ts.
 * Handles still join only while `canAttachHandle(piece)` is true, off the wheel.
 */
import { canAttachHandle, canTrim, skipDrying } from '../core/stateMachine';
import type { Stage } from '../core/types';
import { baseIsPierced, mountBaseUp, trimStatus, unmountUpright } from '../tools/trim-pose';

export const stage: Stage = {
  id: 'leather-hard',
  label: 'Leather-hard',
  order: 20,
  mountsOnWheel: true,
  allowOrbit: true,
  hint: (ctx) => {
    if (!ctx) return 'Leather-hard. Trim on the wheel, or add a handle.';
    if (canTrim(ctx.piece)) return trimStatus(ctx.piece);
    if (baseIsPierced(ctx.piece.grid)) return 'The base is cut through. A handle can still join, or dry it on.';
    if (canAttachHandle(ctx.piece)) return 'Leather-hard and off the wheel. A handle can join here. Dry on when you want it bone-dry.';
    return 'Leather-hard.';
  },
  actions: [
    {
      id: 'remount',
      label: 'Back on the wheel',
      enabled: (ctx) => !ctx.piece.onWheel,
      run: (ctx) => {
        mountBaseUp(ctx.piece);
      },
    },
    {
      id: 'unmount',
      label: 'Take off the wheel',
      enabled: (ctx) => ctx.piece.onWheel,
      run: (ctx) => {
        unmountUpright(ctx.piece);
      },
    },
    {
      id: 'dry-bone',
      label: 'Dry to bone-dry',
      enabled: (ctx) => !ctx.piece.onWheel,
      run: (ctx) => {
        unmountUpright(ctx.piece);
        skipDrying(ctx.piece);
      },
    },
  ],
};
