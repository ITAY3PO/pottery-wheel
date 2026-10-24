import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

const raycaster = new Raycaster();
const ndc = new Vector2();

/** Horizontal angle of the historical side camera: almost level, a hair above the bat. */
const SIDE_POLAR = Math.atan2(1, 0.02);
const POLAR_MIN = 0.12;
const POLAR_MAX = SIDE_POLAR;

export type ViewPreset = 'top' | 'three-quarter' | 'side';

export const VIEW_PRESETS: readonly { id: ViewPreset; label: string; polar: number; azimuth: number }[] = [
  { id: 'top', label: 'Top', polar: 0.18, azimuth: 0 },
  { id: 'three-quarter', label: '3/4', polar: Math.PI / 4, azimuth: 0.62 },
  { id: 'side', label: 'Side', polar: SIDE_POLAR, azimuth: 0 },
];

/**
 * Signed radius (x) and height (y) where a ray crosses the vertical plane
 * through the wheel axis that faces the camera. `x` is along screen-right,
 * so a side camera on +Z still reports world X. A ray parallel to that plane
 * returns null.
 */
export function profileOnViewPlane(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  cameraX: number,
  cameraZ: number,
): { x: number; y: number } | null {
  const horiz = Math.hypot(cameraX, cameraZ);
  const nx = horiz < 1e-6 ? 0 : cameraX / horiz;
  const nz = horiz < 1e-6 ? 1 : cameraZ / horiz;
  const denom = direction.x * nx + direction.z * nz;
  if (Math.abs(denom) < 1e-5) return null;
  const t = -(origin.x * nx + origin.z * nz) / denom;
  if (t < 0) return null;
  const hx = origin.x + direction.x * t;
  const hy = origin.y + direction.y * t;
  const hz = origin.z + direction.z * t;
  return { x: hx * nz - hz * nx, y: hy };
}

/**
 * Orbits the clay. Presets ease into place; a drag follows the finger.
 * One finger stays the tool — this rig only moves the camera.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(32, 1, 0.02, 30);
  /** Ray through the latest pointer. Stable until the next `aimPointer`. */
  readonly pointerRaycaster = new Raycaster();
  private polar = SIDE_POLAR;
  private azimuth = 0;
  private targetPolar = SIDE_POLAR;
  private targetAzimuth = 0;
  private chosen: ViewPreset | null = 'side';
  private worldWidth = 0.32;
  private readonly target = new Vector3(0, 0.04, 0);
  private readonly desired = new Vector3(0, 0.04, 0);
  private sheetFraction = 0.28;

  constructor() {
    this.update(0);
  }

  /** Preset the buttons are showing, or null once the user has orbited off it. */
  get preset(): ViewPreset | null {
    return this.chosen;
  }

  /** Camera's horizontal angle around the wheel axis. 0 sits on +Z, the old side view. */
  get azimuthAngle(): number {
    return this.azimuth;
  }

  /** Ease to a preset. The drag path is left alone until the angles arrive. */
  setPreset(preset: ViewPreset): void {
    const pose = VIEW_PRESETS.find((entry) => entry.id === preset);
    if (!pose) return;
    this.targetPolar = pose.polar;
    this.targetAzimuth = pose.azimuth;
    this.chosen = preset;
  }

  /** Frame a piece so the clay fills the view you can actually touch. */
  framePiece(height: number, radius: number): void {
    const diameter = Math.max(0.08, radius * 2);
    const aspect = Math.max(0.45, this.camera.aspect || 0.6);
    const forWidth = diameter * 2.35;
    const forHeight = Math.max(0.12, height * 1.75) * aspect;
    this.worldWidth = Math.max(0.24, forWidth, forHeight);
    this.desired.set(0, Math.max(0.02, height * 0.42), 0);
  }

  frameWheel(): void {
    this.worldWidth = 0.4;
    this.desired.set(0, 0.015, 0);
  }

  resize(width: number, height: number, sheetHeight: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.sheetFraction = sheetHeight / Math.max(1, height);
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Two-finger drag and right-drag. Moves immediately and leaves the preset. */
  orbitBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.azimuth -= dx * 0.0055;
    this.polar = Math.max(POLAR_MIN, Math.min(POLAR_MAX, this.polar - dy * 0.0045));
    this.targetAzimuth = this.azimuth;
    this.targetPolar = this.polar;
    this.chosen = null;
  }

  update(dt: number): void {
    const ease = 1 - Math.exp(-dt * 6);
    let dAz = this.targetAzimuth - this.azimuth;
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    this.azimuth += dAz * ease;
    this.polar += (this.targetPolar - this.polar) * ease;
    this.target.lerp(this.desired, Math.min(1, dt * 3));

    const vFov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1;
    const worldHeight = this.worldWidth / Math.max(0.35, aspect);
    const distance = Math.max(worldHeight / (2 * Math.tan(vFov / 2)), 0.42);
    // Shift the look point down so the clay sits above the bottom sheet.
    const lookY = this.target.y - this.sheetFraction * worldHeight * 0.5;
    const horiz = distance * Math.sin(this.polar);
    this.camera.position.set(
      horiz * Math.sin(this.azimuth),
      lookY + distance * Math.cos(this.polar),
      horiz * Math.cos(this.azimuth),
    );
    this.camera.lookAt(0, lookY, 0);
    this.camera.updateMatrixWorld();
  }

  /**
   * Aim `pointerRaycaster` through the pointer.
   * Returns canvas CSS pixels (origin top-left) and NDC. Uses its own raycaster
   * so `profilePoint` can still intersect the view plane.
   */
  aimPointer(
    clientX: number,
    clientY: number,
    canvas: HTMLCanvasElement,
  ): { x: number; y: number; ndcX: number; ndcY: number } | null {
    const sample = clientNdc(clientX, clientY, canvas);
    if (!sample) return null;
    ndc.set(sample.ndcX, sample.ndcY);
    this.pointerRaycaster.setFromCamera(ndc, this.camera);
    return sample;
  }

  /** Intersect the pointer with the plane through the wheel axis facing the camera. */
  profilePoint(clientX: number, clientY: number, canvas: HTMLCanvasElement): { x: number; y: number } | null {
    const sample = clientNdc(clientX, clientY, canvas);
    if (!sample) return null;
    ndc.set(sample.ndcX, sample.ndcY);
    raycaster.setFromCamera(ndc, this.camera);
    return profileOnViewPlane(
      raycaster.ray.origin,
      raycaster.ray.direction,
      this.camera.position.x,
      this.camera.position.z,
    );
  }
}

function clientNdc(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
): { x: number; y: number; ndcX: number; ndcY: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return {
    x,
    y,
    ndcX: (x / rect.width) * 2 - 1,
    ndcY: -(y / rect.height) * 2 + 1,
  };
}
