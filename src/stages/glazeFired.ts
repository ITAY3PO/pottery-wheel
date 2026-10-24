/**
 * STUB — firing agent.
 * Final stage. The body color is the fired clay color; a glaze shader hook
 * should already be driving the surface. Nothing transitions past here.
 */
import type { Stage } from '../core/types';

export const stage: Stage = {
  id: 'glaze-fired',
  label: 'Glaze-fired',
  order: 60,
  mountsOnWheel: false,
  allowOrbit: true,
  hint: () => 'Out of the kiln. This is the finished pot.',
};
