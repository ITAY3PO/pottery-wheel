import { transition } from '../core/stateMachine';
import type { Stage } from '../core/types';
import { getGlaze } from '../surface/catalog';
import { dipPiece, pourPiece } from '../surface/coat';
import { markPieceSurfaces } from '../surface/dirty';
import { mountPainter } from '../surface/dock';
import { painter } from '../surface/session';

if (typeof document !== 'undefined') mountPainter();

export const stage: Stage = {
  id: 'bisque',
  label: 'Bisque',
  order: 40,
  mountsOnWheel: false,
  allowOrbit: true,
  hint: () => {
    if (painter.mode === 'wax') {
      return 'Wax resist. Paint where the glaze should pull away. It toasts bare in the kiln.';
    }
    const name = getGlaze(painter.glazeId).name;
    return `${name}. Brush it on, or dip and pour. The real color waits for the kiln.`;
  },
  actions: [
    {
      id: 'dip',
      label: 'Dip',
      run: (ctx) => {
        dipPiece(ctx.piece);
        markPieceSurfaces(ctx.piece);
      },
    },
    {
      id: 'pour',
      label: 'Pour',
      run: (ctx) => {
        pourPiece(ctx.piece);
        markPieceSurfaces(ctx.piece);
      },
    },
    {
      id: 'finish-glaze',
      label: 'Coat is done',
      run: (ctx) => {
        transition(ctx.piece, 'glazed');
      },
    },
  ],
};
