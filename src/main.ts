import './style.css';
import './fonts.css';
import { registerAppUpdate } from './pwa/update';

// The entry stays small so the wordmark can paint before Three.js parses.
// The service worker registers in production only; dev has no waiting worker.
registerAppUpdate();

let booting = false;
let bootTimer = 0;

const start = () => {
  if (booting) return;
  booting = true;
  window.clearTimeout(bootTimer);
  void import('./boot');
};

if (import.meta.env.DEV) {
  start();
} else {
  // A tap brings the wheel up immediately. With no tap, wait long enough that the
  // first paint is not stuck behind WebGL startup on a slow phone.
  const bootOnGesture = () => {
    window.removeEventListener('pointerdown', bootOnGesture);
    window.removeEventListener('keydown', bootOnGesture);
    start();
  };
  window.addEventListener('pointerdown', bootOnGesture);
  window.addEventListener('keydown', bootOnGesture);
  bootTimer = window.setTimeout(start, 5000);
}
