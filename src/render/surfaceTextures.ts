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
  // Painting usually touches one or two channels. Re-uploading the other
  // 128² maps every dab is a long task on a phone GPU.
  uploadIfChanged(textures.glazeId);
  uploadIfChanged(textures.thickness);
  uploadIfChanged(textures.wax);
  uploadIfChanged(textures.underglaze);
}

function uploadIfChanged(texture: DataTexture): void {
  const data = textureData(texture);
  if (!data) {
    texture.needsUpdate = true;
    return;
  }
  const hash = hashBytes(data);
  const stamp = texture.userData as { pwHash?: number; pwLen?: number };
  if (stamp.pwHash === hash && stamp.pwLen === data.byteLength) return;
  stamp.pwHash = hash;
  stamp.pwLen = data.byteLength;
  texture.needsUpdate = true;
}

function hashBytes(data: ArrayBufferView): number {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
