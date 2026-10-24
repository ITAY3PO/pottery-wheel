import { CLAY_TYPES, type ClayType } from '../../clay/clays';
import type { ClayTypeId } from '../../core/types';

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
}

export class Shell {
  private readonly subtitle: HTMLElement;
  private readonly sheet: HTMLElement;
  private signature = '';
  private rpmNode: HTMLElement | null = null;
  private hintNode: HTMLElement | null = null;
  private meterNode: HTMLElement | null = null;
  private messageNode: HTMLElement | null = null;
  private speedReadout: HTMLElement | null = null;

  constructor(
    root: HTMLElement,
    private readonly handlers: ShellHandlers,
  ) {
    const wordmark = document.createElement('header');
    wordmark.className = 'wordmark';
    wordmark.innerHTML = '<h1>The Wheel</h1><p></p>';
    const sheet = document.createElement('section');
    sheet.className = 'sheet';
    root.append(wordmark, sheet);
    this.subtitle = wordmark.querySelector('p') as HTMLElement;
    this.sheet = sheet;
  }

  get sheetHeight(): number {
    return this.sheet.offsetHeight;
  }

  get sheetWidth(): number {
    return this.sheet.offsetWidth;
  }

  render(model: ShellModel): void {
    this.subtitle.textContent = model.subtitle;
    const signature = JSON.stringify({
      phase: model.phase,
      clayId: model.clayId,
      weight: model.weightKg,
      hasSave: model.hasSave,
      tools: model.tools.map((tool) => tool.id),
      active: model.activeToolId,
      showWheel: model.showWheel,
      running: model.running,
      actions: model.actions,
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
    const start = this.sheet.querySelector<HTMLButtonElement>('[data-start]');
    const stop = this.sheet.querySelector<HTMLButtonElement>('[data-stop]');
    if (start) start.setAttribute('aria-pressed', model.running ? 'true' : 'false');
    if (stop) stop.classList.toggle('down', !model.running && model.rpm < 1);
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
    this.sheet.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', () => this.handlers.onAction(button.dataset.action || ''));
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
