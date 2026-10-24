/** Decorative gesture diagrams. The step text carries the instruction. */
export function gestureMarkup(id: 'center' | 'open' | 'pull'): string {
  switch (id) {
    case 'center':
      return `<svg class="gesture-svg" viewBox="0 0 200 80" aria-hidden="true">
        <path class="gesture-spin" d="M22 22a28 28 0 0 1 48-8" />
        <path class="gesture-spin" d="M66 10l6 8-10 2" />
        <ellipse class="gesture-clay" cx="48" cy="48" rx="28" ry="18" />
        <path class="gesture-hand" d="M176 48H92" />
        <path class="gesture-hand" d="M104 36 84 48l20 12" />
      </svg>`;
    case 'open':
      return `<svg class="gesture-svg" viewBox="0 0 200 80" aria-hidden="true">
        <ellipse class="gesture-clay" cx="78" cy="52" rx="40" ry="16" />
        <ellipse class="gesture-well" cx="78" cy="50" rx="14" ry="6" />
        <path class="gesture-hand" d="M78 8v30" />
        <path class="gesture-hand" d="M68 28 78 40l10-12" />
        <path class="gesture-hand" d="M100 50h42" />
        <path class="gesture-hand" d="M132 40 146 50l-14 10" />
      </svg>`;
    case 'pull':
      return `<svg class="gesture-svg" viewBox="0 0 200 80" aria-hidden="true">
        <path class="gesture-clay" d="M46 68c0-28 6-46 22-50h28c16 4 22 22 22 50" />
        <path class="gesture-hand" d="M142 64V16" />
        <path class="gesture-hand" d="M130 28 142 14l12 14" />
      </svg>`;
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}
