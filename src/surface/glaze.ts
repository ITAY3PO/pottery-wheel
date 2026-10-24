/**
 * STUB — surface agent owns this folder.
 *
 * Body UVs: u = angle, v = arc length along the profile, frozen when the
 * piece leaves the wheel (`grid.uvFrozen`). Per mesh, `MeshSurface.map` holds
 * glazeId, thickness (mm), wax, and underglazeId. GPU copies live on
 * `mesh.userData.surfaceTextures` (DataTextures). Hit-test with `raycastToUV`.
 * After painting, call `markSurfaceTexturesDirty` and `transition(piece, 'glazed')`
 * when the coat is finished.
 */
export function applyGlaze(): void {
  throw new Error('surface/glaze.ts is a stub — paint MeshSurface maps, then transition to glazed');
}
