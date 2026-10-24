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

// One turn so the document wordmark paints, then the shell. WebGL starts on a
// later turn inside boot, still during the load. A long idle wait would leave
// the page blank and push that work past the interaction window.
window.setTimeout(start, 0);
