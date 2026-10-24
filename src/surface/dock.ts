import { GLAZES, getGlaze } from './catalog';
import { painter, publishPainter } from './session';

let mounted = false;

/**
 * Swatches, wax, and brush size live in the sheet. Dip, pour, and
 * "coat is done" stay stage actions. The shell rebuilds `.sheet` from
 * HTML, so the dock is reinserted in front of `.actions`.
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

  const dock = document.createElement('div');
  dock.className = 'painter';
  dock.innerHTML = `
    <div class="painter-row">
      <button class="painter-wax" type="button" data-wax aria-pressed="false">Wax</button>
      <div class="painter-swatches" role="listbox" aria-label="Glazes"></div>
    </div>
    <p class="painter-caption"></p>
    <div class="field"><span>Brush</span><b data-size-word>Medium</b></div>
    <input type="range" min="0" max="1" step="0.01" value="${painter.brushSize}" aria-label="Brush size" />
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

  const size = dock.querySelector('input[type="range"]') as HTMLInputElement;
  const word = dock.querySelector('[data-size-word]') as HTMLElement;
  size.addEventListener('input', () => {
    painter.brushSize = Number(size.value);
    word.textContent = sizeWord(painter.brushSize);
    ringSize();
  });

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
    // directly under #app, and dip / pour live in its action row.
    const sheet = root.querySelector(':scope > .sheet-chrome > .sheet');
    const actions = sheet?.querySelector(':scope > .actions');
    if (!sheet || !actions) return;
    if (dock.parentElement === sheet && dock.nextElementSibling === actions) return;
    sheet.insertBefore(dock, actions);
    window.dispatchEvent(new Event('resize'));
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
  const caption = dock.querySelector('.painter-caption');
  if (caption) caption.textContent = painter.mode === 'wax' ? 'Wax resist' : getGlaze(painter.glazeId).name;
  const word = dock.querySelector('[data-size-word]');
  if (word) word.textContent = sizeWord(painter.brushSize);
}

function sizeWord(size: number): string {
  if (size < 0.34) return 'Small';
  if (size < 0.67) return 'Medium';
  return 'Large';
}

const PAINTER_CSS = `
.painter { display: none; margin: 0 0 8px; }
#app[data-stage="bisque"] .painter { display: block; }
.painter-row { display: flex; gap: 8px; align-items: center; }
.painter-wax {
  flex: 0 0 auto;
  min-width: 64px;
  min-height: 44px;
  padding: 0 14px;
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
.painter-swatches {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  flex: 1;
  padding: 2px 0;
  scrollbar-width: none;
  touch-action: pan-x;
}
.painter-swatches::-webkit-scrollbar { display: none; }
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
.painter-caption { margin: 6px 0 0; color: var(--muted); font-size: 13px; min-height: 1.2em; }
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
