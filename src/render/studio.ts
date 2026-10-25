import {
  ACESFilmicToneMapping,
  BackSide,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  OrthographicCamera,
  InstancedMesh,
  Mesh,
  Object3D,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  WebGLRenderer,
} from 'three';
import { getClay } from '../clay/clays';
import { dressAttachmentMaterial } from '../firing/look';
import { maxOuterAtRing, pieceHeight } from '../clay/grid';
import type { Attachment, MeshSurface, PieceState, SurfaceHit } from '../core/types';
import { buildAttachmentGeometry, writeAttachmentGeometry } from './attachmentMesh';
import { currentProfile, type QualityProfile } from './quality';
import { CameraRig } from './cameraRig';
import { ClayMesh } from './clayMesh';
import { raycastToUV } from './raycastUV';
import { yieldToMain } from '../core/yield';
import {
  applyClayFinish,
  bindSurfaceUniforms,
  clayMaterialUniformBound,
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
  private readonly contact: Mesh;
  private readonly toolContacts = new Map<string, Mesh>();
  private readonly wire: Mesh;
  private chipMesh: InstancedMesh | null = null;
  private readonly chipDummy = new Object3D();
  private readonly keyLight: DirectionalLight;
  private readonly table: Mesh;
  private readonly bodyList: Mesh[] = [];
  private bodyListDirty = true;
  private maxRings = 4096;
  private maxSegments = 4096;
  private qualityKey = '';
  private viewWidth = 1;
  private viewHeight = 1;
  private environmentReady = false;
  private environmentListener: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const profile = currentProfile();
    this.maxRings = profile.maxRings;
    this.maxSegments = profile.maxSegments;
    // desynchronized keeps the compositor from waiting on a CPU readback of the
    // drawing buffer, which is a multi-hundred-ms task under software GL.
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: profile.pixelRatio <= 1,
      depth: true,
      desynchronized: true,
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'high-performance',
      premultipliedAlpha: true,
      stencil: false,
    });
    this.renderer = new WebGLRenderer({
      canvas,
      context: gl ?? undefined,
      // MSAA on top of a phone-sized buffer blows the fill rate. Quality
      // turns it on only for a sharp desktop pixel.
      antialias: profile.pixelRatio <= 1,
      alpha: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setClearColor(new Color('#3a2e28'), 1);
    this.renderer.setPixelRatio(profile.pixelRatio);
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.enabled = profile.shadows;
    // getProgramInfoLog waits out the compiler. Production leaves it off so
    // compileAsync can poll KHR_parallel_shader_compile instead of stalling.
    this.renderer.debug.checkShaderErrors =
      import.meta.env.DEV || import.meta.env.MODE === 'test' || new URLSearchParams(location.search).has('debug');

    const key = new DirectionalLight(0xfff0dc, 3.4);
    key.position.set(-0.85, 1.25, 0.62);
    key.castShadow = profile.shadows;
    key.shadow.mapSize.set(512, 512);
    const shadowCamera = key.shadow.camera;
    if (shadowCamera instanceof OrthographicCamera) {
      shadowCamera.near = 0.08;
      shadowCamera.far = 3.2;
      shadowCamera.left = -0.55;
      shadowCamera.right = 0.55;
      shadowCamera.top = 0.75;
      shadowCamera.bottom = -0.28;
    }
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    this.keyLight = key;
    this.scene.add(key);

    this.scene.add(buildCove());
    this.table = buildTable();
    this.table.receiveShadow = profile.shadows;
    this.scene.add(this.table);
    this.scene.add(this.wheelPivot);
    buildWheelHead(this.wheelPivot, profile.shadows);
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
    this.viewWidth = width;
    this.viewHeight = height;
    this.renderer.setSize(width, height, true);
    this.rig.resize(width, height, sheetHeight);
  }

  /** Pixel ratio, shadow map, and clay mesh resolution. Mesh rebuilds once per change. */
  applyQuality(profile: QualityProfile): void {
    const key = `${profile.pixelRatio}|${profile.shadows ? 1 : 0}|${profile.maxRings}|${profile.maxSegments}`;
    if (key === this.qualityKey) return;
    this.qualityKey = key;
    const meshChanged = this.maxRings !== profile.maxRings || this.maxSegments !== profile.maxSegments;
    this.maxRings = profile.maxRings;
    this.maxSegments = profile.maxSegments;
    if (this.renderer.getPixelRatio() !== profile.pixelRatio) {
      this.renderer.setPixelRatio(profile.pixelRatio);
      this.renderer.setSize(this.viewWidth, this.viewHeight, true);
    }
    this.setShadows(profile.shadows);
    if (meshChanged && this.clayMesh) {
      this.clayPivot.remove(this.clayMesh.mesh);
      delete this.clayMesh.mesh.userData.surfaceTextures;
      this.clayMesh.geometry.dispose();
      this.clayMesh = null;
      this.bodyListDirty = true;
    }
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
    const rings = Math.max(8, Math.min(piece.grid.rings, this.maxRings));
    const segments = Math.max(8, Math.min(piece.grid.segments, this.maxSegments));
    if (!this.clayMesh || this.clayMesh.rings !== rings || this.clayMesh.segments !== segments) {
      if (this.clayMesh) {
        this.clayPivot.remove(this.clayMesh.mesh);
        delete this.clayMesh.mesh.userData.surfaceTextures;
        this.clayMesh.geometry.dispose();
      }
      this.clayMesh = new ClayMesh(rings, segments, this.ensureBodyMaterial());
      this.clayMesh.mesh.castShadow = this.renderer.shadowMap.enabled;
      this.clayMesh.mesh.receiveShadow = this.renderer.shadowMap.enabled;
      bindSurfaceUniforms(this.clayMesh.mesh);
      this.clayPivot.add(this.clayMesh.mesh);
      this.bodyListDirty = true;
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

  spin(angle: number, onWheel: boolean, _dt: number): void {
    this.wheelPivot.rotation.y = angle;
    if (onWheel) {
      this.clayPivot.rotation.y = angle;
      this.releaseAngle = angle;
    } else {
      this.clayPivot.rotation.y = this.releaseAngle;
    }
    // The piece stays on the bat. A 14mm rise used to clear the splash pan.
    this.clayPivot.position.y = 0;
  }

  /** World height of the bat's top face. */
  batTopY(): number {
    const bat = this.wheelPivot.getObjectByName('bat');
    if (!bat) return Number.NaN;
    bat.updateWorldMatrix(true, false);
    const geometry = (bat as Mesh).geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const localTop = geometry.boundingBox?.max.y ?? 0;
    const e = bat.matrixWorld.elements;
    return e[13] + e[5] * localTop;
  }

  /** World height of ring 0, the bottom of the clay. */
  pieceBottomY(gridBottom: number): number {
    this.clayPivot.updateWorldMatrix(true, false);
    const e = this.clayPivot.matrixWorld.elements;
    return e[13] + e[5] * gridBottom;
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
    footprint?: { x: number; y: number; z: number },
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
    if (footprint && mesh === this.contact) {
      mesh.scale.set(Math.max(0.2, footprint.x), Math.max(0.2, footprint.y), Math.max(0.2, footprint.z));
    } else if (id === 'needle') mesh.scale.setScalar(1);
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
    if (this.bodyListDirty) {
      this.bodyList.length = 0;
      if (this.clayMesh) this.bodyList.push(this.clayMesh.mesh);
      for (const mesh of this.attachmentMeshes.values()) this.bodyList.push(mesh);
      this.bodyListDirty = false;
    }
    return this.bodyList;
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
      this.bodyListDirty = true;
      const cached = this.surfaceCache.get(id);
      if (cached) {
        disposeSurfaceTextures(cached);
        this.surfaceCache.delete(id);
      }
    }
    for (const attachment of piece.attachments) {
      let mesh = this.attachmentMeshes.get(attachment.id);
      if (!mesh) {
        mesh = new Mesh(buildAttachmentGeometry(attachment), cloneClayMaterial(this.ensureBodyMaterial()));
        mesh.castShadow = this.renderer.shadowMap.enabled;
        mesh.receiveShadow = this.renderer.shadowMap.enabled;
        mesh.userData.meshId = attachment.id;
        rememberAttachment(mesh, attachment);
        this.attachmentRoot.add(mesh);
        this.attachmentMeshes.set(attachment.id, mesh);
        this.bodyListDirty = true;
      } else if (!attachmentUnchanged(mesh, attachment)) {
        if (!writeAttachmentGeometry(mesh.geometry, attachment)) {
          const next = buildAttachmentGeometry(attachment);
          mesh.geometry.dispose();
          mesh.geometry = next;
        }
        rememberAttachment(mesh, attachment);
      }
      // New meshes and geometry-only updates keep the same material. Rebind
      // glaze uniforms on both so a handle does not lose its coat.
      this.bindAttachmentMaterial(mesh);
      const surface = piece.surfaces.find((entry) => entry.meshId === attachment.id);
      if (surface && mesh) this.ensureTextures(mesh, surface);
    }
  }

  private clearAttachments(): void {
    for (const mesh of this.attachmentMeshes.values()) this.releaseAttachment(mesh);
    this.attachmentMeshes.clear();
    this.bodyListDirty = true;
  }

  private setShadows(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    this.keyLight.castShadow = enabled;
    this.table.receiveShadow = enabled;
    this.wheelPivot.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) mesh.receiveShadow = enabled;
    });
    if (this.clayMesh) {
      this.clayMesh.mesh.castShadow = enabled;
      this.clayMesh.mesh.receiveShadow = enabled;
    }
    for (const mesh of this.attachmentMeshes.values()) {
      mesh.castShadow = enabled;
      mesh.receiveShadow = enabled;
    }
  }

  /**
   * Compile one mesh at a time into a tiny target. The light stays on so the
   * lit program is the one that gets cached. Nothing is presented, so the
   * compositor does not read the canvas back on each turn.
   */
  async warmShaders(): Promise<void> {
    const camera = this.rig.camera;
    const children = [...this.scene.children];
    const childWasVisible = children.map((child) => child.visible);
    const meshes: Mesh[] = [];
    this.scene.traverse((node) => {
      if ((node as Mesh).isMesh) meshes.push(node as Mesh);
    });
    const meshWasVisible = meshes.map((mesh) => mesh.visible);
    for (const mesh of meshes) mesh.visible = false;
    for (const child of children) {
      if ((child as { isLight?: boolean }).isLight) continue;
      child.visible = false;
    }
    const compiled = new Set<string>();
    try {
      for (const mesh of meshes) {
        const material = mesh.material;
        const key = Array.isArray(material) ? '' : material.uuid;
        if (compiled.has(key)) continue;
        compiled.add(key);
        const opened: Object3D[] = [];
        let parent: Object3D | null = mesh.parent;
        while (parent && parent !== this.scene) {
          if (!parent.visible) opened.push(parent);
          parent.visible = true;
          parent = parent.parent;
        }
        mesh.visible = true;
        this.renderer.render(this.scene, camera);
        // Finish this program before yielding so its compile does not pile into the present.
        this.renderer.getContext().finish();
        mesh.visible = false;
        for (const ancestor of opened) ancestor.visible = false;
        await yieldToMain();
      }
    } finally {
      meshes.forEach((mesh, index) => {
        mesh.visible = meshWasVisible[index] ?? true;
      });
      children.forEach((child, index) => {
        child.visible = childWasVisible[index] ?? true;
      });
    }
  }

  /** The glaze-fire hook has written `uPwFire` into the body program. */
  glazeUniformBound(): boolean {
    return clayMaterialUniformBound(this.bodyMaterial, 'uPwFire');
  }

  /** The baked room map is on the scene, so metal and glaze can reflect it. */
  hasEnvironment(): boolean {
    return this.scene.environment != null;
  }

  /** Upload the room map before the first draw so materials compile one variant. */
  async prepareEnvironment(): Promise<void> {
    if (this.environmentReady) return;
    try {
      const { installBakedRoom } = await import('./roomEnvironment');
      await installBakedRoom(this.renderer, this.scene);
    } catch {
      // The key light still describes the room when the map cannot be fetched.
    }
    this.environmentReady = true;
  }

  /** One shot after the deferred room map is uploaded, so the loop can stay stopped. */
  whenEnvironmentReady(listener: () => void): void {
    this.environmentListener = listener;
    if (this.environmentReady) listener();
  }

  /**
   * The room map is a prefiltered cube. Building it at runtime compiles more
   * shaders and blurs on the CPU, so the startup path only uploads a baked map.
   */
  startEnvironment(): void {
    if (this.environmentReady) return;
    void this.loadBakedEnvironment();
  }

  private async loadBakedEnvironment(): Promise<void> {
    await yieldToMain();
    if (this.environmentReady) return;
    const { installBakedRoom } = await import('./roomEnvironment');
    await yieldToMain();
    if (this.environmentReady) return;
    this.environmentReady = true;
    await installBakedRoom(this.renderer, this.scene);
    this.environmentListener?.();
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

function rememberAttachment(mesh: Mesh, attachment: Attachment): void {
  let snap = mesh.userData.snap as Float32Array | undefined;
  if (!snap || snap.length !== attachment.points.length * 4) {
    snap = new Float32Array(attachment.points.length * 4);
    mesh.userData.snap = snap;
  }
  writeSnap(snap, attachment);
  mesh.userData.kind = attachment.kind;
  mesh.userData.joinBlend = attachment.joinBlend;
  mesh.userData.tubular = attachment.tubularSegments;
  mesh.userData.radial = attachment.radialSegments;
}

function writeSnap(snap: Float32Array, attachment: Attachment): void {
  for (let i = 0; i < attachment.points.length; i++) {
    const point = attachment.points[i];
    const offset = i * 4;
    snap[offset] = point.x;
    snap[offset + 1] = point.y;
    snap[offset + 2] = point.z;
    snap[offset + 3] = point.radius;
  }
}

function attachmentUnchanged(mesh: Mesh, attachment: Attachment): boolean {
  const snap = mesh.userData.snap as Float32Array | undefined;
  if (!snap || snap.length !== attachment.points.length * 4) return false;
  if (mesh.userData.kind !== attachment.kind) return false;
  if (mesh.userData.joinBlend !== attachment.joinBlend) return false;
  if (mesh.userData.tubular !== attachment.tubularSegments) return false;
  if (mesh.userData.radial !== attachment.radialSegments) return false;
  for (let i = 0; i < attachment.points.length; i++) {
    const point = attachment.points[i];
    const offset = i * 4;
    if (
      snap[offset] !== point.x ||
      snap[offset + 1] !== point.y ||
      snap[offset + 2] !== point.z ||
      snap[offset + 3] !== point.radius
    ) {
      return false;
    }
  }
  return true;
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

function buildWheelHead(pivot: Group, shadows: boolean): void {
  const head = new Mesh(
    new CylinderGeometry(0.146, 0.146, 0.02, 64),
    // The room map arrives at bisque. A near-mirror head is black until then.
    new MeshStandardMaterial({ color: 0x8d939a, metalness: 0.6, roughness: 0.46 }),
  );
  head.position.y = -0.02;
  head.receiveShadow = shadows;
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
  bat.name = 'bat';
  bat.position.y = -0.0045;
  bat.receiveShadow = shadows;
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
