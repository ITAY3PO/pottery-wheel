import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  RedFormat,
  UnsignedByteType,
} from 'three';
import type { SurfaceMap } from '../core/types';

/** GPU copies of a surface map. The surface agent updates the arrays, then calls markDirty. */
export interface SurfaceTextures {
  glazeId: DataTexture;
  thickness: DataTexture;
  wax: DataTexture;
  underglaze: DataTexture;
}

export function createSurfaceTextures(map: SurfaceMap): SurfaceTextures {
  const glazeId = new DataTexture(map.glazeId, map.width, map.height, RedFormat, UnsignedByteType);
  const thickness = new DataTexture(map.thickness, map.width, map.height, RedFormat, FloatType);
  const wax = new DataTexture(map.wax, map.width, map.height, RedFormat, UnsignedByteType);
  const underglaze = new DataTexture(map.underglazeId, map.width, map.height, RedFormat, UnsignedByteType);
  for (const texture of [glazeId, thickness, wax, underglaze]) {
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearFilter;
    texture.flipY = false;
    texture.needsUpdate = true;
  }
  return { glazeId, thickness, wax, underglaze };
}

export function markSurfaceTexturesDirty(textures: SurfaceTextures): void {
  textures.glazeId.needsUpdate = true;
  textures.thickness.needsUpdate = true;
  textures.wax.needsUpdate = true;
  textures.underglaze.needsUpdate = true;
}
