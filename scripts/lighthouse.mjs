import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { chromium } from '@playwright/test';

const port = 4173;
const url = `http://127.0.0.1:${port}/pottery-wheel/`;

if (!existsSync('dist/index.html')) {
  console.error('dist/index.html is missing. Run npm run build first.');
  process.exit(1);
}

const preview = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview is still binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`vite preview did not serve ${url}`);
}

let chrome;
let exitCode = 0;
try {
  await waitForServer();
  chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const result = await lighthouse(
    url,
    {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance'],
    },
    {
      extends: 'lighthouse:default',
      settings: {
        formFactor: 'mobile',
        throttlingMethod: 'simulate',
        onlyCategories: ['performance'],
        screenEmulation: {
          mobile: true,
          width: 412,
          height: 823,
          deviceScaleFactor: 1.75,
          disabled: false,
        },
      },
    },
  );
  const score = result?.lhr?.categories?.performance?.score;
  if (typeof score !== 'number') {
    console.error('Lighthouse did not return a performance score.');
    exitCode = 1;
  } else {
    const percent = Math.round(score * 100);
    console.log(`Lighthouse mobile performance: ${percent}`);
    const audits = [
      'first-contentful-paint',
      'largest-contentful-paint',
      'total-blocking-time',
      'cumulative-layout-shift',
      'speed-index',
      'interactive',
    ];
    for (const id of audits) {
      const audit = result.lhr.audits[id];
      if (audit) console.log(`${id}: ${audit.displayValue} (score ${audit.score})`);
    }
    if (score < 0.9) {
      console.error(`Performance score ${percent} is below 90.`);
      exitCode = 1;
    }
  }
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  if (chrome) await chrome.kill();
  preview.kill('SIGTERM');
  await new Promise((resolve) => {
    preview.once('exit', resolve);
    setTimeout(resolve, 2000);
  });
}

process.exit(exitCode);
