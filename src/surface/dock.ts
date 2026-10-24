import { GLAZES } from './catalog';
import { painter, publishPainter } from './session';

let mounted = false;

const BRUSH_STEPS = [
  { id: 'small', label: 'S', name: 'Small', size: 0.16 },
  { id: 'medium', label: 'M', name: 'Medium', size: 0.5 },
  { id: 'large', label: 'L', name: 'Large', size: 0.84 },
] as const;

/**
 * One compact row — wax, glaze swatches, and a three-step brush — under
 * Dip, Pour, and Coat is done. The shell rebuilds `.sheet` from HTML, so
 * both are wrapped again at the top of the sheet and kept on screen.
 */
export function mountPainter(): void {
  if (mounted || typeof document === 'undefined') return;
  const root = document.querySelector('#app');
  if (!(root instanceof HTMLElement)) return;
  mounted = true;

  if (!document.getElementById('pw-painter-style')) {
    const style = document.createElement('style');
    style.id = 'pw-painter-style';
    style.textContent = PAINTER_CSS;
    document.head.append(style);
  }

  const sizes = BRUSH_STEPS.map(
    (step) =>
      `<button class="painter-size" type="button" data-size="${step.id}" aria-label="${step.name} brush">${step.label}</button>`,
  ).join('');
  const dock = document.createElement('div');
  dock.className = 'painter';
  dock.innerHTML = `
    <div class="painter-row">
      <button class="painter-wax" type="button" data-wax aria-pressed="false">Wax</button>
      <div class="painter-swatch-wrap">
        <div class="painter-swatches" role="listbox" aria-label="Glazes"></div>
        <button class="painter-more" type="button" aria-label="More glazes" hidden>›</button>
      </div>
      <div class="painter-sizes" role="group" aria-label="Brush size">${sizes}</div>
    </div>
  `;

  const swatchRow = dock.querySelector('.painter-swatches') as HTMLElement;
  for (const glaze of GLAZES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'painter-swatch';
    button.dataset.id = String(glaze.id);
    button.setAttribute('aria-label', glaze.name);
    button.style.background = glaze.raw;
    button.addEventListener('click', () => {
      painter.mode = 'glaze';
      painter.glazeId = glaze.id;
      sync(dock);
      publishPainter();
    });
    swatchRow.append(button);
  }

  const wax = dock.querySelector('[data-wax]') as HTMLButtonElement;
  wax.addEventListener('click', () => {
    painter.mode = 'wax';
    sync(dock);
    publishPainter();
  });

  dock.querySelectorAll<HTMLButtonElement>('.painter-size').forEach((button) => {
    button.addEventListener('click', () => {
      const step = BRUSH_STEPS.find((entry) => entry.id === button.dataset.size);
      if (!step) return;
      painter.brushSize = step.size;
      sync(dock);
      ringSize();
    });
  });

  const swatches = dock.querySelector('.painter-swatches') as HTMLElement;
  const more = dock.querySelector('.painter-more') as HTMLButtonElement;
  more.addEventListener('click', () => {
    swatches.scrollBy({ left: 104, behavior: 'smooth' });
  });
  swatches.addEventListener('scroll', () => markSwatchOverflow(swatches, more), { passive: true });
  window.addEventListener('resize', () => markSwatchOverflow(swatches, more));

  const ring = document.createElement('div');
  ring.className = 'brush-ring';
  ring.setAttribute('aria-hidden', 'true');
  root.append(ring);

  let pointers = 0;
  const showRing = (event: PointerEvent) => {
    const onCanvas = event.target instanceof Element && event.target.tagName === 'CANVAS';
    const bisque = root.getAttribute('data-stage') === 'bisque';
    if (!bisque || !onCanvas || pointers !== 1) {
      ring.classList.remove('show');
      return;
    }
    ring.classList.add('show');
    ring.style.left = `${event.clientX}px`;
    ring.style.top = `${event.clientY}px`;
    ringSize();
  };
  const ringSize = () => {
    const px = 28 + painter.brushSize * 56;
    ring.style.width = `${px}px`;
    ring.style.height = `${px}px`;
  };
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      pointers += 1;
      showRing(event);
    },
    true,
  );
  window.addEventListener('pointermove', showRing, true);
  const lift = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointers = Math.max(0, pointers - 1);
    if (pointers === 0) ring.classList.remove('show');
  };
  window.addEventListener('pointerup', lift, true);
  window.addEventListener('pointercancel', lift, true);

  const place = () => {
    // The gallery overlay has its own sheet. The potter's sheet is the one
    // directly under #app. Dip, pour, and coat stay in front of this row.
    const sheet = root.querySelector(':scope > .sheet-chrome > .sheet');
    const actions = sheet?.querySelector('.actions');
    if (!sheet || !actions || actions.parentElement?.closest('.gal-layer')) return;
    const bisque = root.getAttribute('data-stage') === 'bisque';
    const bar = sheet.querySelector(':scope > .painter-bar');
    if (!bisque) {
      if (bar instanceof HTMLElement) {
        const parked = bar.querySelector(':scope > .tools');
        if (parked) bar.after(parked);
        if (actions.parentElement === bar) bar.replaceWith(actions);
        else bar.remove();
      }
      return;
    }
    const tools = sheet.querySelector('.tools');
    const host = bar instanceof HTMLElement ? bar : document.createElement('div');
    host.className = 'painter-bar';
    const toolsReady = !(tools instanceof HTMLElement) || (tools.parentElement === host && tools.previousElementSibling === dock);
    if (host.parentElement !== sheet || actions.parentElement !== host || dock.parentElement !== host || dock.previousElementSibling !== actions || !toolsReady) {
      if (host.parentElement !== sheet) sheet.prepend(host);
      const nodes: Node[] = [actions, dock];
      if (tools instanceof HTMLElement) nodes.push(tools);
      host.append(...nodes);
      window.dispatchEvent(new Event('resize'));
    }
    const row = dock.querySelector('.painter-swatches');
    const moreGlazes = dock.querySelector('.painter-more');
    if (row instanceof HTMLElement && moreGlazes instanceof HTMLButtonElement) markSwatchOverflow(row, moreGlazes);
  };
  const observer = new MutationObserver(place);
  observer.observe(root, { childList: true, subtree: true });
  sync(dock);
  place();
}

function sync(dock: HTMLElement): void {
  const wax = dock.querySelector('[data-wax]');
  wax?.setAttribute('aria-pressed', painter.mode === 'wax' ? 'true' : 'false');
  dock.querySelectorAll<HTMLButtonElement>('.painter-swatch').forEach((button) => {
    const on = painter.mode === 'glaze' && Number(button.dataset.id) === painter.glazeId;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const step = brushStep(painter.brushSize);
  dock.querySelectorAll<HTMLButtonElement>('.painter-size').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.size === step ? 'true' : 'false');
  });
}

function markSwatchOverflow(row: HTMLElement, more: HTMLButtonElement): void {
  const leftover = row.scrollWidth - row.clientWidth - row.scrollLeft;
  const canScroll = leftover > 6;
  row.classList.toggle('can-scroll', canScroll);
  more.hidden = !canScroll;
}

function brushStep(size: number): string {
  if (size < 0.34) return 'small';
  if (size < 0.67) return 'medium';
  return 'large';
}

const PAINTER_CSS = `
#app[data-stage="bisque"] > .sheet-chrome > .sheet {
  display: flex;
  flex-direction: column;
}
#app[data-stage="bisque"] > .sheet-chrome > .sheet > .painter-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  flex-shrink: 0;
  background: var(--paper);
  padding-bottom: 4px;
}
#app[data-stage="bisque"] > .sheet-chrome > .sheet > .painter-bar > .actions {
  margin-top: 0;
}
.painter { display: none; margin: 8px 0 0; }
#app[data-stage="bisque"] .painter { display: block; }
.painter-row { display: flex; gap: 8px; align-items: center; min-width: 0; }
.painter-wax {
  flex: 0 0 auto;
  min-width: 56px;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1.5px solid var(--line);
  background: #f4efe4;
  font: inherit;
  font-weight: 640;
}
.painter-wax[aria-pressed="true"] {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}
.painter-swatch-wrap {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.painter-swatches {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px 0;
  scrollbar-width: none;
  touch-action: pan-x;
}
.painter-swatches.can-scroll {
  mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 16px), transparent);
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 16px), transparent);
}
.painter-swatches::-webkit-scrollbar { display: none; }
.painter-more {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0 0 2px;
  border: 1.5px solid var(--line);
  border-radius: 50%;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: 22px;
  font-weight: 640;
  line-height: 1;
}
.painter-more[hidden] { display: none; }
.painter-swatch {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  padding: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: inset 0 -8px 10px rgba(0, 0, 0, 0.16), inset 0 4px 6px rgba(255, 255, 255, 0.35);
}
.painter-swatch[aria-pressed="true"] { border-color: var(--ink); }
.painter-sizes { display: flex; gap: 4px; flex: 0 0 auto; }
.painter-size {
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 999px;
  border: 1.5px solid var(--line);
  background: transparent;
  font: inherit;
  font-weight: 640;
}
.painter-size[aria-pressed="true"] {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}
.brush-ring {
  position: fixed;
  z-index: 5;
  display: none;
  width: 48px;
  height: 48px;
  margin: 0;
  border: 1.5px solid rgba(255, 250, 244, 0.92);
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(42, 31, 24, 0.4);
  pointer-events: none;
  transform: translate(-50%, -50%);
}
#app[data-stage="bisque"] .brush-ring.show { display: block; }
`;
