/**
 * STUB — firing agent.
 * Bone-dry clay is ready for the bisque kiln. Call `transition(piece, 'bisque')`
 * from src/firing when the kiln cycle finishes. Do not skip the kiln UI by
 * adding a one-click fire button here unless that cycle is the real one.
 */
import type { Stage } from '../core/types';

export const stage: Stage = {
  id: 'bone-dry',
  label: 'Bone-dry',
  order: 30,
  mountsOnWheel: false,
  allowOrbit: true,
  hint: () => 'Bone-dry and fragile. The bisque kiln comes next.',
};
