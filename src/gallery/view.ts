import {
  ACESFilmicToneMapping,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getClay } from '../clay/clays';
import { pieceHeight } from '../clay/grid';
import type { PieceState } from '../core/types';
import { buildAttachmentGeometry } from '../render/attachmentMesh';
import { ClayMesh } from '../render/clayMesh';
import { applyClayFinish, createClayMaterial } from '../render/materials';
import { createSurfaceTextures, type SurfaceTextures } from '../render/surfaceTextures';

/** A spinning view of one pot, on its own canvas, so the wheel underneath can stay put. */
export class Turntable {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 0.02, 30);
  private readonly pivot = new Group();
  private clay: ClayMesh | null = null;
  private clayMaterial: MeshPhysicalMaterial | null = null;
  private handleMaterial: MeshPhysicalMaterial | null = null;
  private readonly attachments: Mesh[] = [];
  private readonly textures: SurfaceTextures[] = [];
  private frameId = 0;
  private running = false;
  private last = 0;
  private dragging = false;
  private lastX = 0;
  private auto = true;
  private resumeAt = 0;
  private heightM = 0.08;
  private radiusM = 0.05;
  private sheetHeight = () => 0;
  private readonly onDown: (event: PointerEvent) => void;
  private readonly onMove: (event: PointerEvent) => void;
  private readonly onUp: (event: PointerEvent) => void;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: pixelRatio < 1.5,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setClearColor(new Color('#3a2e28'), 1);
    this.scene.background = new Color('#3a2e28');

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const hemi = new HemisphereLight(0xfff6ec, 0x3a2a22, 0.55);
    const key = new DirectionalLight(0xfff0dc, 3.3);
    key.position.set(-0.85, 1.25, 0.7);
    this.scene.add(hemi, key);

    const table = new Mesh(
      new CylinderGeometry(0.42, 0.42, 0.02, 40),
      new MeshStandardMaterial({ color: 0x6a4a36, roughness: 0.86, metalness: 0 }),
    );
    table.position.y = -0.012;
    this.scene.add(table);
    this.pivot.frustumCulled = false;
    this.scene.add(this.pivot);

    this.onDown = (event) => {
      if (event.button !== 0) return;
      this.dragging = true;
      this.auto = false;
      this.lastX = event.clientX;
      this.canvas.setPointerCapture(event.pointerId);
    };
    this.onMove = (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastX;
      this.lastX = event.clientX;
      this.pivot.rotation.y += dx * 0.01;
    };
    this.onUp = () => {
      this.dragging = false;
      this.resumeAt = performance.now() + 1400;
    };
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
  }

  show(piece: PieceState, sheetHeight: () => number): void {
    this.sheetHeight = sheetHeight;
    this.clearPot();
    const clay = getClay(piece.clayTypeId);
    this.clayMaterial = createClayMaterial();
    applyClayFinish(this.clayMaterial, clay, piece.stage);
    this.handleMaterial = createClayMaterial();
    applyClayFinish(this.handleMaterial, clay, piece.stage);
    this.handleMaterial.vertexColors = false;

    const mesh = new ClayMesh(piece.grid.rings, piece.grid.segments);
    const previous = mesh.mesh.material;
    mesh.mesh.material = this.clayMaterial;
    if (previous instanceof MeshPhysicalMaterial && previous !== this.clayMaterial) previous.dispose();
    mesh.update(piece.grid);
    this.clay = mesh;
    this.pivot.add(mesh.mesh);
    const body = piece.surfaces.find((entry) => entry.meshId === 'body');
    if (body) this.bindSurface(mesh.mesh, body);

    for (const attachment of piece.attachments) {
      const handle = new Mesh(buildAttachmentGeometry(attachment), this.handleMaterial);
      this.pivot.add(handle);
      this.attachments.push(handle);
      const surface = piece.surfaces.find((entry) => entry.meshId === attachment.id);
      if (surface) this.bindSurface(handle, { meshId: surface.meshId, map: surface.map });
    }

    this.heightM = Math.max(0.02, pieceHeight(piece.grid));
    this.radiusM = 0.04;
    for (let i = 0; i < piece.grid.outer.length; i++) this.radiusM = Math.max(this.radiusM, piece.grid.outer[i] ?? 0);
    this.resize();
    this.start();
  }

  resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.frameCamera();
  }

  /** Synchronous so a share or download can start in the same tap. */
  snapshotBlob(): Blob | null {
    try {
      this.resize();
      if (this.canvas.width < 2 || this.canvas.height < 2) return null;
      this.renderer.render(this.scene, this.camera);
      return dataUrlToBlob(this.canvas.toDataURL('image/jpeg', 0.92));
    } catch {
      return null;
    }
  }

  idle(): void {
    this.clearPot();
    this.resize();
    this.start();
  }

  dispose(): void {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.clearPot();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }

  private bindSurface(mesh: Mesh, surface: { meshId: string; map: PieceState['surfaces'][number]['map'] }): void {
    const textures = createSurfaceTextures(surface.map);
    this.textures.push(textures);
    mesh.userData.surfaceTextures = textures;
    mesh.userData.meshId = surface.meshId;
  }

  private frameCamera(): void {
    const aspect = Math.max(0.45, this.camera.aspect || 0.6);
    const span = Math.max(0.12, this.heightM * 1.35, this.radiusM * 2.5);
    const worldHeight = span / Math.max(0.35, aspect);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const distance = worldHeight / (2 * Math.tan(vFov / 2));
    const viewH = Math.max(1, this.canvas.clientHeight);
    const sheetFraction = Math.max(0, Math.min(0.7, this.sheetHeight() / viewH));
    const lookY = this.heightM * 0.42 - sheetFraction * worldHeight * 0.42;
    this.camera.position.set(distance * 0.22, lookY + distance * 0.16, distance * 0.96);
    this.camera.lookAt(0, lookY, 0);
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (!this.dragging && !this.auto && now >= this.resumeAt) this.auto = true;
      if (this.auto) this.pivot.rotation.y += dt * 0.55;
      this.renderer.render(this.scene, this.camera);
      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  }

  private clearPot(): void {
    if (this.clay) {
      this.pivot.remove(this.clay.mesh);
      this.clay.geometry.dispose();
      this.clay = null;
    }
    for (const mesh of this.attachments) {
      this.pivot.remove(mesh);
      mesh.geometry.dispose();
    }
    this.attachments.length = 0;
    for (const textures of this.textures) {
      textures.glazeId.dispose();
      textures.thickness.dispose();
      textures.wax.dispose();
      textures.underglaze.dispose();
    }
    this.textures.length = 0;
    this.clayMaterial?.dispose();
    this.handleMaterial?.dispose();
    this.clayMaterial = null;
    this.handleMaterial = null;
  }
}

export function createTurntable(canvas: HTMLCanvasElement): Turntable | null {
  try {
    return new Turntable(canvas);
  } catch {
    return null;
  }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const mime = /data:([^;,]+)/.exec(dataUrl.slice(0, comma))?.[1] ?? 'image/jpeg';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
