import type { PieceState } from '../core/types';
import { firingChoice } from './choice';
import { coneById } from './cones';
import { fireBisque, fireGlaze, lastFiringNote } from './outcome';

let running = false;
let onChange: (message: string) => void = () => {};

export function bindFiringApp(next: { onChange: (message: string) => void }): void {
  onChange = next.onChange;
}

export function isKilnRunning(): boolean {
  return running;
}

/**
 * Heat, cool, then open the door. The firing result is committed when the
 * door starts to move, so the pot is already fired while the door is still
 * in the way. Stage changes go through `transition` inside fireBisque / fireGlaze.
 */
export function startKiln(piece: PieceState, kind: 'bisque' | 'glaze'): void {
  if (running) return;
  const cone = coneById(kind === 'bisque' ? firingChoice.bisqueCone : firingChoice.glazeCone, kind);
  if (typeof document === 'undefined') {
    commit(piece, kind, cone.tempC);
    onChange(lastFiringNote);
    return;
  }
  running = true;
  mountCycle(piece, kind, cone.label, cone.tempC);
}

function commit(piece: PieceState, kind: 'bisque' | 'glaze', tempC: number): void {
  if (kind === 'bisque') fireBisque(piece, tempC);
  else fireGlaze(piece, tempC);
}

function mountCycle(piece: PieceState, kind: 'bisque' | 'glaze', label: string, target: number): void {
  if (!document.getElementById('pw-kiln-style')) {
    const style = document.createElement('style');
    style.id = 'pw-kiln-style';
    style.textContent = KILN_CSS;
    document.head.append(style);
  }
  const root = document.querySelector('#app') ?? document.body;
  const overlay = document.createElement('div');
  overlay.className = 'pw-kiln';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', kind === 'bisque' ? 'Bisque kiln' : 'Glaze kiln');
  overlay.innerHTML = `
    <div class="pw-kiln-glow"></div>
    <div class="pw-kiln-door"></div>
    <p class="pw-kiln-temp"></p>
    <p class="pw-kiln-status" aria-live="polite"></p>
    <button class="pw-kiln-open" type="button" hidden>Open the door</button>
  `;
  root.append(overlay);

  const glow = overlay.querySelector('.pw-kiln-glow') as HTMLElement;
  const door = overlay.querySelector('.pw-kiln-door') as HTMLElement;
  const tempNode = overlay.querySelector('.pw-kiln-temp') as HTMLElement;
  const status = overlay.querySelector('.pw-kiln-status') as HTMLElement;
  const button = overlay.querySelector('.pw-kiln-open') as HTMLButtonElement;

  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const heatMs = reduce ? 400 : 4300;
  const coolMs = reduce ? 450 : 6200;
  const openMs = reduce ? 180 : 1000;
  const started = performance.now();
  let coolStart = started;
  let phase: 'heat' | 'cool' | 'ready' | 'open' = 'heat';
  let raf = 0;
  let committed = false;

  const setTemp = (celsius: number) => {
    tempNode.textContent = `${Math.round(celsius)}°C`;
  };
  const setGlow = (amount: number) => {
    glow.style.opacity = String(Math.max(0, Math.min(1, amount)));
  };

  const finish = () => {
    cancelAnimationFrame(raf);
    overlay.remove();
    running = false;
    onChange('');
  };

  const beginOpen = () => {
    if (phase === 'open') return;
    phase = 'open';
    button.hidden = true;
    status.textContent = 'Opening';
    if (!committed) {
      committed = true;
      commit(piece, kind, target);
      onChange(lastFiringNote);
    }
    overlay.classList.add('is-open');
    const openedAt = performance.now();
    const slide = (now: number) => {
      const t = Math.min(1, (now - openedAt) / openMs);
      door.style.transform = `translateY(${(-108 * t).toFixed(2)}%)`;
      if (t < 1) raf = requestAnimationFrame(slide);
      else finish();
    };
    raf = requestAnimationFrame(slide);
  };

  button.addEventListener('click', beginOpen);

  const frame = (now: number) => {
    if (phase === 'heat') {
      const t = Math.min(1, (now - started) / heatMs);
      const ease = t * t * (3 - 2 * t);
      setTemp(20 + (target - 20) * ease);
      setGlow(0.15 + 0.85 * ease);
      status.textContent = `Heating to cone ${label}`;
      if (t >= 1) {
        phase = 'cool';
        coolStart = now;
      }
    } else if (phase === 'cool') {
      const t = Math.min(1, (now - coolStart) / coolMs);
      const ease = t * t * (3 - 2 * t);
      setTemp(target + (55 - target) * ease);
      setGlow(1 - ease);
      const left = Math.max(0, Math.ceil((1 - t) * (coolMs / 1000)));
      status.textContent = left > 0 ? `Cooling · ${left}s` : 'Cool enough to open';
      if (t >= 1) {
        phase = 'ready';
        setTemp(55);
        setGlow(0);
        status.textContent = 'Cool enough to open';
        button.hidden = false;
        return;
      }
    } else {
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  setTemp(20);
  setGlow(0.1);
  status.textContent = `Heating to cone ${label}`;
  raf = requestAnimationFrame(frame);
}

const KILN_CSS = `
.pw-kiln {
  position: absolute;
  inset: 0;
  z-index: 8;
  background: #1a120e;
  color: #f6efe4;
  font-family: Outfit, "Avenir Next", "Segoe UI", sans-serif;
}
.pw-kiln.is-open { background: transparent; pointer-events: none; }
.pw-kiln-glow {
  position: absolute;
  left: 14%;
  right: 14%;
  top: 16%;
  bottom: 28%;
  border-radius: 18px;
  background: radial-gradient(circle at 50% 60%, #ffd7a1 0%, #e25a1c 42%, rgba(80, 20, 8, 0.2) 72%, transparent 78%);
  opacity: 0;
  pointer-events: none;
}
.pw-kiln-door {
  position: absolute;
  left: 10%;
  right: 10%;
  top: 12%;
  bottom: 22%;
  border-radius: 16px 16px 6px 6px;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%),
    repeating-linear-gradient(90deg, #4a3428 0 18px, #3d2b22 18px 22px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35), inset 0 0 0 3px #2a1c16;
}
.pw-kiln.is-open .pw-kiln-temp,
.pw-kiln.is-open .pw-kiln-status { opacity: 0; }
.pw-kiln-temp {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(18% + 12px);
  margin: 0;
  text-align: center;
  font-family: Fraunces, Georgia, serif;
  font-size: 42px;
  font-weight: 560;
  letter-spacing: -0.03em;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.pw-kiln-status {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: calc(88px + env(safe-area-inset-bottom));
  margin: 0;
  text-align: center;
  font-size: 16px;
  pointer-events: none;
}
.pw-kiln-open {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  min-height: 52px;
  border: 0;
  border-radius: 999px;
  background: #c4623a;
  color: #fffaf6;
  font: inherit;
  font-size: 18px;
  font-weight: 680;
}
`;
