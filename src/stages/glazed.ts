/**
 * STUB — firing agent.
 * The piece is glazed but not yet glaze-fired. Run the glaze kiln, then
 * `transition(piece, 'glaze-fired')`. Extend the clay MeshPhysicalMaterial
 * with addClayShaderHook rather than replacing it.
 */
import type { Stage } from '../core/types';

export const stage: Stage = {
  id: 'glazed',
  label: 'Glazed',
  order: 50,
  mountsOnWheel: false,
  allowOrbit: true,
  hint: () => 'Glaze is on. It still has to meet the kiln.',
};
