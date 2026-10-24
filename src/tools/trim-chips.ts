/** A curling of leather-hard clay leaving the loop. Ephemeral — not part of PieceState. */
export interface TrimChip {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
}

export interface TrimChipView {
  x: number;
  y: number;
  z: number;
  size: number;
}

const chips: TrimChip[] = [];
const MAX_CHIPS = 48;

export function resetTrimChips(): void {
  chips.length = 0;
}

export function activeTrimChips(): readonly TrimChip[] {
  return chips;
}

export function spawnTrimChips(
  origin: { x: number; y: number; z: number },
  removedM3: number,
  omega: number,
): void {
  if (!(removedM3 > 1e-10)) return;
  const count = Math.max(1, Math.min(4, Math.round(removedM3 / 1.2e-6)));
  const spin = Math.min(Math.abs(omega), 24);
  const outward = origin.x === 0 ? 1 : Math.sign(origin.x);
  for (let n = 0; n < count; n++) {
    if (chips.length >= MAX_CHIPS) chips.shift();
    chips.push({
      x: origin.x + (Math.random() - 0.5) * 0.008,
      y: origin.y + Math.random() * 0.004,
      z: origin.z + (Math.random() - 0.5) * 0.01,
      vx: outward * (0.04 + Math.random() * 0.16),
      vy: 0.08 + Math.random() * 0.32,
      vz: (Math.random() - 0.5) * 0.18 + Math.sign(omega || 1) * spin * 0.008,
      life: 0.85 + Math.random() * 0.55,
      size: 0.0016 + Math.random() * 0.0018,
    });
  }
}

/** Advance chips and return the ones still in the air, for the studio to draw. */
export function stepTrimChips(dt: number): TrimChipView[] {
  let left = Math.max(0, Math.min(dt, 0.25));
  while (left > 1e-5) {
    const step = Math.min(0.05, left);
    left -= step;
    integrate(step);
  }
  return chips.map((chip) => ({ x: chip.x, y: chip.y, z: chip.z, size: chip.size }));
}

function integrate(step: number): void {
  const gravity = 9.2;
  for (let i = chips.length - 1; i >= 0; i--) {
    const chip = chips[i];
    chip.vy -= gravity * step;
    chip.x += chip.vx * step;
    chip.y += chip.vy * step;
    chip.z += chip.vz * step;
    chip.life -= step;
    if (chip.y < 0) {
      chip.y = 0;
      chip.vy = Math.abs(chip.vy) * 0.28;
      chip.vx *= 0.6;
      chip.vz *= 0.6;
      chip.life -= 0.08;
    }
    if (chip.life <= 0) chips.splice(i, 1);
  }
}
