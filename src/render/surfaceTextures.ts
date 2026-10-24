import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
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
  const glazeId = byteTexture(map.glazeId, map.width, map.height);
  const thickness = floatTexture(map.thickness, map.width, map.height);
  const wax = byteTexture(map.wax, map.width, map.height);
  const underglaze = byteTexture(map.underglazeId, map.width, map.height);
  return { glazeId, thickness, wax, underglaze };
}

export function markSurfaceTexturesDirty(textures: SurfaceTextures): void {
  textures.glazeId.needsUpdate = true;
  textures.thickness.needsUpdate = true;
  textures.wax.needsUpdate = true;
  textures.underglaze.needsUpdate = true;
}

export function disposeSurfaceTextures(textures: SurfaceTextures): void {
  textures.glazeId.dispose();
  textures.thickness.dispose();
  textures.wax.dispose();
  textures.underglaze.dispose();
}

/** True when the GPU copies still wrap this map's typed arrays. */
export function surfaceTexturesMatch(textures: SurfaceTextures, map: SurfaceMap): boolean {
  return (
    textureData(textures.glazeId) === map.glazeId &&
    textureData(textures.thickness) === map.thickness &&
    textureData(textures.wax) === map.wax &&
    textureData(textures.underglaze) === map.underglazeId
  );
}

function byteTexture(data: Uint8Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function floatTexture(data: Float32Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RedFormat, FloatType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  // Linear filtering of float textures needs OES_texture_float_linear.
  // Nearest is core on WebGL2, including phones that omit that extension.
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function textureData(texture: DataTexture): ArrayBufferView | null {
  const image = texture.image as { data?: ArrayBufferView } | null;
  return image?.data ?? null;
}
