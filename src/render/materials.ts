import { Color, MeshPhysicalMaterial } from 'three';
import type { ClayType } from '../clay/clays';
import { colorForStage } from '../clay/clays';
import type { StageId } from '../core/types';

export interface ClayShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
}

/** Firing and glaze append hooks. The program cache key changes when they do. */
export type ClayShaderHook = (shader: ClayShader) => void;

interface Finish {
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  sheen: number;
}

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
  mat.userData.hooks = [] as ClayShaderHook[];
  mat.userData.hookKey = 'clay';
  mat.onBeforeCompile = (shader) => {
    const hooks = (mat.userData.hooks ?? []) as ClayShaderHook[];
    for (const hook of hooks) hook(shader);
  };
  mat.customProgramCacheKey = () => String(mat.userData.hookKey ?? 'clay');
  return mat;
}

/**
 * The firing agent calls this and writes `onBeforeCompile` via the hook list
 * rather than replacing the material. Set `needsUpdate` happens here.
 */
export function addClayShaderHook(mat: MeshPhysicalMaterial, hook: ClayShaderHook, key: string): void {
  const hooks = (mat.userData.hooks ??= []) as ClayShaderHook[];
  hooks.push(hook);
  mat.userData.hookKey = `${mat.userData.hookKey ?? 'clay'}|${key}`;
  mat.needsUpdate = true;
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
