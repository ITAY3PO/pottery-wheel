import { describe, expect, it } from 'vitest';
import { LinearFilter, NearestFilter } from 'three';
import { createSurfaceMap } from '../src/core/surfaceMap';
import {
  addClayShaderHook,
  clayMaterialsSharingHooks,
  cloneClayMaterial,
  createClayMaterial,
} from '../src/render/materials';
import { createSurfaceTextures, surfaceTexturesMatch } from '../src/render/surfaceTextures';

describe('clay materials', () => {
  it('shares shader hooks across per-mesh material instances', () => {
    const body = createClayMaterial();
    const handle = cloneClayMaterial(body);
    expect(handle).not.toBe(body);
    expect(handle.userData.hooks).toBe(body.userData.hooks);
    addClayShaderHook(body, (shader) => {
      shader.fragmentShader += '\n// glaze';
    }, 'glaze');
    expect(handle.customProgramCacheKey()).toBe(body.customProgramCacheKey());
    expect(handle.customProgramCacheKey()).toContain('glaze');
    expect(clayMaterialsSharingHooks(body)).toHaveLength(2);
    handle.dispose();
    expect(clayMaterialsSharingHooks(body)).toEqual([body]);
  });
});

describe('surface textures', () => {
  it('nearest-filters float thickness and keeps byte maps linear', () => {
    const map = createSurfaceMap(4, 4);
    const textures = createSurfaceTextures(map);
    expect(textures.thickness.magFilter).toBe(NearestFilter);
    expect(textures.thickness.minFilter).toBe(NearestFilter);
    expect(textures.thickness.generateMipmaps).toBe(false);
    expect(textures.glazeId.magFilter).toBe(LinearFilter);
    expect(textures.wax.minFilter).toBe(LinearFilter);
    expect(surfaceTexturesMatch(textures, map)).toBe(true);
    expect(surfaceTexturesMatch(textures, createSurfaceMap(4, 4))).toBe(false);
    textures.glazeId.dispose();
    textures.thickness.dispose();
    textures.wax.dispose();
    textures.underglaze.dispose();
  });
});
