/**
 * STUB — firing agent owns this folder.
 *
 * Legal fires go through `transition`:
 *   bone-dry → bisque
 *   glazed → glaze-fired
 * Shrinkage and moisture are applied there. On `piece-change` or `frame`,
 * take `clayRootMaterial()` and call `addClayShaderHook`. Attachment meshes
 * clone that material and share the hook list. Do not assign surface uniforms
 * from one mesh: core points `uSurfaceGlaze`, `uSurfaceThickness`,
 * `uSurfaceWax`, and `uSurfaceUnderglaze` at `mesh.userData.surfaceTextures`
 * before each mesh draws. Thickness is nearest-filtered.
 */
export function fireBisque(): void {
  throw new Error('firing/kiln.ts is a stub — run the bisque cycle, then transition(piece, "bisque")');
}

export function fireGlaze(): void {
  throw new Error('firing/kiln.ts is a stub — run the glaze cycle, then transition(piece, "glaze-fired")');
}
