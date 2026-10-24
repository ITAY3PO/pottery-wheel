import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const port = 5198;
const preview = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/pottery-wheel/scripts/bake-room.html`);
      if (response.ok) return;
    } catch {
      // Vite is still binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('vite did not serve the bake page');
}

const browser = await chromium.launch({
  args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
try {
  await waitForServer();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/pottery-wheel/scripts/bake-room.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__room, null, { timeout: 30_000 });
  const room = await page.evaluate(() => window.__room);
  if (errors.length) throw new Error(errors.join('\n'));
  const pixels = Buffer.from(room.b64, 'base64');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(room.width, 0);
  header.writeUInt32LE(room.height, 4);
  writeFileSync('public/room-pmrem.bin', Buffer.concat([header, pixels]));
  console.log(`wrote public/room-pmrem.bin ${room.width}x${room.height} ${pixels.length} bytes`);
} finally {
  await browser.close();
  preview.kill('SIGTERM');
}
