import { CLAY_TYPES, type ClayType } from '../../clay/clays';
import type { ClayTypeId } from '../../core/types';
import type { QualityLevel, QualityMode } from '../../render/quality';

export interface ShellAction {
  id: string;
  label: string;
  enabled: boolean;
}

export interface ShellTool {
  id: string;
  label: string;
}

export interface ShellModel {
  phase: 'setup' | 'piece';
  clayId: ClayTypeId;
  weightKg: number;
  hasSave: boolean;
  saveLabel: string;
  title: string;
  subtitle: string;
  hint: string;
  message: string;
  tools: ShellTool[];
  activeToolId: string | null;
  running: boolean;
  rpm: number;
  speed: number;
  showWheel: boolean;
  centered: number | null;
  actions: ShellAction[];
  confirmDiscard: boolean;
}

export interface ShellHandlers {
  onClay: (id: ClayTypeId) => void;
  onWeight: (kg: number) => void;
  onBegin: () => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
  onSpeed: (value: number) => void;
  onTool: (id: string) => void;
  onAction: (id: string) => void;
  onDiscard: () => void;
  onConfirmDiscard: () => void;
  onHelp: () => void;
  onQuality: (mode: QualityMode) => void;
}

export interface QualityChoice {
  mode: QualityMode;
  level: QualityLevel;
  shadows: boolean;
}

export class Shell {
  readonly chrome: HTMLElement;
  /** Help and the audio mute control. Mute keeps the id `#pw-mute`. */
  readonly topbar: HTMLElement;
  /** Journey stepper. Outside the sheet body so a rebuild cannot wipe it. */
  readonly stepperSlot: HTMLElement;
  /** Contextual tip. Outside the sheet body for the same reason. */
  readonly tipSlot: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly sheet: HTMLElement;
  private signature = '';
  private rpmNode: HTMLElement | null = null;
  private hintNode: HTMLElement | null = null;
  private meterNode: HTMLElement | null = null;
  private messageNode: HTMLElement | null = null;
  private speedReadout: HTMLElement | null = null;
  private actionButtons: HTMLButtonElement[] = [];
  private startButton: HTMLButtonElement | null = null;
  private quality: QualityChoice = { mode: 'auto', level: 'medium', shadows: false };
  private qualityDialog: HTMLElement | null = null;
  private qualityNote: HTMLElement | null = null;

  constructor(
    root: HTMLElement,
    private readonly handlers: ShellHandlers,
  ) {
    const adopted = root.querySelector(':scope > .wordmark');
    const wordmark = adopted instanceof HTMLElement ? adopted : document.createElement('header');
    if (!(adopted instanceof HTMLElement)) {
      wordmark.className = 'wordmark';
      wordmark.innerHTML = '<h1>The Wheel</h1><p></p>';
    }
    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'help';
    help.textContent = 'Help';
    help.setAttribute('aria-controls', 'throwing-tutorial');
    help.setAttribute('aria-expanded', 'false');
    help.addEventListener('click', () => this.handlers.onHelp());
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'settings';
    settings.textContent = 'Settings';
    settings.setAttribute('aria-haspopup', 'dialog');
    settings.setAttribute('aria-expanded', 'false');
    settings.addEventListener('click', () => this.toggleQuality(settings));
    const topbar = document.createElement('div');
    topbar.className = 'topbar';
    topbar.append(help, settings);
    const chrome = document.createElement('div');
    chrome.className = 'sheet-chrome';
    const stepper = document.createElement('div');
    stepper.className = 'stepper-slot';
    const sheet = document.createElement('section');
    sheet.className = 'sheet';
    const tip = document.createElement('div');
    tip.className = 'tip-slot';
    tip.hidden = true;
    // Stepper, tutorial, and tip stay outside the nodes renderSetup / renderPiece
    // replace. In-place patches of the sheet body must keep working.
    chrome.append(stepper, sheet, tip);
    if (adopted instanceof HTMLElement) root.append(topbar, chrome);
    else root.append(wordmark, topbar, chrome);
    this.subtitle = wordmark.querySelector('p') as HTMLElement;
    this.topbar = topbar;
    this.chrome = chrome;
    this.stepperSlot = stepper;
    this.sheet = sheet;
    this.tipSlot = tip;
  }

  get sheetHeight(): number {
    return this.sheet.offsetHeight;
  }

  get sheetWidth(): number {
    return this.sheet.offsetWidth;
  }

  get chromeHeight(): number {
    return this.chrome.offsetHeight;
  }

  get chromeWidth(): number {
    return this.chrome.offsetWidth;
  }

  render(model: ShellModel): void {
    this.subtitle.textContent = model.subtitle;
    // `enabled` is patched in place. Rebuilding the sheet when Wire off flips
    // at 28 rpm destroys an in-progress slider drag or tap.
    const signature = JSON.stringify({
      phase: model.phase,
      clayId: model.clayId,
      weight: model.weightKg,
      hasSave: model.hasSave,
      tools: model.tools.map((tool) => tool.id),
      active: model.activeToolId,
      showWheel: model.showWheel,
      running: model.running,
      actions: model.actions.map((action) => [action.id, action.label]),
      confirm: model.confirmDiscard,
      title: model.title,
    });
    if (signature !== this.signature) {
      this.signature = signature;
      if (model.phase === 'setup') this.renderSetup(model);
      else this.renderPiece(model);
    }
    this.patch(model);
  }

  private patch(model: ShellModel): void {
    if (this.rpmNode) this.rpmNode.textContent = String(Math.round(model.rpm));
    if (this.hintNode) this.hintNode.textContent = model.hint;
    if (this.messageNode) {
      this.messageNode.textContent = model.message;
      this.messageNode.classList.toggle('warn', model.message.length > 0);
    }
    if (this.meterNode) this.meterNode.style.width = `${Math.round((model.centered ?? 0) * 100)}%`;
    if (this.speedReadout) this.speedReadout.textContent = speedLabel(model.speed);
    this.startButton = this.sheet.querySelector<HTMLButtonElement>('[data-start]');
    const stop = this.sheet.querySelector<HTMLButtonElement>('[data-stop]');
    if (this.startButton) this.startButton.setAttribute('aria-pressed', model.running ? 'true' : 'false');
    if (stop) stop.classList.toggle('down', !model.running && model.rpm < 1);
    for (const action of model.actions) {
      const button = this.sheet.querySelector<HTMLButtonElement>(`[data-action="${CSS.escape(action.id)}"]`);
      if (button) button.disabled = !action.enabled;
    }
  }

  private renderSetup(model: ShellModel): void {
    const cards = CLAY_TYPES.map((clay) => clayCard(clay, clay.id === model.clayId)).join('');
    this.sheet.innerHTML = `
      <h2>Choose the clay</h2>
      <p class="lede">Weight sets the volume. Heavier lumps make bigger pots.</p>
      <div class="clay-list">${cards}</div>
      <div class="field"><span>Weight</span><b data-weight>${model.weightKg.toFixed(1)} kg</b></div>
      <input type="range" min="0.5" max="3" step="0.1" value="${model.weightKg}" aria-label="Clay weight" />
      <div class="stack">
        <button class="primary" type="button" data-begin>Sit down and throw</button>
        ${model.hasSave ? `<button class="ghost" type="button" data-resume>Resume · ${escapeHtml(model.saveLabel)}</button>` : ''}
      </div>
    `;
    this.sheet.querySelectorAll<HTMLButtonElement>('.clay-card').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.clay as ClayTypeId;
        this.handlers.onClay(id);
      });
    });
    const weight = this.sheet.querySelector('input[type="range"]') as HTMLInputElement;
    const readout = this.sheet.querySelector('[data-weight]') as HTMLElement;
    weight.addEventListener('input', () => {
      const value = Number(weight.value);
      readout.textContent = `${value.toFixed(1)} kg`;
      this.handlers.onWeight(value);
    });
    this.sheet.querySelector('[data-begin]')?.addEventListener('click', () => this.handlers.onBegin());
    this.sheet.querySelector('[data-resume]')?.addEventListener('click', () => this.handlers.onResume());
    this.hintNode = null;
    this.rpmNode = null;
    this.meterNode = null;
    this.messageNode = null;
    this.speedReadout = null;
    this.startButton = null;
    this.actionButtons = [];
  }

  private renderPiece(model: ShellModel): void {
    const tools = model.tools
      .map(
        (tool) =>
          `<button class="tool" type="button" data-tool="${tool.id}" aria-pressed="${tool.id === model.activeToolId ? 'true' : 'false'}">${escapeHtml(tool.label)}</button>`,
      )
      .join('');
    const actions = model.actions
      .map(
        (action) =>
          `<button class="primary" type="button" data-action="${action.id}" ${action.enabled ? '' : 'disabled'}>${escapeHtml(action.label)}</button>`,
      )
      .join('');
    const wheel = model.showWheel
      ? `
        <p class="rpm"><strong data-rpm>${Math.round(model.rpm)}</strong> rpm</p>
        <div class="row">
          <button class="primary" type="button" data-start aria-pressed="${model.running ? 'true' : 'false'}">Start</button>
          <button class="ghost" type="button" data-stop>Stop</button>
        </div>
        <div class="field"><span>Speed</span><b data-speed>${speedLabel(model.speed)}</b></div>
        <input type="range" min="0" max="1" step="0.01" value="${model.speed}" aria-label="Wheel speed" />
      `
      : '';
    const meter =
      model.centered == null
        ? ''
        : `<div class="meter" aria-hidden="true"><span data-meter style="width:${Math.round(model.centered * 100)}%"></span></div>`;
    this.sheet.innerHTML = `
      <h2>${escapeHtml(model.title)}</h2>
      ${meter}
      ${wheel}
      ${tools ? `<div class="tools">${tools}</div>` : ''}
      <p class="hint" data-hint></p>
      <p class="hint warn" data-message></p>
      <div class="actions">${actions}</div>
      <button class="linkish" type="button" data-discard>${model.confirmDiscard ? 'Discard this piece?' : 'New piece'}</button>
    `;
    this.rpmNode = this.sheet.querySelector('[data-rpm]');
    this.hintNode = this.sheet.querySelector('[data-hint]');
    this.messageNode = this.sheet.querySelector('[data-message]');
    this.meterNode = this.sheet.querySelector('[data-meter]');
    this.speedReadout = this.sheet.querySelector('[data-speed]');
    this.sheet.querySelector('[data-start]')?.addEventListener('click', () => this.handlers.onStart());
    this.sheet.querySelector('[data-stop]')?.addEventListener('click', () => this.handlers.onStop());
    this.sheet.querySelector('[data-discard]')?.addEventListener('click', () => {
      if (model.confirmDiscard) this.handlers.onConfirmDiscard();
      else this.handlers.onDiscard();
    });
    const speed = this.sheet.querySelector<HTMLInputElement>('input[type="range"]');
    speed?.addEventListener('input', () => this.handlers.onSpeed(Number(speed.value)));
    this.sheet.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.addEventListener('click', () => this.handlers.onTool(button.dataset.tool || ''));
    });
    this.actionButtons = [];
    this.sheet.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      this.actionButtons.push(button);
      button.addEventListener('click', () => this.handlers.onAction(button.dataset.action || ''));
    });
    this.startButton = this.sheet.querySelector<HTMLButtonElement>('[data-start]');
  }

  /**
   * Rpm, hint, and action enabled flags while the wheel is spinning.
   * Avoids rebuilding the sheet model on every frame.
   */
  setLive(live: {
    rpm: number;
    hint: string;
    centered: number | null;
    running: boolean;
    speed: number;
    actionEnabled: (id: string) => boolean;
  }): void {
    if (this.rpmNode) this.rpmNode.textContent = String(Math.round(live.rpm));
    if (this.hintNode && this.hintNode.textContent !== live.hint) this.hintNode.textContent = live.hint;
    if (this.meterNode && live.centered != null) {
      const width = `${Math.round(live.centered * 100)}%`;
      if (this.meterNode.style.width !== width) this.meterNode.style.width = width;
    }
    if (this.speedReadout) {
      const label = speedLabel(live.speed);
      if (this.speedReadout.textContent !== label) this.speedReadout.textContent = label;
    }
    if (this.startButton) this.startButton.setAttribute('aria-pressed', live.running ? 'true' : 'false');
    for (const button of this.actionButtons) {
      const enabled = live.actionEnabled(button.dataset.action || '');
      if (button.disabled === enabled) button.disabled = !enabled;
    }
  }

  setQuality(choice: QualityChoice): void {
    this.quality = choice;
    this.paintQuality();
  }

  private toggleQuality(button: HTMLButtonElement): void {
    if (this.qualityDialog) {
      this.closeQuality(button);
      return;
    }
    const dialog = document.createElement('div');
    dialog.className = 'quality-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'quality-title');
    dialog.innerHTML = `
      <div class="quality-card">
        <h2 id="quality-title">Quality</h2>
        <p class="lede">Auto follows the frame rate. A manual choice stays put.</p>
        <div class="quality-modes" role="group" aria-label="Quality"></div>
        <p class="quality-note"></p>
        <button class="ghost" type="button" data-close>Close</button>
      </div>
    `;
    const modes = dialog.querySelector('.quality-modes') as HTMLElement;
    const choices: { id: QualityMode; label: string }[] = [
      { id: 'auto', label: 'Auto' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ];
    for (const choice of choices) {
      const modeButton = document.createElement('button');
      modeButton.type = 'button';
      modeButton.className = 'quality-mode';
      modeButton.dataset.mode = choice.id;
      modeButton.textContent = choice.label;
      modeButton.addEventListener('click', () => this.handlers.onQuality(choice.id));
      modes.append(modeButton);
    }
    dialog.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuality(button));
    this.qualityNote = dialog.querySelector('.quality-note');
    this.qualityDialog = dialog;
    button.setAttribute('aria-expanded', 'true');
    this.chrome.parentElement?.append(dialog);
    this.paintQuality();
  }

  private closeQuality(button: HTMLButtonElement): void {
    this.qualityDialog?.remove();
    this.qualityDialog = null;
    this.qualityNote = null;
    button.setAttribute('aria-expanded', 'false');
  }

  private paintQuality(): void {
    if (!this.qualityDialog) return;
    const running = this.quality.level === 'low' ? 'low' : this.quality.level === 'high' ? 'high' : 'medium';
    const shadows = this.quality.shadows ? 'Shadows on.' : 'Shadows off.';
    if (this.qualityNote) {
      this.qualityNote.textContent =
        this.quality.mode === 'auto' ? `Auto is using ${running}. ${shadows}` : `${shadows}`;
    }
    this.qualityDialog.querySelectorAll<HTMLButtonElement>('.quality-mode').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.mode === this.quality.mode ? 'true' : 'false');
    });
  }
}

function clayCard(clay: ClayType, selected: boolean): string {
  return `
    <button class="clay-card" type="button" data-clay="${clay.id}" aria-pressed="${selected ? 'true' : 'false'}">
      <span class="swatch" style="background:${clay.colorWet}"></span>
      <span>
        <strong>${clay.name}</strong>
        <span>${clay.blurb} · ${clay.maxTempC}°C</span>
      </span>
    </button>
  `;
}

function speedLabel(speed: number): string {
  const rpm = Math.round(speed * 248);
  return `${rpm} rpm`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
