import type { Stage } from '../core/types';

export const stage: Stage = {
  id: 'setup',
  label: 'Setup',
  order: 0,
  mountsOnWheel: false,
  allowOrbit: false,
  hint: () => 'Choose a clay body and a weight, then sit down at the wheel.',
};
