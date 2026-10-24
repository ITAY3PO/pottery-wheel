import {
  CubeUVReflectionMapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * Prefiltered room, baked at build time. Generating it on the phone compiles
 * the PMREM shaders and blurs on the CPU during the first load.
 * Header is two little-endian uint32s (width, height) then RGBA HalfFloat.
 */
const url = `${import.meta.env.BASE_URL}room-pmrem.bin`;

let packed: Promise<{ width: number; height: number; pixels: Uint16Array }> | null = null;

function loadPacked(): Promise<{ width: number; height: number; pixels: Uint16Array }> {
  packed ??= fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Room map ${response.status}`);
    const buffer = await response.arrayBuffer();
    const header = new DataView(buffer);
    const width = header.getUint32(0, true);
    const height = header.getUint32(4, true);
    const pixels = new Uint16Array(buffer, 8);
    return { width, height, pixels };
  });
  return packed;
}

function roomTexture(width: number, height: number, pixels: Uint16Array): Texture {
  const texture = new DataTexture(pixels.slice(), width, height, RGBAFormat, HalfFloatType);
  texture.mapping = CubeUVReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** Each caller gets its own texture so disposing the gallery map leaves the studio's. */
export async function installBakedRoom(_renderer: WebGLRenderer, scene: Scene): Promise<void> {
  const { width, height, pixels } = await loadPacked();
  scene.environment = roomTexture(width, height, pixels);
}
