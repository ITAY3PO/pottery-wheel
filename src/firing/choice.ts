export const firingChoice = {
  bisqueCone: '06',
  glazeCone: '6',
};

/** Mark the cone button that matches the current choice. The shell rebuilds the row from labels, so this runs just after that paint. */
export function reflectConeChoice(kind: 'bisque' | 'glaze'): void {
  if (typeof document === 'undefined') return;
  const selected = kind === 'bisque' ? firingChoice.bisqueCone : firingChoice.glazeCone;
  queueMicrotask(() => {
    const sheet = document.querySelector('#app > .sheet-chrome > .sheet');
    if (!sheet) return;
    for (const button of sheet.querySelectorAll<HTMLButtonElement>('[data-action^="cone-"]')) {
      const on = button.dataset.action === `cone-${selected}`;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });
}
