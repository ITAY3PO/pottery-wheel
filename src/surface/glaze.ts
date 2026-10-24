/**
 * STUB — surface agent owns this folder.
 *
 * Paint from a tool. `ctx.surfaceHit` is the UV on the body or an attachment
 * (`meshId`, `u`, `v`, piece-local `point` and `normal`), or null on a miss.
 * Body UVs: u = angle, v = arc length, frozen once `grid.uvFrozen` is set.
 * Write `MeshSurface.map`, then `ctx.markSurfaceDirty(meshId)`.
 * Sample `uSurfaceGlaze`, `uSurfaceThickness`, `uSurfaceWax`, and
 * `uSurfaceUnderglaze` in a clay shader hook — core binds them per mesh.
 * Thickness is nearest-filtered. `transition(piece, 'glazed')` when the coat is done.
 */
export function applyGlaze(): void {
  throw new Error('surface/glaze.ts is a stub — paint MeshSurface maps, then transition to glazed');
}
