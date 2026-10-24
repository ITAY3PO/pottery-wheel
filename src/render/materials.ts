import {
  Color,
  DataTexture,
  FloatType,
  Mesh,
  MeshPhysicalMaterial,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
} from 'three';
import type { ClayType } from '../clay/clays';
import { colorForStage } from '../clay/clays';
import type { StageId } from '../core/types';
import type { SurfaceTextures } from './surfaceTextures';

export interface ClayShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
}

/** Firing and glaze append hooks. The program cache key changes when they do. */
export type ClayShaderHook = (shader: ClayShader) => void;

/**
 * Uniforms core declares on every clay material and points at that mesh's
 * `userData.surfaceTextures` before the mesh draws. Hooks should sample these
 * names and not assign `.value` from a single mesh.
 */
export const CLAY_SURFACE_UNIFORMS = {
  glazeId: 'uSurfaceGlaze',
  thickness: 'uSurfaceThickness',
  wax: 'uSurfaceWax',
  underglaze: 'uSurfaceUnderglaze',
} as const;

interface Finish {
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  sheen: number;
}

interface ClayFamily {
  hooks: ClayShaderHook[];
  hookKey: string;
  instances: Set<MeshPhysicalMaterial>;
}

const families = new WeakMap<MeshPhysicalMaterial, ClayFamily>();
const compiledShaders = new WeakMap<MeshPhysicalMaterial, ClayShader>();
const boundMaterials = new WeakSet<MeshPhysicalMaterial>();
const materialMesh = new WeakMap<MeshPhysicalMaterial, Mesh>();

let rootMaterial: MeshPhysicalMaterial | null = null;
let fallbackByte: DataTexture | null = null;
let fallbackFloat: DataTexture | null = null;

const FINISH: Record<StageId, Finish> = {
  wet: { roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.05, sheen: 0.42 },
  'leather-hard': { roughness: 0.64, clearcoat: 0.16, clearcoatRoughness: 0.55, envMapIntensity: 0.42, sheen: 0.08 },
  'bone-dry': { roughness: 0.94, clearcoat: 0.02, clearcoatRoughness: 0.8, envMapIntensity: 0.22, sheen: 0 },
  bisque: { roughness: 0.86, clearcoat: 0.04, clearcoatRoughness: 0.7, envMapIntensity: 0.32, sheen: 0 },
  glazed: { roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.28, envMapIntensity: 0.6, sheen: 0.12 },
  'glaze-fired': { roughness: 0.18, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 0.95, sheen: 0.2 },
};

export function createClayMaterial(): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({
    color: new Color('#7a5644'),
    roughness: FINISH.wet.roughness,
    metalness: 0,
    clearcoat: FINISH.wet.clearcoat,
    clearcoatRoughness: FINISH.wet.clearcoatRoughness,
    sheen: FINISH.wet.sheen,
    sheenColor: new Color('#fff6ee'),
    sheenRoughness: 0.45,
    envMapIntensity: FINISH.wet.envMapIntensity,
    vertexColors: true,
  });
  wireMaterial(mat, { hooks: [], hookKey: 'clay', instances: new Set() });
  return mat;
}

/**
 * A second clay mesh (a handle, a coil) gets its own material so a glaze
 * uniform on the body does not show up on the attachment. The clone shares
 * the hook list and the program-cache key with `source`.
 */
export function cloneClayMaterial(source: MeshPhysicalMaterial): MeshPhysicalMaterial {
  const clone = source.clone();
  wireMaterial(clone, familyOf(source));
  return clone;
}

/** Body material, once the studio has registered it. Null before startup. */
export function clayRootMaterial(): MeshPhysicalMaterial | null {
  return rootMaterial;
}

/** Studio calls this with the long-lived body material. */
export function setClayRootMaterial(material: MeshPhysicalMaterial): void {
  rootMaterial = material;
}

export function clayMaterialsSharingHooks(material: MeshPhysicalMaterial): MeshPhysicalMaterial[] {
  const data = families.get(material);
  return data ? [...data.instances] : [material];
}

/**
 * The firing agent calls this and writes `onBeforeCompile` via the hook list
 * rather than replacing the material. Every material that shares the list
 * recompiles. Set `needsUpdate` happens here.
 */
export function addClayShaderHook(mat: MeshPhysicalMaterial, hook: ClayShaderHook, key: string): void {
  const data = familyOf(mat);
  data.hooks.push(hook);
  data.hookKey = `${data.hookKey}|${key}`;
  for (const instance of data.instances) {
    instance.userData.hookKey = data.hookKey;
    instance.needsUpdate = true;
  }
}

export function applyClayFinish(mat: MeshPhysicalMaterial, clay: ClayType, stage: StageId): void {
  mat.color.set(colorForStage(clay, stage));
  const finish = FINISH[stage];
  mat.roughness = finish.roughness;
  mat.clearcoat = finish.clearcoat;
  mat.clearcoatRoughness = finish.clearcoatRoughness;
  mat.envMapIntensity = finish.envMapIntensity;
  mat.sheen = finish.sheen;
}

/**
 * Point this mesh's material uniforms at `mesh.userData.surfaceTextures`.
 * Safe to call again when the mesh is recreated on the same material.
 */
export function bindSurfaceUniforms(mesh: Mesh): void {
  const material = mesh.material;
  if (Array.isArray(material) || !(material instanceof MeshPhysicalMaterial)) return;
  materialMesh.set(material, mesh);
  mesh.onBeforeRender = () => {
    const shader = compiledShaders.get(material);
    if (shader) applySurfaceUniforms(shader, mesh);
  };
  if (boundMaterials.has(material)) return;
  boundMaterials.add(material);
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    const compiled = shader as unknown as ClayShader;
    compiledShaders.set(material, compiled);
    const current = materialMesh.get(material);
    if (current) applySurfaceUniforms(compiled, current);
  };
}

function familyOf(source: MeshPhysicalMaterial): ClayFamily {
  const existing = families.get(source);
  if (existing) return existing;
  const hooks = Array.isArray(source.userData.hooks) ? (source.userData.hooks as ClayShaderHook[]) : [];
  const data: ClayFamily = {
    hooks: hooks.filter((hook) => typeof hook === 'function'),
    hookKey: typeof source.userData.hookKey === 'string' ? source.userData.hookKey : 'clay',
    instances: new Set(),
  };
  wireMaterial(source, data);
  return data;
}

function wireMaterial(mat: MeshPhysicalMaterial, data: ClayFamily): void {
  const previous = families.get(mat);
  previous?.instances.delete(mat);
  families.set(mat, data);
  data.instances.add(mat);
  mat.userData.hooks = data.hooks;
  mat.userData.hookKey = data.hookKey;
  mat.onBeforeCompile = (shader) => {
    const compiled = shader as unknown as ClayShader;
    compiledShaders.set(mat, compiled);
    declareSurfaceUniforms(compiled);
    for (const hook of data.hooks) hook(compiled);
  };
  mat.customProgramCacheKey = () => data.hookKey;
  mat.addEventListener('dispose', () => {
    data.instances.delete(mat);
    if (families.get(mat) === data) families.delete(mat);
  });
}

function declareSurfaceUniforms(shader: ClayShader): void {
  const blank = fallbackTextures();
  shader.uniforms[CLAY_SURFACE_UNIFORMS.glazeId] ??= { value: blank.byte };
  shader.uniforms[CLAY_SURFACE_UNIFORMS.thickness] ??= { value: blank.float };
  shader.uniforms[CLAY_SURFACE_UNIFORMS.wax] ??= { value: blank.byte };
  shader.uniforms[CLAY_SURFACE_UNIFORMS.underglaze] ??= { value: blank.byte };
}

function applySurfaceUniforms(shader: ClayShader, mesh: Mesh): void {
  const textures = mesh.userData.surfaceTextures as SurfaceTextures | undefined;
  const blank = fallbackTextures();
  setUniform(shader, CLAY_SURFACE_UNIFORMS.glazeId, textures?.glazeId ?? blank.byte);
  setUniform(shader, CLAY_SURFACE_UNIFORMS.thickness, textures?.thickness ?? blank.float);
  setUniform(shader, CLAY_SURFACE_UNIFORMS.wax, textures?.wax ?? blank.byte);
  setUniform(shader, CLAY_SURFACE_UNIFORMS.underglaze, textures?.underglaze ?? blank.byte);
}

function setUniform(shader: ClayShader, name: string, value: DataTexture): void {
  const slot = shader.uniforms[name];
  if (slot) slot.value = value;
  else shader.uniforms[name] = { value };
}

function fallbackTextures(): { byte: DataTexture; float: DataTexture } {
  if (!fallbackByte || !fallbackFloat) {
    fallbackByte = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat, UnsignedByteType);
    fallbackByte.needsUpdate = true;
    fallbackFloat = new DataTexture(new Float32Array([0]), 1, 1, RedFormat, FloatType);
    fallbackFloat.magFilter = NearestFilter;
    fallbackFloat.minFilter = NearestFilter;
    fallbackFloat.generateMipmaps = false;
    fallbackFloat.needsUpdate = true;
  }
  return { byte: fallbackByte, float: fallbackFloat };
}
