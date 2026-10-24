/**
 * STUB — surface agent.
 * Bisque is porous and takes glaze and underglaze. Paint into the body
 * MeshSurface (glazeId, thickness, underglazeId) using raycastToUV.
 * Wax resist sets the wax texel. Then `transition(piece, 'glazed')`.
 */
import type { Stage } from '../core/types';

export const stage: Stage = {
  id: 'bisque',
  label: 'Bisque',
  order: 40,
  mountsOnWheel: false,
  allowOrbit: true,
  hint: () => 'Bisque. Glaze and wax resist belong on this surface.',
};
