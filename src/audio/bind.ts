import { events } from '../core/events';
import type { PieceState } from '../core/types';
import { audio as sharedAudio } from './engine';
import type { Audio } from './types';

/**
 * The only place audio listens to the wheel.
 *
 * `installAudio` still receives the wheel and the pointer: those are not on
 * the bus. The poll itself subscribes to `events` (`frame`, `stroke-start`,
 * `stroke-end`, `stage-change`, `wire-cut`) so it does not run a second
 * animation frame. `tick` stays synchronous for tests that drive a private bus.
 * A water-tool stroke plays one splash. Leaving the wheel while still wet is
 * the wire cut; drying and a stage change are not.
 */
export interface WheelAudioSource {
  wheel: { omega: number; maxOmega: number };
  getPiece(): PieceState | null;
  /** Null when the hand is up. */
  getPointer(): { pressure: number; height: number } | null;
  /** Active tool id, when the shell has one. Wire is not a squish; water splashes. */
  getTool?: () => string | null;
}

export interface AudioBinding {
  /** Subscribe to the studio bus. `installAudio` does this for the shared engine. */
  start(): void;
  tick(): void;
  stop(): void;
}

export function muteControl(muted: boolean): { pressed: boolean; label: string; text: string } {
  return muted
    ? { pressed: true, label: 'Unmute sound', text: 'Muted' }
    : { pressed: false, label: 'Mute sound', text: 'Sound' };
}

let listening = false;
let uiMounted = false;
let driving = false;

export function installAudio(source: WheelAudioSource, bus: Audio = sharedAudio): AudioBinding {
  const binding = new PollBinding(source, bus);
  if (bus === sharedAudio) {
    mountMuteButton();
    listenForUnlock();
    if (!driving) {
      driving = true;
      binding.start();
    }
  }
  return binding;
}

class PollBinding implements AudioBinding {
  private unsubs: Array<() => void> = [];
  private stopped = false;
  /** `null` until the first sample, so a piece that loads already off the wheel is silent. */
  private mounted: boolean | null = null;
  private splashed = false;

  constructor(
    private readonly source: WheelAudioSource,
    private readonly bus: Audio,
  ) {}

  start(): void {
    if (this.unsubs.length > 0 || this.stopped) return;
    this.unsubs = [
      events.on('frame', () => {
        if (!this.stopped) this.tick();
      }),
      events.on('stroke-start', () => {
        this.splashed = false;
      }),
      events.on('stroke-end', () => {
        this.splashed = false;
      }),
      events.on('stage-change', ({ piece }) => {
        // Drying emits this and does not cut. Remember the mount so the next
        // `frame` poll does not treat the transition as a wire.
        this.mounted = piece.onWheel;
      }),
      events.on('wire-cut', () => {
        if (this.stopped) return;
        onWireCut(this.bus);
        // `tick` also edge-detects "left the wheel while wet" for tests that
        // call it directly. This sample already played.
        this.mounted = false;
      }),
    ];
  }

  stop(): void {
    this.stopped = true;
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
  }

  tick(): void {
    const piece = this.source.getPiece();
    const tool = this.source.getTool?.() ?? null;
    const raw = piece ? this.source.getPointer() : null;
    const pointer = raw && tool !== 'wire' ? raw : null;
    const pressure = pointer ? pointer.pressure : 0;
    const moisture = piece && pointer ? moistureAt(piece, pointer.height) : 0;
    onFrame(this.bus, wheelSpeed(this.source.wheel), pressure, moisture);
    if (tool === 'water' && pointer && pressure > 0.35 && moisture > 0.45) {
      if (!this.splashed) {
        this.splashed = true;
        this.bus.play('splash');
      }
    } else if (!pointer) {
      this.splashed = false;
    }
    const onWheel = Boolean(piece?.onWheel);
    if (this.mounted === true && piece != null && !onWheel && piece.stage === 'wet') onWireCut(this.bus);
    this.mounted = piece ? onWheel : false;
  }
}

function onFrame(bus: Audio, speed: number, pressure: number, moisture: number): void {
  bus.setWheel(speed);
  bus.setContact(pressure, moisture);
}

function onWireCut(bus: Audio): void {
  bus.play('wire');
}

function wheelSpeed(wheel: { omega: number; maxOmega: number }): number {
  if (!(wheel.maxOmega > 0) || !Number.isFinite(wheel.omega)) return 0;
  const speed = Math.abs(wheel.omega) / wheel.maxOmega;
  if (speed <= 0) return 0;
  if (speed >= 1) return 1;
  return speed;
}

/** `grid.y` is monotonic. Pick the ring nearest this height. */
function moistureAt(piece: PieceState, height: number): number {
  const { y, moisture, rings } = piece.grid;
  if (rings <= 0) return 0;
  let lo = 0;
  let hi = rings - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (y[mid] < height) lo = mid + 1;
    else hi = mid;
  }
  const prev = lo > 0 ? lo - 1 : 0;
  const best = Math.abs(y[prev] - height) <= Math.abs(y[lo] - height) ? prev : lo;
  return moisture[best] ?? 0;
}

function listenForUnlock(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const gesture = (event: Event) => {
    const target = event.target;
    // Pressing Mute is itself the gesture. Starting the graph and then
    // suspending it in the same turn can click. Stay quiet instead.
    if (target instanceof Element && target.closest('#pw-mute') && !sharedAudio.muted) return;
    sharedAudio.unlock();
  };
  window.addEventListener('pointerdown', gesture, { capture: true });
  window.addEventListener('keydown', gesture, { capture: true });
}

function mountMuteButton(): void {
  if (uiMounted || typeof document === 'undefined') return;
  const root = document.querySelector('#app') ?? document.body;
  if (!root) return;
  uiMounted = true;
  if (!document.getElementById('pw-audio-style')) {
    const style = document.createElement('style');
    style.id = 'pw-audio-style';
    style.textContent = MUTE_CSS;
    document.head.append(style);
  }
  const existing = document.querySelector<HTMLButtonElement>('#pw-mute');
  const button = existing ?? document.createElement('button');
  button.id = 'pw-mute';
  button.type = 'button';
  const paint = (muted: boolean) => {
    const view = muteControl(muted);
    button.setAttribute('aria-pressed', view.pressed ? 'true' : 'false');
    button.setAttribute('aria-label', view.label);
    button.textContent = view.text;
  };
  sharedAudio.setMuteListener(paint);
  if (!existing) {
    button.addEventListener('click', () => sharedAudio.setMuted(!sharedAudio.muted));
    root.append(button);
  }
}

const MUTE_CSS = `
#pw-mute {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  right: 12px;
  z-index: 4;
  min-width: 44px;
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: rgba(42, 31, 24, 0.5);
  color: #f7f1e8;
  font-family: Outfit, "Avenir Next", "Segoe UI", sans-serif;
  font-size: 14px;
  font-weight: 640;
  letter-spacing: 0.01em;
  touch-action: manipulation;
}
#pw-mute[aria-pressed="true"] {
  background: rgba(42, 31, 24, 0.78);
}
`;
