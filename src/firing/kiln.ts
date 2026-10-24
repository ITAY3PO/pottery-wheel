/**
 * STUB — firing agent owns this folder.
 *
 * Legal fires go through `transition`:
 *   bone-dry → bisque
 *   glazed → glaze-fired
 * Shrinkage and moisture are applied there. Drive the fired look by
 * `addClayShaderHook` on the existing MeshPhysicalMaterial (onBeforeCompile),
 * not by swapping the material. Read glazeId / thickness / wax DataTextures
 * from `mesh.userData.surfaceTextures`.
 */
export function fireBisque(): void {
  throw new Error('firing/kiln.ts is a stub — run the bisque cycle, then transition(piece, "bisque")');
}

export function fireGlaze(): void {
  throw new Error('firing/kiln.ts is a stub — run the glaze cycle, then transition(piece, "glaze-fired")');
}
