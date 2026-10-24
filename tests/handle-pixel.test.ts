import { describe, expect, it } from 'vitest';
import { chromePath, launchChrome, startApp } from './chrome';

type Pixel = [number, number, number, number];

function distance(a: readonly number[], b: readonly number[]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.hypot(dr, dg, db);
}

function celadon(pixel: Pixel): void {
  expect(pixel[3]).toBe(255);
  expect(pixel[1]).toBeGreaterThan(pixel[0]);
  expect(pixel[1]).toBeGreaterThan(pixel[2]);
  expect(distance(pixel, [220, 220, 220])).toBeGreaterThan(80);
  expect(distance(pixel, [10, 11, 8])).toBeGreaterThan(30);
}

const chrome = chromePath();

describe('glazed handle pixels', () => {
  it.skipIf(!chrome)('reads celadon at the handle centre in studio and gallery', async () => {
    const { server, origin } = await startApp();
    const browser = await launchChrome();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
      });
      await page.goto(`${origin}/pottery-wheel/tests/handle-glaze.html`, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForFunction(() => document.title === 'ready', { timeout: 20000 });
      const out = (await page.evaluate(() => (window as unknown as { __out: Record<string, Pixel> }).__out)) as Record<string, Pixel>;
      expect(errors, errors.join('\n')).toEqual([]);

      celadon(out.handle);
      celadon(out.gallery);
      celadon(out.coarse);
      celadon(out.half);
      celadon(out.zero);
      celadon(out.handleEnv);
      celadon(out.galleryEnv);

      expect(distance(out.handle, out.plain)).toBeLessThan(26);
      expect(distance(out.gallery, out.plain)).toBeLessThan(26);
      expect(distance(out.coarse, out.handle)).toBeLessThan(8);
      expect(distance(out.half, out.handle)).toBeLessThan(8);
      expect(distance(out.zero, out.handle)).toBeLessThan(8);
      expect(distance(out.bare, out.clayPlain)).toBeLessThan(8);
      expect(out.bare[0]).toBeGreaterThan(out.bare[1]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 60000);
});
