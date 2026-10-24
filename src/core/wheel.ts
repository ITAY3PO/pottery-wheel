function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Wheel head dynamics. The motor chases the speed knob, viscous friction and
 * coulomb friction bleed speed, and tool drag (set each frame) bogs it down.
 */
export class Wheel {
  /** Integrated rotation, radians. */
  angle = 0;
  /** Angular velocity, radians per second. */
  omega = 0;
  running = false;
  /** Speed knob, 0..1. */
  speed = 0.62;

  readonly inertia = 0.04;
  readonly maxTorque = 0.72;
  readonly viscous = 0.012;
  readonly coulomb = 0.025;
  readonly kp = 3.2;
  /** About 248 RPM. */
  readonly maxOmega = 26;

  private drag = 0;

  /** Add opposing torque for this frame. Pressure is 0..1. */
  addDrag(pressure: number): void {
    if (pressure <= 0.02) return;
    this.drag += pressure * 0.58;
  }

  step(dt: number): void {
    const stepDt = Math.min(Math.max(dt, 0), 0.05);
    const target = this.running ? this.speed * this.maxOmega : 0;
    const error = target - this.omega;
    const motor = clamp(this.kp * error, -this.maxTorque, this.maxTorque);
    const friction = this.viscous * this.omega + Math.sign(this.omega) * this.coulomb;
    const opposing = this.omega === 0 ? 0 : Math.sign(this.omega) * this.drag;
    const alpha = (motor - friction - opposing) / this.inertia;
    this.omega += alpha * stepDt;
    if (!this.running && Math.abs(this.omega) < 0.12) this.omega = 0;
    this.angle += this.omega * stepDt;
    this.drag = 0;
  }

  get rpm(): number {
    return (Math.abs(this.omega) * 60) / (2 * Math.PI);
  }
}
