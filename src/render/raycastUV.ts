import { Vector3, type Object3D, type Raycaster } from 'three';
import type { SurfaceHit } from '../core/types';

export type { SurfaceHit };

/**
 * Raycast helper for glaze, wax, and handles.
 * Body UVs are angle (u) and profile arc length (v). Attachment UVs are tube
 * angle (u) and spline (v). `point` and `normal` are piece-local: clay and
 * attachment meshes sit at identity under the clay pivot. Callers that go
 * through `ToolContext` already have an updated matrix world.
 */
export function raycastToUV(raycaster: Raycaster, objects: Object3D[]): SurfaceHit | null {
  const hits = raycaster.intersectObjects(objects, true);
  for (const hit of hits) {
    if (!hit.uv) continue;
    const meshId = typeof hit.object.userData.meshId === 'string' ? hit.object.userData.meshId : 'body';
    const normal = new Vector3();
    if (hit.normal) normal.copy(hit.normal);
    else if (hit.face) normal.copy(hit.face.normal);
    if (normal.lengthSq() > 1e-8) normal.normalize();
    const point = hit.object.worldToLocal(hit.point.clone());
    return { meshId, u: hit.uv.x, v: hit.uv.y, point, normal };
  }
  return null;
}
