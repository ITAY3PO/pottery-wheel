import {
  ACESFilmicToneMapping,
  BackSide,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  Object3D,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getClay } from '../clay/clays';
import { dressAttachmentMaterial } from '../firing/look';
import { maxOuterAtRing, pieceHeight } from '../clay/grid';
import type { Attachment, MeshSurface, PieceState, SurfaceHit } from '../core/types';
import { buildAttachmentGeometry } from './attachmentMesh';
import { CameraRig } from './cameraRig';
import { ClayMesh } from './clayMesh';
import { raycastToUV } from './raycastUV';
import {
  applyClayFinish,
  bindSurfaceUniforms,
  clayMaterialsSharingHooks,
  cloneClayMaterial,
  createClayMaterial,
  setClayRootMaterial,
} from './materials';
import {
  createSurfaceTextures,
  disposeSurfaceTextures,
  markSurfaceTexturesDirty,
  surfaceTexturesMatch,
  type SurfaceTextures,
} from './surfaceTextures';

export class Studio {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly clayPivot = new Group();
  readonly wheelPivot = new Group();
  private clayMesh: ClayMesh | null = null;
  private readonly attachmentRoot = new Group();
  private readonly attachmentMeshes = new Map<string, Mesh>();
  private readonly surfaceCache = new Map<string, SurfaceTextures>();
  private surfacePieceId: string | null = null;
  private bodyMaterial: MeshPhysicalMaterial | null = null;
  private finishStage = '';
  private finishClay = '';
  private releaseAngle = 0;
  private lift = 0;
  private readonly contact: Mesh;
  private readonly toolContacts = new Map<string, Mesh>();
  private readonly wire: Mesh;
  private chipMesh: InstancedMesh | null = null;
  private readonly chipDummy = new Object3D();

  constructor(canvas: HTMLCanvasElement) {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new WebGLRenderer({
      canvas,
      // DPR 2 already samples finely. MSAA on top of that blows the fill rate
      // on a mid-range phone, which is the machine this has to hold 60fps on.
      antialias: pixelRatio < 1.5,
      alpha: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setClearColor(new Color('#3a2e28'), 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const key = new DirectionalLight(0xfff0dc, 3.4);
    key.position.set(-0.85, 1.25, 0.62);
    this.scene.add(key);

    this.scene.add(buildCove());
    this.scene.add(buildTable());
    this.scene.add(buildPan());
    this.scene.add(this.wheelPivot);
    buildWheelHead(this.wheelPivot);

    this.clayPivot.add(this.attachmentRoot);
    this.scene.add(this.clayPivot);

    this.contact = new Mesh(
      new SphereGeometry(0.006, 16, 12),
      new MeshStandardMaterial({ color: 0xfff4e8, roughness: 0.35, metalness: 0 }),
    );
    this.contact.visible = false;
    this.scene.add(this.contact);
    for (const mesh of throwingContacts()) {
      mesh.visible = false;
      this.toolContacts.set(mesh.name, mesh);
      this.scene.add(mesh);
    }

    this.wire = new Mesh(
      new CylinderGeometry(0.00055, 0.00055, 1, 6),
      new MeshStandardMaterial({ color: 0xd7dadf, metalness: 0.88, roughness: 0.22 }),
    );
    this.wire.rotation.z = Math.PI / 2;
    this.wire.visible = false;
    this.scene.add(this.wire);

    this.bodyMaterial = createClayMaterial();
    setClayRootMaterial(this.bodyMaterial);
  }

  setSize(width: number, height: number, sheetHeight: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, true);
    this.rig.resize(width, height, sheetHeight);
  }

  syncPiece(piece: PieceState | null): void {
    if (!piece) {
      if (this.clayMesh) {
        delete this.clayMesh.mesh.userData.surfaceTextures;
        this.clayPivot.remove(this.clayMesh.mesh);
        this.clayMesh.geometry.dispose();
        this.clayMesh = null;
      }
      this.clearAttachments();
      this.clearSurfaceCache();
      this.surfacePieceId = null;
      this.rig.frameWheel();
      return;
    }
    if (this.surfacePieceId !== piece.id) {
      this.clearSurfaceCache();
      this.forgetSurfaceBindings();
      this.surfacePieceId = piece.id;
    }
    if (
      !this.clayMesh ||
      this.clayMesh.rings !== piece.grid.rings ||
      this.clayMesh.segments !== piece.grid.segments
    ) {
      if (this.clayMesh) {
        this.clayPivot.remove(this.clayMesh.mesh);
        this.clayMesh.geometry.dispose();
      }
      this.clayMesh = new ClayMesh(piece.grid.rings, piece.grid.segments, this.ensureBodyMaterial());
      bindSurfaceUniforms(this.clayMesh.mesh);
      this.clayPivot.add(this.clayMesh.mesh);
      this.finishStage = '';
    }
    this.clayMesh.update(piece.grid);
    if (this.finishStage !== piece.stage || this.finishClay !== piece.clayTypeId) {
      const clay = getClay(piece.clayTypeId);
      const bodyMaterial = this.ensureBodyMaterial();
      for (const material of clayMaterialsSharingHooks(bodyMaterial)) {
        applyClayFinish(material, clay, piece.stage);
        if (material !== bodyMaterial) dressAttachmentMaterial(material);
      }
      this.finishStage = piece.stage;
      this.finishClay = piece.clayTypeId;
    }
    this.syncSurfaces(piece);
    this.syncAttachments(piece);
    const height = pieceHeight(piece.grid);
    let radius = 0.04;
    for (let ring = 0; ring < piece.grid.rings; ring += 4) {
      radius = Math.max(radius, maxOuterAtRing(piece.grid, ring));
    }
    this.rig.framePiece(height, radius);
  }

  spin(angle: number, onWheel: boolean, dt: number): void {
    this.wheelPivot.rotation.y = angle;
    if (onWheel) {
      this.clayPivot.rotation.y = angle;
      this.releaseAngle = angle;
      this.lift = 0;
    } else {
      this.clayPivot.rotation.y = this.releaseAngle;
      this.lift += (0.014 - this.lift) * Math.min(1, dt * 6);
    }
    this.clayPivot.position.y = this.lift;
  }

  /** Keep the empty wheel turning gently on the setup screen. */
  idleSpin(angle: number): void {
    this.wheelPivot.rotation.y = angle;
  }

  showContact(
    visible: boolean,
    x: number,
    y: number,
    pressure: number,
    toolId = '',
    z?: number,
    side?: 1 | -1,
  ): void {
    this.contact.visible = false;
    for (const mesh of this.toolContacts.values()) mesh.visible = false;
    if (!visible) return;
    // Core passes the active tool id. Markers stay in sync with the sheet chip
    // without reading the DOM mid-gesture.
    const id = toolId;
    const mesh = (id && this.toolContacts.get(id)) || this.contact;
    mesh.visible = true;
    const yPos = Math.max(0, y);
    const zPos = z ?? (id === 'water' ? 0.018 : 0.014);
    mesh.position.set(x, yPos, zPos);
    const pressed = 0.75 + Math.max(0, Math.min(1, pressure)) * 1.15;
    const dir = side ?? (x >= 0 ? 1 : -1);
    if (id === 'needle') mesh.scale.setScalar(1);
    else if (id === 'knife') mesh.scale.set(dir, 0.85 + pressure * 0.35, 0.85 + pressure * 0.35);
    else if (id === 'rib') mesh.scale.set(dir, 1, 1);
    else if (id === 'sponge') mesh.scale.setScalar(1.05 + pressure * 0.4);
    else mesh.scale.setScalar(pressed);
  }

  showWire(visible: boolean, y: number, width: number): void {
    this.wire.visible = visible;
    if (!visible) return;
    this.wire.position.set(0, Math.max(0.002, y), 0.012);
    this.wire.scale.set(1, Math.max(0.06, width), 1);
  }

  /** Leather-hard trimmings. Positions are world meters; `size` is the chip radius. */
  showTrimChips(chips: readonly { x: number; y: number; z: number; size: number }[]): void {
    if (chips.length === 0) {
      if (this.chipMesh) {
        this.chipMesh.visible = false;
        this.chipMesh.count = 0;
      }
      return;
    }
    if (!this.chipMesh) {
      this.chipMesh = new InstancedMesh(
        new SphereGeometry(1, 6, 5),
        new MeshStandardMaterial({ color: 0xa78468, roughness: 0.74, metalness: 0 }),
        48,
      );
      this.chipMesh.frustumCulled = false;
      this.scene.add(this.chipMesh);
    }
    const count = Math.min(chips.length, 48);
    this.chipMesh.count = count;
    this.chipMesh.visible = true;
    for (let i = 0; i < count; i++) {
      const chip = chips[i];
      this.chipDummy.position.set(chip.x, chip.y, chip.z);
      this.chipDummy.scale.setScalar(Math.max(0.0008, chip.size));
      this.chipDummy.updateMatrix();
      this.chipMesh.setMatrixAt(i, this.chipDummy.matrix);
    }
    this.chipMesh.instanceMatrix.needsUpdate = true;
  }

  bodyObjects(): Mesh[] {
    const meshes: Mesh[] = [];
    if (this.clayMesh) meshes.push(this.clayMesh.mesh);
    for (const mesh of this.attachmentMeshes.values()) meshes.push(mesh);
    return meshes;
  }

  /** UV hit from the ray `CameraRig.aimPointer` just aimed. */
  hitTest(): SurfaceHit | null {
    this.clayPivot.updateWorldMatrix(true, true);
    return raycastToUV(this.rig.pointerRaycaster, this.bodyObjects());
  }

  /** Upload the cached GPU copy after a tool paints this mesh's surface map. */
  markSurfaceDirty(meshId: string): void {
    const textures = this.surfaceCache.get(meshId);
    if (textures) markSurfaceTexturesDirty(textures);
  }

  render(dt: number): void {
    this.rig.update(dt);
    this.renderer.render(this.scene, this.rig.camera);
  }

  private syncSurfaces(piece: PieceState): void {
    if (!this.clayMesh) return;
    const body = piece.surfaces.find((surface) => surface.meshId === 'body');
    if (body) this.ensureTextures(this.clayMesh.mesh, body);
  }

  /** Dress and point glaze uniforms at this mesh. Runs for a new mesh and for a geometry-only update. */
  private bindAttachmentMaterial(mesh: Mesh): void {
    const material = mesh.material;
    if (Array.isArray(material) || !(material instanceof MeshPhysicalMaterial)) return;
    if (material !== this.bodyMaterial) dressAttachmentMaterial(material);
    bindSurfaceUniforms(mesh);
  }

  private ensureTextures(mesh: Mesh, surface: MeshSurface): void {
    let textures = this.surfaceCache.get(surface.meshId);
    if (textures && !surfaceTexturesMatch(textures, surface.map)) {
      disposeSurfaceTextures(textures);
      this.surfaceCache.delete(surface.meshId);
      textures = undefined;
    }
    if (!textures) {
      textures = createSurfaceTextures(surface.map);
      this.surfaceCache.set(surface.meshId, textures);
    }
    mesh.userData.surfaceTextures = textures;
    mesh.userData.meshId = surface.meshId;
  }

  private syncAttachments(piece: PieceState): void {
    const live = new Set(piece.attachments.map((attachment) => attachment.id));
    for (const [id, mesh] of this.attachmentMeshes) {
      if (live.has(id)) continue;
      this.releaseAttachment(mesh);
      this.attachmentMeshes.delete(id);
      const cached = this.surfaceCache.get(id);
      if (cached) {
        disposeSurfaceTextures(cached);
        this.surfaceCache.delete(id);
      }
    }
    for (const attachment of piece.attachments) {
      const signature = attachmentSignature(attachment);
      let mesh = this.attachmentMeshes.get(attachment.id);
      if (!mesh || mesh.userData.signature !== signature) {
        if (mesh) {
          this.releaseAttachment(mesh);
          this.attachmentMeshes.delete(attachment.id);
        }
        const material = cloneClayMaterial(this.ensureBodyMaterial());
        mesh = new Mesh(buildAttachmentGeometry(attachment), material);
        mesh.userData.signature = signature;
        mesh.userData.meshId = attachment.id;
        this.attachmentRoot.add(mesh);
        this.attachmentMeshes.set(attachment.id, mesh);
      }
      this.bindAttachmentMaterial(mesh);
      const surface = piece.surfaces.find((entry) => entry.meshId === attachment.id);
      if (surface && mesh) this.ensureTextures(mesh, surface);
    }
  }

  private clearAttachments(): void {
    for (const mesh of this.attachmentMeshes.values()) this.releaseAttachment(mesh);
    this.attachmentMeshes.clear();
  }

  private releaseAttachment(mesh: Mesh): void {
    this.attachmentRoot.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material;
    if (material instanceof MeshPhysicalMaterial && material !== this.bodyMaterial) material.dispose();
  }

  private ensureBodyMaterial(): MeshPhysicalMaterial {
    if (!this.bodyMaterial) {
      this.bodyMaterial = createClayMaterial();
      setClayRootMaterial(this.bodyMaterial);
    }
    return this.bodyMaterial;
  }

  private clearSurfaceCache(): void {
    for (const textures of this.surfaceCache.values()) disposeSurfaceTextures(textures);
    this.surfaceCache.clear();
  }

  private forgetSurfaceBindings(): void {
    if (this.clayMesh) delete this.clayMesh.mesh.userData.surfaceTextures;
    for (const mesh of this.attachmentMeshes.values()) delete mesh.userData.surfaceTextures;
  }
}

/** Contact markers for the throwing tools. Names match `data-tool` on the sheet. */
function throwingContacts(): Mesh[] {
  const ribGeo = new TorusGeometry(0.012, 0.0016, 5, 16, Math.PI * 0.92);
  ribGeo.rotateZ(Math.PI * 0.62);
  const rib = new Mesh(
    ribGeo,
    new MeshStandardMaterial({ color: 0xd5d8de, metalness: 0.86, roughness: 0.24 }),
  );
  rib.name = 'rib';

  const sponge = new Mesh(
    new SphereGeometry(0.009, 10, 8),
    new MeshStandardMaterial({ color: 0xe4b45a, roughness: 0.96, metalness: 0 }),
  );
  sponge.name = 'sponge';

  const water = new Mesh(
    new SphereGeometry(0.0052, 10, 8),
    new MeshStandardMaterial({
      color: 0x8ec8e4,
      roughness: 0.12,
      metalness: 0.04,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  );
  water.name = 'water';

  const needleGeo = new CylinderGeometry(0.0004, 0.00012, 0.032, 5);
  needleGeo.translate(0, 0.016, 0);
  const needle = new Mesh(
    needleGeo,
    new MeshStandardMaterial({ color: 0xd7dade, metalness: 0.9, roughness: 0.2 }),
  );
  needle.name = 'needle';

  const knifeGeo = new CylinderGeometry(0.0011, 0.0062, 0.02, 3);
  knifeGeo.rotateZ(Math.PI / 2);
  const knife = new Mesh(
    knifeGeo,
    new MeshStandardMaterial({ color: 0xc4a36a, roughness: 0.72, metalness: 0 }),
  );
  knife.name = 'knife';

  return [rib, sponge, water, needle, knife];
}

function attachmentSignature(attachment: Attachment): string {
  const points = attachment.points
    .map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)},${point.radius.toFixed(4)}`)
    .join(';');
  return `${attachment.kind}|${attachment.joinBlend}|${attachment.tubularSegments}|${points}`;
}

function buildCove(): Mesh {
  // Unlit. A lit sphere behind the camera shades every pixel with the PBR
  // stack, and the phone never sees a shadow there anyway.
  return new Mesh(
    new SphereGeometry(3.4, 24, 16),
    new MeshBasicMaterial({ color: 0x6a5344, side: BackSide }),
  );
}

function buildTable(): Mesh {
  const mesh = new Mesh(
    new CylinderGeometry(0.78, 0.78, 0.05, 48),
    new MeshStandardMaterial({ map: woodTexture('#7a4e32', '#5c3924'), color: 0xffffff, roughness: 0.86, metalness: 0 }),
  );
  mesh.position.y = -0.085;
  return mesh;
}

function buildPan(): Mesh {
  const points = [
    new Vector2(0.03, -0.055),
    new Vector2(0.15, -0.058),
    new Vector2(0.188, -0.03),
    new Vector2(0.206, 0.008),
    new Vector2(0.218, 0.03),
    new Vector2(0.206, 0.044),
    new Vector2(0.192, 0.02),
    new Vector2(0.178, -0.02),
    new Vector2(0.16, -0.046),
    new Vector2(0.04, -0.048),
  ];
  return new Mesh(
    new LatheGeometry(points, 64),
    new MeshPhysicalMaterial({
      color: 0xead7c4,
      roughness: 0.38,
      metalness: 0.02,
      clearcoat: 0.45,
      clearcoatRoughness: 0.28,
      side: DoubleSide,
    }),
  );
}

function buildWheelHead(pivot: Group): void {
  const head = new Mesh(
    new CylinderGeometry(0.146, 0.146, 0.02, 64),
    new MeshStandardMaterial({ color: 0x8d939a, metalness: 0.92, roughness: 0.34 }),
  );
  head.position.y = -0.02;
  pivot.add(head);

  const bat = new Mesh(
    new CylinderGeometry(0.122, 0.122, 0.009, 48),
    new MeshStandardMaterial({
      map: woodTexture('#d2b48a', '#b8926a'),
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0,
    }),
  );
  bat.position.y = -0.0045;
  pivot.add(bat);

  for (const radius of [0.045, 0.078, 0.11]) {
    const groove = new Mesh(
      new TorusGeometry(radius, 0.0014, 8, 48),
      new MeshStandardMaterial({ color: 0x2f3338, metalness: 0.7, roughness: 0.42 }),
    );
    groove.rotation.x = Math.PI / 2;
    groove.position.y = -0.0096;
    pivot.add(groove);
  }

  const nut = new Mesh(
    new CylinderGeometry(0.012, 0.012, 0.006, 20),
    new MeshStandardMaterial({ color: 0x4e545a, metalness: 0.8, roughness: 0.35 }),
  );
  nut.position.y = -0.003;
  pivot.add(nut);

  const shaft = new Mesh(
    new CylinderGeometry(0.018, 0.022, 0.06, 20),
    new MeshStandardMaterial({ color: 0x6a7076, metalness: 0.85, roughness: 0.38 }),
  );
  shaft.position.y = -0.055;
  pivot.add(shaft);
}

function woodTexture(light: string, dark: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new CanvasTexture(canvas);
    return fallback;
  }
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 28; i++) {
    const y = (i / 28) * 256 + Math.sin(i * 1.7) * 2;
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.18 + (i % 4) * 0.05;
    ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(80, y + 6, 160, y - 5, 256, y + 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
