/**
 * Leather-hard. Trimming (base-up, on the wheel) lives in src/tools/trim-*.ts.
 * Handles, coils, and sprigs join only while `canAttachHandle(piece)` is true, off the wheel.
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
    if (canAttachHandle(ctx.piece)) return 'Off the wheel. Draw a handle, coil, or sprig. Press to pinch, drag the clay to twist. Score and slip the join, or it cracks off in the kiln.';
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
