import type { Stage } from '../core/types';
import { firingChoice, reflectConeChoice } from '../firing/choice';
import { coneById } from '../firing/cones';
import { isKilnRunning, startKiln } from '../firing/kiln';
import { lastFiringNote } from '../firing/outcome';

export const stage: Stage = {
  id: 'glazed',
  label: 'Glazed',
  order: 50,
  mountsOnWheel: false,
  allowOrbit: true,
  hint: () => {
    reflectConeChoice('glaze');
    const cone = coneById(firingChoice.glazeCone, 'glaze');
    const picked = `Cone ${cone.label} selected, ${cone.tempC}°C.`;
    if (lastFiringNote) return `${lastFiringNote} ${picked}`;
    return `The glaze is still chalky. Glaze fire at cone ${cone.label}, ${cone.tempC}°C.`;
  },
  actions: [
    {
      id: 'cone-6',
      label: 'Cone 6',
      run: () => {
        firingChoice.glazeCone = '6';
      },
    },
    {
      id: 'cone-9',
      label: 'Cone 9',
      run: () => {
        firingChoice.glazeCone = '9';
      },
    },
    {
      id: 'cone-10',
      label: 'Cone 10',
      run: () => {
        firingChoice.glazeCone = '10';
      },
    },
    {
      id: 'fire-glaze',
      label: 'Fire glaze',
      enabled: () => !isKilnRunning(),
      run: (ctx) => {
        startKiln(ctx.piece, 'glaze');
      },
    },
  ],
};
