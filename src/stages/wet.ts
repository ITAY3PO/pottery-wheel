import { centeredness } from '../clay/grid';
import { removeFromWheel, skipDrying } from '../core/stateMachine';
import type { Stage } from '../core/types';

export const stage: Stage = {
  id: 'wet',
  label: 'Wet',
  order: 10,
  mountsOnWheel: true,
  allowOrbit: true,
  hint: (ctx) => {
    if (!ctx) return 'The clay is wet and still on the wheel.';
    if (!ctx.piece.onWheel) return 'It’s off the bat. Dry it to leather-hard when you like the shape.';
    if (!ctx.wheel.running && ctx.wheel.rpm < 8) return 'Start the wheel. The lump is still off-center.';
    if (centeredness(ctx.piece.grid) < 0.72) return 'Press Center into the side until the wobble runs true.';
    return 'Press opens a well from the top and collars the wall from the side. Pull a wall, or compress the rim.';
  },
  actions: [
    {
      id: 'wire-off',
      label: 'Wire off',
      enabled: (ctx) => ctx.piece.onWheel && ctx.wheel.rpm <= 28,
      run: (ctx) => {
        removeFromWheel(ctx.piece);
      },
    },
    {
      id: 'dry-leather',
      label: 'Dry to leather-hard',
      enabled: (ctx) => !ctx.piece.onWheel,
      run: (ctx) => {
        skipDrying(ctx.piece);
      },
    },
  ],
};
