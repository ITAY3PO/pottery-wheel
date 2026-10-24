import type { Object3D, Raycaster } from 'three';

export interface SurfaceHit {
  meshId: string;
  u: number;
  v: number;
}

/**
 * Raycast helper for glaze and wax. Body UVs are angle (u) and frozen
 * profile arc length (v); attachment UVs are tube angle (u) and spline (v).
 */
export function raycastToUV(raycaster: Raycaster, objects: Object3D[]): SurfaceHit | null {
  const hits = raycaster.intersectObjects(objects, true);
  for (const hit of hits) {
    if (!hit.uv) continue;
    const meshId = typeof hit.object.userData.meshId === 'string' ? hit.object.userData.meshId : 'body';
    return { meshId, u: hit.uv.x, v: hit.uv.y };
  }
  return null;
}
