export const UPDATE_LABEL = 'New version, tap to reload';

let pendingReload: (() => void) | null = null;

/**
 * Prompt when a waiting service worker has a new app shell.
 * The button is the whole prompt: one tap, then the page reloads onto the new cache.
 */
export function showUpdatePrompt(reload: () => void): void {
  pendingReload = reload;
  if (typeof document === 'undefined') return;
  let bar = document.querySelector<HTMLElement>('.pw-update');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'pw-update';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pw-update-reload';
    button.textContent = UPDATE_LABEL;
    button.addEventListener('click', () => {
      button.disabled = true;
      pendingReload?.();
    });
    bar.append(button);
    document.body.append(bar);
  }
  const button = bar.querySelector('button');
  if (button) button.disabled = false;
}

export function openUpdatePrompt(): void {
  showUpdatePrompt(() => {
    window.location.reload();
  });
}

export function registerAppUpdate(): void {
  if (!import.meta.env.PROD || typeof window === 'undefined') return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        showUpdatePrompt(() => {
          void update(true);
        });
      },
    });
  });
}
