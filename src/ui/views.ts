import { VIEW_PRESETS, type ViewPreset } from '../render/viewPresets';

/**
 * Top / 3/4 / side. Finger-sized, and off the clay so a tap is not a press.
 * The shelf button is adopted into this row when the gallery has mounted it.
 */
export class ViewBar {
  private readonly buttons = new Map<ViewPreset, HTMLButtonElement>();
  private active: ViewPreset | null = null;

  constructor(
    root: HTMLElement,
    private readonly onView: (preset: ViewPreset) => void,
  ) {
    const bar = document.createElement('div');
    bar.className = 'view-bar';
    const presets = document.createElement('div');
    presets.className = 'view-presets';
    presets.setAttribute('role', 'group');
    presets.setAttribute('aria-label', 'Camera view');
    for (const preset of VIEW_PRESETS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'view';
      button.textContent = preset.label;
      button.dataset.view = preset.id;
      button.setAttribute('aria-label', `${preset.label} view`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.onView(preset.id));
      presets.append(button);
      this.buttons.set(preset.id, button);
    }
    bar.append(presets);
    const shelf = root.querySelector(':scope > .gal-entry');
    if (shelf) bar.prepend(shelf);
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
