import type { PieceState, Stage } from '../../core/types';
import { canThrow } from '../../core/stateMachine';
import { gestureMarkup } from './gestures';
import { buildJourney, journeyReason, journeyStatus, type Journey, type JourneyStep } from './journey';
import { isTutorialDone, markTutorialDone } from './storage';
import { coachTip } from './tips';
import { tutorialSteps, type TutorialStep, type TutorialTool } from './tutorial';
import './onboarding.css';

export interface OnboardingOptions {
  app: HTMLElement;
  chrome: HTMLElement;
  stepperSlot: HTMLElement;
  tipSlot: HTMLElement;
  tools: readonly TutorialTool[];
  stages: readonly Stage[];
  storage?: Storage;
  /** Select the tool this gesture is teaching. Fired when the open step changes. */
  onStep?: (toolId: string) => void;
  /** Chrome height changed (tutorial opened or closed). */
  onLayout?: () => void;
}

/**
 * First-run throwing tutorial, the journey stepper, and one contextual tip.
 * The stepper and tip patch their own nodes. They are not part of the sheet
 * body, so a sheet rebuild cannot drop a tap or a slider drag.
 */
export class Onboarding {
  private readonly steps: TutorialStep[];
  private readonly card: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly gesture: HTMLElement;
  private readonly gestureText: HTMLElement;
  private readonly body: HTMLElement;
  private readonly note: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private index = 0;
  private paintedIndex = -1;
  private open = false;
  private done: boolean;
  private journeySig = '';
  private tipSig = '';
  private latest: PieceState | null = null;

  constructor(private readonly options: OnboardingOptions) {
    this.steps = tutorialSteps(options.tools);
    this.done = isTutorialDone(options.storage ?? localStorage);
    const card = buildCard({
      onBack: () => {
        if (this.index === 0) return;
        this.index -= 1;
        this.renderCard();
      },
      onSkip: () => this.hide(true),
      onNext: () => {
        if (this.index >= this.steps.length - 1) {
          this.hide(true);
          return;
        }
        this.index += 1;
        this.renderCard();
      },
    });
    this.card = card.root;
    this.kicker = card.kicker;
    this.title = card.title;
    this.gesture = card.gesture;
    this.gestureText = card.gestureText;
    this.body = card.body;
    this.note = card.note;
    this.back = card.back;
    this.next = card.next;
    options.chrome.prepend(this.card);
    options.tipSlot.innerHTML = '<p class="coach" role="status"></p>';
    window.addEventListener('keydown', this.onKey, true);
  }

  sync(piece: PieceState | null): void {
    this.latest = piece;
    this.paintJourney(buildJourney(piece, this.options.stages));
    this.paintTip(piece);
    if (!this.done && !this.open && piece && canThrow(piece)) this.show(false);
  }

  replay(): void {
    this.index = 0;
    this.paintedIndex = -1;
    this.show(true);
  }

  private show(fromHelp: boolean): void {
    const wasOpen = this.open;
    this.open = true;
    this.card.hidden = false;
    this.renderCard();
    this.paintTip(this.latest);
    this.helpButton()?.setAttribute('aria-expanded', 'true');
    if (fromHelp) this.next.focus();
    if (!wasOpen) this.options.onLayout?.();
  }

  private hide(markDone: boolean): void {
    if (markDone) {
      this.done = true;
      markTutorialDone(this.options.storage ?? localStorage);
    }
    const wasOpen = this.open;
    this.open = false;
    this.card.hidden = true;
    this.paintTip(this.latest);
    this.helpButton()?.setAttribute('aria-expanded', 'false');
    if (wasOpen) {
      this.helpButton()?.focus();
      this.options.onLayout?.();
    }
  }

  private renderCard(): void {
    const step = this.steps[this.index];
    if (!step || this.paintedIndex === this.index) return;
    this.paintedIndex = this.index;
    this.kicker.textContent = `Throwing · ${this.index + 1} of ${this.steps.length}`;
    this.title.textContent = step.title;
    this.gesture.innerHTML = gestureMarkup(step.id);
    this.gestureText.textContent = step.gesture;
    this.body.textContent = step.body;
    const last = this.index === this.steps.length - 1;
    this.note.hidden = !last;
    this.note.textContent = last
      ? 'Then take it off the wheel and let it dry. The steps below follow the clay from there.'
      : '';
    this.back.disabled = this.index === 0;
    this.next.textContent = last ? 'Done' : 'Next';
    this.options.onStep?.(step.id);
  }

  private paintJourney(journey: Journey): void {
    const reason = journeyReason(journey.steps, journey.stageLabel);
    const signature = `${reason}\n${journey.steps.map(stepSignature).join('\n')}`;
    if (signature === this.journeySig) return;
    this.journeySig = signature;
    let nav = this.options.stepperSlot.querySelector('nav');
    if (!nav) {
      this.options.stepperSlot.innerHTML = journeyMarkup(journey.steps);
      nav = this.options.stepperSlot.querySelector('nav');
    }
    if (!nav) return;
    for (const step of journey.steps) {
      const item = nav.querySelector<HTMLElement>(`[data-step="${step.id}"]`);
      if (!item) continue;
      item.className = stepClass(step);
      if (step.place === 'current') item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      const mark = item.querySelector('.journey-mark');
      if (mark) mark.textContent = step.place === 'done' ? '✓' : String(journey.steps.indexOf(step) + 1);
      const status = item.querySelector('.sr-only');
      if (status) status.textContent = journeyStatus(step);
    }
    const line = nav.querySelector('.journey-reason');
    if (line) line.textContent = reason;
  }

  private paintTip(piece: PieceState | null): void {
    if (this.open) {
      if (this.tipSig === 'tutorial') return;
      this.tipSig = 'tutorial';
      this.options.tipSlot.hidden = true;
      return;
    }
    const tip = coachTip(piece, this.options.tools);
    const signature = tip ? `${tip.id}:${tip.tone}:${tip.text}` : '';
    if (signature === this.tipSig) return;
    this.tipSig = signature;
    const node = this.options.tipSlot.querySelector('.coach');
    if (!tip || !node) {
      this.options.tipSlot.hidden = true;
      return;
    }
    this.options.tipSlot.hidden = false;
    node.className = tip.tone === 'caution' ? 'coach coach-caution' : 'coach';
    node.textContent = tip.text;
  }


  private helpButton(): HTMLButtonElement | null {
    const button = this.options.app.querySelector('.help');
    return button instanceof HTMLButtonElement ? button : null;
  }

  private onKey = (event: KeyboardEvent): void => {
    if (!this.open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.hide(true);
  };
}

function buildCard(handlers: { onBack: () => void; onSkip: () => void; onNext: () => void }): {
  root: HTMLElement;
  kicker: HTMLElement;
  title: HTMLElement;
  gesture: HTMLElement;
  gestureText: HTMLElement;
  body: HTMLElement;
  note: HTMLElement;
  back: HTMLButtonElement;
  next: HTMLButtonElement;
} {
  const root = document.createElement('div');
  root.className = 'tutorial';
  root.id = 'throwing-tutorial';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', 'tutorial-title');
  root.innerHTML = `
    <p class="tutorial-kicker"></p>
    <h2 id="tutorial-title"></h2>
    <div class="tutorial-figure"></div>
    <p class="tutorial-gesture"></p>
    <p class="tutorial-body"></p>
    <p class="tutorial-note" hidden></p>
    <div class="tutorial-actions">
      <button class="ghost" type="button" data-back>Back</button>
      <button class="ghost" type="button" data-skip>Skip</button>
      <button class="primary" type="button" data-next>Next</button>
    </div>
  `;
  const back = requiredButton(root, '[data-back]');
  const next = requiredButton(root, '[data-next]');
  back.addEventListener('click', handlers.onBack);
  requiredButton(root, '[data-skip]').addEventListener('click', handlers.onSkip);
  next.addEventListener('click', handlers.onNext);
  return {
    root,
    kicker: required(root, '.tutorial-kicker'),
    title: required(root, '#tutorial-title'),
    gesture: required(root, '.tutorial-figure'),
    gestureText: required(root, '.tutorial-gesture'),
    body: required(root, '.tutorial-body'),
    note: required(root, '.tutorial-note'),
    back,
    next,
  };
}

function stepSignature(step: JourneyStep): string {
  return `${step.id}:${step.place}:${step.allowed ? 1 : 0}:${step.reason}`;
}

function stepClass(step: JourneyStep): string {
  return `journey-step is-${step.place} ${step.allowed ? 'is-allowed' : 'is-blocked'}`;
}

function journeyMarkup(steps: readonly JourneyStep[]): string {
  const items = steps
    .map(
      (step) => `<li class="journey-step" data-step="${step.id}">
        <span class="journey-mark" aria-hidden="true"></span>
        <span class="journey-label">${escapeHtml(step.label)}</span>
        <span class="sr-only"></span>
      </li>`,
    )
    .join('');
    return `<nav class="journey" aria-label="Where this piece is"><ol>${items}</ol><p class="journey-reason"></p></nav>`;
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

function required(root: ParentNode, selector: string): HTMLElement {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
  return node;
}

function requiredButton(root: ParentNode, selector: string): HTMLButtonElement {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`Missing ${selector}`);
  return node;
}
