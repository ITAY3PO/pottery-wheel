import { DataTexture, FloatType, NearestFilter, NoColorSpace, RGBAFormat, SRGBColorSpace, UnsignedByteType, type MeshPhysicalMaterial } from 'three';
import { events } from '../core/events';
import type { PieceState, StageId } from '../core/types';
import { addClayShaderHook, clayMaterialsSharingHooks, clayRootMaterial, type ClayShader } from '../render/materials';
import { GLAZES } from '../surface/catalog';

const PALETTE = 16;
/** Studio shaders. A gallery turntable pins its own fire value and stays out of this set. */
const studioShaders = new Set<ClayShader>();
const pinnedFire = new WeakMap<ClayShader, number>();
const hookedMaterials = new WeakSet<MeshPhysicalMaterial>();
const materialShaders = new WeakMap<MeshPhysicalMaterial, Set<ClayShader>>();
let hooked = false;
let currentFire = -1;
let warned = false;
let frameBound = false;

const colorTex = buildColorPalette();
const paramsTex = buildParamsPalette();

/** Sample the wheel piece on each frame, after `syncPiece` and before the draw. */
export function bindGlazeFrame(): void {
  if (frameBound) return;
  frameBound = true;
  events.on('frame', ({ piece }) => {
    refreshGlazeLook(piece);
  });
}

/**
 * Fired look on the studio MeshPhysicalMaterial.
 * Runs after `syncPiece`, which applies the stage finish first.
 * Samples the core uniforms (`uSurfaceGlaze`, `uSurfaceThickness`, `uSurfaceWax`).
 * Thickness is a nearest float. Byte channels are 0..1, so wax and glaze ids
 * are decoded with * 255. If an id is set and the thickness sample is ~0
 * (a float texture that failed to read), the coat is treated as 0.4 mm.
 */
export function refreshGlazeLook(piece: PieceState | null): void {
  if (!piece) return;
  const material = clayRootMaterial();
  if (!material) return;
  const stage = piece.stage;
  const active = stage === 'bisque' || stage === 'glazed' || stage === 'glaze-fired';
  if (active && !hooked) {
    addClayShaderHook(material, glazeHook, 'glaze-fire');
    hooked = true;
  }
  currentFire = fireForStage(stage);
  for (const shader of studioShaders) {
    if (pinnedFire.has(shader)) continue;
    const slot = shader.uniforms.uPwFire;
    if (slot) slot.value = currentFire;
  }
  if (stage === 'bisque' || stage === 'glazed') applyRawFinish(material);
}

/**
 * Fired or chalky glaze on a material that is not the studio body.
 * Gallery shelf turntables and the shared view each build their own materials.
 * `meshId` records which surface this material stands for. The samplers still
 * come from that mesh's `userData.surfaceTextures` at draw time.
 * A pinned fire value is not overwritten when the wheel piece changes stage.
 */
export function applyFiredLook(material: MeshPhysicalMaterial, piece: PieceState, meshId: string): void {
  const fire = fireForStage(piece.stage);
  material.userData.pwFire = fire;
  material.userData.pwFiredMeshId = meshId;
  material.metalness = 0;
  if (meshId !== 'body') dressAttachmentMaterial(material);
  if (!hookedMaterials.has(material)) {
    hookedMaterials.add(material);
    addClayShaderHook(
      material,
      (shader) => {
        glazeHook(shader);
        let set = materialShaders.get(material);
        if (!set) {
          set = new Set();
          materialShaders.set(material, set);
        }
        set.add(shader);
        pinShader(shader, Number(material.userData.pwFire));
      },
      'glaze-fire',
    );
  } else {
    const set = materialShaders.get(material);
    if (set) for (const shader of set) pinShader(shader, fire);
  }
  if (piece.stage === 'bisque' || piece.stage === 'glazed') applyRawFinish(material);
}

function fireForStage(stage: StageId): number {
  if (stage === 'glaze-fired') return 1;
  if (stage === 'bisque' || stage === 'glazed') return 0;
  return -1;
}

function pinShader(shader: ClayShader, fire: number): void {
  studioShaders.delete(shader);
  pinnedFire.set(shader, fire);
  const slot = shader.uniforms.uPwFire;
  if (slot) slot.value = fire;
  else shader.uniforms.uPwFire = { value: fire };
}

function applyRawFinish(material: MeshPhysicalMaterial): void {
  for (const mat of clayMaterialsSharingHooks(material)) {
    mat.roughness = 0.96;
    mat.clearcoat = 0.02;
    mat.clearcoatRoughness = 0.8;
    mat.sheen = 0;
    mat.envMapIntensity = 0.25;
    mat.metalness = 0;
  }
}

/**
 * A handle is a thin tube. The body's clearcoat, sheen, and env map turn that
 * tube into a chrome mirror, and vertex colors with no color attribute zero
 * the albedo. Keep the clay dielectric and let the glaze shader supply the color.
 */
export function dressAttachmentMaterial(material: MeshPhysicalMaterial): void {
  let changed = false;
  if (material.metalness !== 0) {
    material.metalness = 0;
    changed = true;
  }
  if (material.vertexColors) {
    material.vertexColors = false;
    changed = true;
  }
  if (material.sheen !== 0) {
    material.sheen = 0;
    changed = true;
  }
  if (material.envMapIntensity > 0.4) {
    material.envMapIntensity = 0.4;
    changed = true;
  }
  if (material.clearcoat > 0.4) {
    material.clearcoat = 0.4;
    material.clearcoatRoughness = Math.max(material.clearcoatRoughness, 0.18);
    changed = true;
  }
  if (changed) material.needsUpdate = true;
}

/** Where a coat breaks to its edge color. Full coats stay at 0; thin coats approach `breakStrength`. */
export const GLAZE_BREAK_START_MM = 0.05;
export const GLAZE_BREAK_FULL_MM = 0.26;

export function glazeBreakAmount(thicknessMm: number, breakStrength: number, edge = 0): number {
  const span = GLAZE_BREAK_FULL_MM - GLAZE_BREAK_START_MM;
  const t = span <= 0 ? 1 : (thicknessMm - GLAZE_BREAK_START_MM) / span;
  const clamped = Math.min(1, Math.max(0, t));
  const curved = clamped * clamped * (3 - 2 * clamped);
  const thin = 1 - curved;
  const along = 0.8 + 0.2 * Math.min(1, Math.max(0, edge));
  return Math.min(1, Math.max(0, thin * breakStrength * along));
}

function assignGlazeUniform(shader: ClayShader, name: string, value: unknown): void {
  const slot = shader.uniforms[name];
  if (slot) slot.value = value;
  else shader.uniforms[name] = { value };
}

function glazeHook(shader: ClayShader): void {
  studioShaders.add(shader);
  assignGlazeUniform(shader, 'uPwColor', colorTex);
  assignGlazeUniform(shader, 'uPwParams', paramsTex);
  assignGlazeUniform(shader, 'uPwCurvScale', 0.03);
  if (!pinnedFire.has(shader)) assignGlazeUniform(shader, 'uPwFire', currentFire);
  else assignGlazeUniform(shader, 'uPwFire', pinnedFire.get(shader));

  if (shader.fragmentShader.includes('uniform float uPwFire')) return;

  const vertex = shader.vertexShader;
  const fragment = shader.fragmentShader;
  if (!warned && (!vertex.includes('#include <uv_vertex>') || !fragment.includes('#include <color_fragment>') || !fragment.includes('#include <roughnessmap_fragment>'))) {
    warned = true;
    console.warn('glaze hook: expected Three shader includes were missing');
  }

  shader.vertexShader = vertex
    .replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\nvarying vec2 vPwUv;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvPwUv = uv;');

  shader.fragmentShader = fragment
    .replace(
      '#include <uv_pars_fragment>',
      `#include <uv_pars_fragment>
varying vec2 vPwUv;
uniform sampler2D uSurfaceGlaze;
uniform sampler2D uSurfaceThickness;
uniform sampler2D uSurfaceWax;
uniform sampler2D uPwColor;
uniform sampler2D uPwParams;
uniform float uPwFire;
uniform float uPwCurvScale;
`,
    )
    .replace('#include <color_fragment>', `#include <color_fragment>\n${COLOR_GLSL}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH_GLSL}`)
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${COAT_GLSL}`);
}

function buildColorPalette(): DataTexture {
  const data = new Uint8Array(PALETTE * 3 * 4);
  for (const glaze of GLAZES) {
    writeColor(data, glaze.id, 0, glaze.raw);
    writeColor(data, glaze.id, 1, glaze.fired);
    writeColor(data, glaze.id, 2, glaze.breakColor);
  }
  const texture = new DataTexture(data, PALETTE, 3, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function buildParamsPalette(): DataTexture {
  const data = new Float32Array(PALETTE * 2 * 4);
  for (const glaze of GLAZES) {
    const row0 = (0 * PALETTE + glaze.id) * 4;
    data[row0] = glaze.roughness;
    data[row0 + 1] = glaze.break;
    data[row0 + 2] = glaze.pool;
    data[row0 + 3] = glaze.cover;
    const row1 = (1 * PALETTE + glaze.id) * 4;
    data[row1] = glaze.crawlAt / 2.55;
  }
  const texture = new DataTexture(data, PALETTE, 2, RGBAFormat, FloatType);
  texture.colorSpace = NoColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function writeColor(data: Uint8Array, id: number, row: number, hex: string): void {
  const n = Number.parseInt(hex.slice(1), 16);
  const i = (row * PALETTE + id) * 4;
  data[i] = (n >> 16) & 255;
  data[i + 1] = (n >> 8) & 255;
  data[i + 2] = n & 255;
  data[i + 3] = 255;
}

const COLOR_GLSL = /* glsl */ `
{
  float pwCurv = length(fwidth(normalize(vNormal))) / max(length(fwidth(vViewPosition)), 1e-4);
  if (uPwFire > -0.5) {
    vec3 pwSample = texture2D(uSurfaceGlaze, vPwUv).rgb;
    float pwId = floor(max(pwSample.r, max(pwSample.g, pwSample.b)) * 255.0 + 0.5);
    vec3 pwWaxSample = texture2D(uSurfaceWax, vPwUv).rgb;
    float pwWax = floor(max(pwWaxSample.r, max(pwWaxSample.g, pwWaxSample.b)) * 255.0 + 0.5);
    float pwThick = texture2D(uSurfaceThickness, vPwUv).r;
    if (pwId > 0.5 && pwThick < 0.005) pwThick = 0.4;
    vec3 pwClay = diffuseColor.rgb;
    vec2 pwUvId = vec2((pwId + 0.5) / 16.0, 0.0);
    if (pwWax > 0.5) {
      if (uPwFire < 0.5) diffuseColor.rgb = mix(pwClay, vec3(0.93, 0.88, 0.72), 0.88);
      else diffuseColor.rgb = pwClay * vec3(0.74, 0.55, 0.40);
    } else if (pwId > 0.5) {
      float pwEdge = clamp(pwCurv * uPwCurvScale, 0.0, 1.0);
      vec4 pwP = texture2D(uPwParams, vec2(pwUvId.x, 0.25));
      float pwBreak = pwP.g;
      float pwPool = pwP.b;
      float pwCover = pwP.a;
      float pwCrawlAt = texture2D(uPwParams, vec2(pwUvId.x, 0.75)).r * 2.55;
      if (uPwFire < 0.5) {
        vec3 pwRaw = texture2D(uPwColor, vec2(pwUvId.x, 0.5 / 3.0)).rgb;
        float pwCoat = smoothstep(0.02, 0.28, pwThick) * max(pwCover, 0.35);
        diffuseColor.rgb = mix(pwClay, pwRaw, pwCoat);
      } else {
        vec3 pwFired = texture2D(uPwColor, vec2(pwUvId.x, 1.5 / 3.0)).rgb;
        vec3 pwBreakCol = texture2D(uPwColor, vec2(pwUvId.x, 2.5 / 3.0)).rgb;
        float pwThin = 1.0 - smoothstep(${GLAZE_BREAK_START_MM}, ${GLAZE_BREAK_FULL_MM}, pwThick);
        float pwBreakAmt = clamp(pwThin * pwBreak * mix(0.8, 1.0, pwEdge), 0.0, 1.0);
        float pwRecess = (1.0 - smoothstep(0.02, 0.4, pwEdge)) * smoothstep(0.28, 1.15, pwThick) * pwPool;
        vec3 pwGlaze = mix(pwFired, pwBreakCol, pwBreakAmt);
        pwGlaze *= mix(1.0, 0.62, clamp(pwRecess, 0.0, 1.0));
        float pwCovering = smoothstep(0.01, 0.07, pwThick);
        float pwTranslucent = smoothstep(0.02, 0.28, pwThick);
        float pwCoat = mix(pwTranslucent, pwCovering, pwCover) * pwCover;
        float pwBare = (1.0 - pwCover) * (1.0 - smoothstep(0.04, 0.16, pwThick));
        diffuseColor.rgb = mix(pwClay, pwGlaze, clamp(pwCoat * (1.0 - pwBare), 0.0, 1.0));
        float pwHash = fract(sin(dot(floor(vPwUv * vec2(64.0)), vec2(127.1, 311.7))) * 43758.5453);
        float pwCrawl = step(pwCrawlAt, pwThick) * step(0.58, pwHash);
        diffuseColor.rgb = mix(diffuseColor.rgb, pwClay, pwCrawl);
      }
    }
  }
}
`;

const ROUGH_GLSL = /* glsl */ `
if (uPwFire > -0.5 && uPwFire < 0.5) {
  roughnessFactor = 0.96;
} else if (uPwFire > 0.5) {
  vec3 pwSampleR = texture2D(uSurfaceGlaze, vPwUv).rgb;
  float pwIdR = floor(max(pwSampleR.r, max(pwSampleR.g, pwSampleR.b)) * 255.0 + 0.5);
  vec3 pwWaxR = texture2D(uSurfaceWax, vPwUv).rgb;
  float pwWaxByte = floor(max(pwWaxR.r, max(pwWaxR.g, pwWaxR.b)) * 255.0 + 0.5);
  if (pwWaxByte > 0.5 || pwIdR < 0.5) {
    roughnessFactor = max(roughnessFactor, 0.62);
  } else {
    float pwRough = texture2D(uPwParams, vec2((pwIdR + 0.5) / 16.0, 0.25)).r;
    float pwThickR = texture2D(uSurfaceThickness, vPwUv).r;
    if (pwThickR < 0.005) pwThickR = 0.4;
    roughnessFactor = mix(roughnessFactor, pwRough, smoothstep(0.02, 0.35, pwThickR));
  }
}
`;

const COAT_GLSL = /* glsl */ `
#ifdef USE_CLEARCOAT
if (uPwFire > -0.5 && uPwFire < 0.5) {
  material.clearcoat = 0.02;
  material.clearcoatRoughness = 0.8;
}
#endif
if (uPwFire > 0.5) {
  material.metalness = 0.0;
}
`;
