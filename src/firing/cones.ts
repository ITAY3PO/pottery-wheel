export interface Cone {
  id: string;
  label: string;
  tempC: number;
  fire: 'bisque' | 'glaze';
}

/** Orton peak temperatures. Bisque 06 / 04, glaze 6 / 9 / 10. */
export const BISQUE_CONES: readonly Cone[] = [
  { id: '06', label: '06', tempC: 999, fire: 'bisque' },
  { id: '04', label: '04', tempC: 1060, fire: 'bisque' },
];

export const GLAZE_CONES: readonly Cone[] = [
  { id: '6', label: '6', tempC: 1222, fire: 'glaze' },
  { id: '9', label: '9', tempC: 1280, fire: 'glaze' },
  { id: '10', label: '10', tempC: 1305, fire: 'glaze' },
];

export function coneById(id: string, fire: 'bisque' | 'glaze'): Cone {
  const list = fire === 'bisque' ? BISQUE_CONES : GLAZE_CONES;
  return list.find((cone) => cone.id === id) ?? list[0];
}
