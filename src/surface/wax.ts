import type { SurfaceMap } from '../core/types';
import { paintWax } from './paint';

/** Paint wax resist. Glaze applied afterwards will not stick on these texels. */
export function applyWax(map: SurfaceMap, u: number, v: number, radius: number): void {
  paintWax(map, u, v, radius);
}
