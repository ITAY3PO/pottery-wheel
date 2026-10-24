import { VIEW_PRESETS, type ViewPreset } from '../render/cameraRig';

/** Top / 3/4 / side. Finger-sized, and off the canvas so a tap is not a press. */
export class ViewBar {
  private readonly buttons = new Map<ViewPreset, HTMLButtonElement>();
  private active: ViewPreset | null = null;

  constructor(
    root: HTMLElement,
    private readonly onView: (preset: ViewPreset) => void,
  ) {
    const bar = document.createElement('div');
    bar.className = 'view-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Camera view');
    for (const preset of VIEW_PRESETS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'view';
      button.textContent = preset.label;
      button.dataset.view = preset.id;
      button.setAttribute('aria-label', `${preset.label} view`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.onView(preset.id));
      bar.append(button);
      this.buttons.set(preset.id, button);
    }
    root.append(bar);
  }

  setActive(preset: ViewPreset | null): void {
    if (preset === this.active) return;
    this.active = preset;
    for (const [id, button] of this.buttons) {
      button.setAttribute('aria-pressed', id === preset ? 'true' : 'false');
    }
  }
}
