import './style.css';
import './fonts.css';
import { registerAppUpdate } from './pwa/update';

// The entry stays small so the wordmark can paint before Three.js parses.
// The service worker registers in production only; dev has no waiting worker.
registerAppUpdate();

let booting = false;

const start = () => {
  if (booting) return;
  booting = true;
  void import('./boot');
};

const sharedLink = typeof location !== 'undefined' && location.hash.startsWith('#p1.');

function armIdleBoot(): void {
  const run = () => {
    const idle = window.requestIdleCallback;
    if (typeof idle === 'function') idle(() => start(), { timeout: 1500 });
    else window.setTimeout(start, 1500);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}

// A share link has to open the shelf immediately. Everything else waits for a
// quiet moment so the wordmark is not stuck behind WebGL startup.
if (import.meta.env.DEV || sharedLink) start();
else armIdleBoot();
