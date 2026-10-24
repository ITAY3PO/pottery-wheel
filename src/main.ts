import './style.css';
import './fonts.css';
import { registerAppUpdate } from './pwa/update';

// The entry stays small so the wordmark can paint before Three.js parses.
// The service worker registers in production only; dev has no waiting worker.
registerAppUpdate();

const start = () => {
  void import('./boot');
};

if (typeof requestAnimationFrame === 'function') requestAnimationFrame(start);
else start();
