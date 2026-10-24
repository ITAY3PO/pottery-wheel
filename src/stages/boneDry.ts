import type { Stage } from '../core/types';
import { firingChoice, reflectConeChoice } from '../firing/choice';
import { coneById } from '../firing/cones';
import { isKilnRunning, startKiln } from '../firing/kiln';
import { lastFiringNote } from '../firing/outcome';

export const stage: Stage = {
  id: 'bone-dry',
  label: 'Bone-dry',
  order: 30,
  mountsOnWheel: false,
  allowOrbit: true,
  hint: () => {
    reflectConeChoice('bisque');
    const cone = coneById(firingChoice.bisqueCone, 'bisque');
    const picked = `Cone ${cone.label} selected, ${cone.tempC}°C.`;
    if (lastFiringNote) return `${lastFiringNote} ${picked}`;
    return `Bone-dry. Bisque fire at cone ${cone.label}, ${cone.tempC}°C.`;
  },
  actions: [
    {
      id: 'cone-06',
      label: 'Cone 06',
      run: () => {
        firingChoice.bisqueCone = '06';
      },
    },
    {
      id: 'cone-04',
      label: 'Cone 04',
      run: () => {
        firingChoice.bisqueCone = '04';
      },
    },
    {
      id: 'fire-bisque',
      label: 'Fire bisque',
      enabled: () => !isKilnRunning(),
      run: (ctx) => {
        startKiln(ctx.piece, 'bisque');
      },
    },
  ],
};
