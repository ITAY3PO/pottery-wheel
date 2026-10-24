import { describe, expect, it } from 'vitest';
import { chromePath, launchChrome, startApp } from './chrome';

const chrome = chromePath();

describe('glaze swatch scroll cue', () => {
  it.skipIf(!chrome)('keeps the 44px cue outside the row and lets the edge swatch be tapped', async () => {
    const { server, origin } = await startApp();
    const browser = await launchChrome();
    try {
      const page = await browser.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('pottery-wheel:onboarding', 'done');
      });
      await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await page.goto(`${origin}/pottery-wheel/`, { waitUntil: 'networkidle0', timeout: 30000 });
      const click = async (id: string) => {
        const handle = await page.waitForSelector(`[data-action="${id}"]:not([disabled])`, { timeout: 15000 });
        if (!handle) throw new Error(`missing ${id}`);
        await handle.click();
      };
      await page.click('[data-begin]');
      await click('wire-off');
      await click('dry-leather');
      await click('dry-bone');
      await page.click('[data-action="cone-04"]');
      await click('fire-bisque');
      await page.waitForSelector('.pw-kiln-open:not([hidden])', { timeout: 15000 });
      await page.click('.pw-kiln-open');
      await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-stage') === 'bisque');
      await page.waitForFunction(() => !document.querySelector('.pw-kiln'));
      await page.waitForSelector('.painter-more:not([hidden])', { timeout: 5000 });

      const before = await page.evaluate(() => {
        const row = document.querySelector('.painter-swatches') as HTMLElement;
        const more = document.querySelector('.painter-more') as HTMLElement;
        const rowBox = row.getBoundingClientRect();
        const moreBox = more.getBoundingClientRect();
        const mask = getComputedStyle(row).maskImage || getComputedStyle(row).webkitMaskImage;
        const swatches = [...row.querySelectorAll<HTMLButtonElement>('.painter-swatch')].map((el) => {
          const box = el.getBoundingClientRect();
          return { id: el.dataset.id ?? '', left: box.left, right: box.right, top: box.top, width: box.width, height: box.height };
        });
        const visible = swatches.filter((box) => box.left >= rowBox.left - 1 && box.left + box.width / 2 <= rowBox.right + 1);
        const edge = visible[visible.length - 1];
        return {
          more: { width: moreBox.width, height: moreBox.height, left: moreBox.left, hidden: more.hasAttribute('hidden') },
          rowRight: rowBox.right,
          canScroll: row.classList.contains('can-scroll'),
          mask,
          edge,
        };
      });

      expect(before.more.hidden).toBe(false);
      expect(before.more.width).toBeGreaterThanOrEqual(44);
      expect(before.more.height).toBeGreaterThanOrEqual(44);
      expect(before.more.left).toBeGreaterThanOrEqual(before.rowRight - 1);
      expect(before.canScroll).toBe(true);
      expect(before.mask).toContain('gradient');
      expect(before.edge).toBeTruthy();

      const x = before.edge.left + before.edge.width / 2;
      const y = before.edge.top + before.edge.height / 2;
      const hit = await page.evaluate(
        (px, py) => {
          const el = document.elementFromPoint(px, py);
          return el instanceof HTMLElement ? { className: el.className, id: el.dataset.id ?? '' } : null;
        },
        x,
        y,
      );
      expect(hit?.className).toContain('painter-swatch');
      expect(hit?.id).toBe(before.edge.id);
      await page.mouse.click(x, y);
      await page.waitForFunction(
        (id) => document.querySelector(`.painter-swatch[data-id="${id}"]`)?.getAttribute('aria-pressed') === 'true',
        {},
        before.edge.id,
      );
    } finally {
      await browser.close();
      await server.close();
    }
  }, 60000);
});
