import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

const raycaster = new Raycaster();
const ndc = new Vector2();
const hit = new Vector3();

/**
 * Side view while throwing: screen x is radius, screen y is height.
 * Off the wheel, two fingers (or right-drag) orbit.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(32, 1, 0.02, 30);
  mode: 'side' | 'orbit' = 'side';
  private orbitAzimuth = 0.42;
  private orbitPolar = 1.08;
  private blend = 0;
  private worldWidth = 0.32;
  private readonly target = new Vector3(0, 0.04, 0);
  private readonly desired = new Vector3(0, 0.04, 0);
  private sheetFraction = 0.28;

  setMode(mode: 'side' | 'orbit'): void {
    this.mode = mode;
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

  orbitBy(dx: number, dy: number): void {
    if (this.mode !== 'orbit') return;
    this.orbitAzimuth -= dx * 0.0055;
    this.orbitPolar = Math.max(0.38, Math.min(1.38, this.orbitPolar - dy * 0.0045));
  }

  update(dt: number): void {
    const goal = this.mode === 'orbit' ? 1 : 0;
    this.blend += (goal - this.blend) * Math.min(1, dt * 3.5);
    this.target.lerp(this.desired, Math.min(1, dt * 3));

    const vFov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1;
    const worldHeight = this.worldWidth / Math.max(0.35, aspect);
    const distance = worldHeight / (2 * Math.tan(vFov / 2));
    // Shift the look point down so the clay sits above the bottom sheet.
    const lookY = this.target.y - this.sheetFraction * worldHeight * 0.5;

    const sideY = lookY + distance * 0.02;
    const sideZ = distance;
    const orbitDistance = Math.max(distance * 0.95, 0.42);
    const orbitX = orbitDistance * Math.sin(this.orbitPolar) * Math.sin(this.orbitAzimuth);
    const orbitY = lookY + orbitDistance * Math.cos(this.orbitPolar) * 0.72;
    const orbitZ = orbitDistance * Math.sin(this.orbitPolar) * Math.cos(this.orbitAzimuth);
    const t = this.blend;
    this.camera.position.set(orbitX * t, sideY * (1 - t) + orbitY * t, sideZ * (1 - t) + orbitZ * t);
    this.camera.lookAt(0, lookY, 0);
  }

  /** Intersect the pointer with the plane through the wheel axis facing the side camera. */
  profilePoint(clientX: number, clientY: number, canvas: HTMLCanvasElement): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, this.camera);
    const origin = raycaster.ray.origin;
    const direction = raycaster.ray.direction;
    if (Math.abs(direction.z) < 1e-5) return null;
    const distance = -origin.z / direction.z;
    if (distance < 0) return null;
    hit.copy(origin).addScaledVector(direction, distance);
    return { x: hit.x, y: hit.y };
  }
}
