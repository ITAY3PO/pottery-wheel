import { expect, test, type Page } from '@playwright/test';

interface Point {
  x: number;
  y: number;
}

interface JoinPrep {
  scored: boolean;
  slipped: boolean;
}

function pottery(page: Page) {
  return {
    async ready(): Promise<void> {
      await page.evaluate(() => {
        window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      });
      await page.waitForFunction(() => {
        const app = (window as unknown as { __pottery?: { project?: unknown } }).__pottery;
        return typeof app?.project === 'function';
      });
    },
    async project(x: number, y: number): Promise<Point> {
      return page.evaluate(({ x, y }) => {
        const app = (window as unknown as { __pottery: { project: (x: number, y: number) => Point } }).__pottery;
        return app.project(x, y);
      }, { x, y });
    },
    async edge(height: number): Promise<number> {
      return page.evaluate((height) => {
        const app = (window as unknown as { __pottery: { edge: (height: number, side: number) => number } }).__pottery;
        return app.edge(height, 1);
      }, height);
    },
    async height(): Promise<number> {
      return page.evaluate(() => {
        const app = (window as unknown as { __pottery: { height: () => number } }).__pottery;
        return app.height();
      });
    },
    async stage(): Promise<string> {
      return page.evaluate(() => {
        const app = (window as unknown as { __pottery: { stage: () => string } }).__pottery;
        return app.stage();
      });
    },
    async attachments(): Promise<number> {
      return page.evaluate(() => {
        const app = (window as unknown as { __pottery: { attachmentCount: () => number } }).__pottery;
        return app.attachmentCount();
      });
    },
    async join(): Promise<JoinPrep> {
      return page.evaluate(() => {
        const app = (window as unknown as { __pottery: { join: () => JoinPrep } }).__pottery;
        return app.join();
      });
    },
  };
}

async function drag(page: Page, from: Point, to: Point, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function hold(page: Page, point: Point, ms: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(40);
}

/** A tap has to stay down across a frame. The tools apply on the sim tick, not the event. */
async function tapClay(page: Page): Promise<void> {
  const canvas = await page.getByRole('application').boundingBox();
  const sheet = await page.locator('#app > .sheet-chrome').boundingBox();
  if (!canvas) throw new Error('Missing canvas');
  const aboveSheet = sheet ? sheet.y - 30 : canvas.y + canvas.height * 0.4;
  const point = {
    x: canvas.x + canvas.width * 0.55,
    y: Math.max(canvas.y + 140, Math.min(canvas.y + canvas.height * 0.38, aboveSheet)),
  };
  await hold(page, point, 120);
}

async function clickTool(page: Page, id: string): Promise<void> {
  const button = page.locator(`[data-tool="${id}"]`);
  await expect(button).toBeVisible();
  await button.click();
}

async function clickAction(page: Page, id: string): Promise<void> {
  const button = page.locator(`[data-action="${id}"]`);
  await expect(button).toBeEnabled();
  await button.click();
}

async function openKilnDoor(page: Page): Promise<void> {
  const door = page.locator('.pw-kiln-open');
  await expect(door).toBeVisible({ timeout: 15_000 });
  await door.click();
  await expect(page.locator('.pw-kiln')).toHaveCount(0, { timeout: 10_000 });
}

test('manifest, service worker, and share tags', async ({ page }) => {
  await page.goto('/pottery-wheel/');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'The Wheel');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-preview\.png/);

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifestUrl = new URL(href as string, page.url()).href;
  const manifest = await (await page.request.get(manifestUrl)).json();
  expect(manifest.name).toBe('The Wheel');
  expect(String(manifest.start_url)).toContain('/pottery-wheel/');
  expect(String(manifest.scope)).toContain('/pottery-wheel/');
  expect(manifest.theme_color).toBe('#2a211c');
  const icons = manifest.icons as { sizes: string; purpose?: string }[];
  expect(icons.some((icon) => icon.sizes === '192x192')).toBe(true);
  expect(icons.some((icon) => icon.sizes === '512x512')).toBe(true);
  expect(icons.some((icon) => String(icon.purpose).includes('maskable'))).toBe(true);

  const active = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  expect(active).toBe(true);

  const wheel = pottery(page);
  await wheel.ready();
  await page.evaluate(() => {
    (window as unknown as { __pottery: { showUpdate: () => void } }).__pottery.showUpdate();
  });
  await expect(page.getByRole('button', { name: 'New version, tap to reload' })).toBeVisible();

  const settings = await page.locator('.settings').boundingBox();
  expect(settings).not.toBeNull();
  expect(settings!.width).toBeGreaterThanOrEqual(44);
  expect(settings!.height).toBeGreaterThanOrEqual(44);
});

test('throws, trims, handles, fires, and opens a share link', async ({ page }) => {
  await page.goto('/pottery-wheel/');
  const wheel = pottery(page);
  await wheel.ready();

  await page.getByRole('button', { name: 'Sit down and throw' }).click();
  const skip = page.locator('[data-skip]');
  try {
    await skip.waitFor({ state: 'visible', timeout: 4000 });
    await skip.click();
  } catch {
    // The tutorial is already dismissed in this profile.
  }

  await page.locator('[data-start]').click();
  await clickTool(page, 'center');
  const edge = await wheel.edge(0.04);
  await hold(page, await wheel.project(Math.max(edge * 0.55, 0.02), 0.04), 1200);

  await clickTool(page, 'open');
  const height = await wheel.height();
  const openTop = await wheel.project(0.004, height * 0.82);
  const openFloor = await wheel.project(0.004, height * 0.28);
  const openWide = await wheel.project(0.028, height * 0.32);
  await drag(page, openTop, openFloor, 8);
  await drag(page, openFloor, openWide, 8);

  await clickTool(page, 'pull');
  const wall = await wheel.edge(height * 0.45);
  const pullLow = await wheel.project(Math.max(wall * 0.72, 0.02), height * 0.3);
  const pullHigh = await wheel.project(Math.max(wall * 0.55, 0.018), height * 0.92);
  await drag(page, pullLow, pullHigh, 14);

  await page.locator('[data-stop]').click();
  await clickAction(page, 'wire-off');
  await expect.poll(() => wheel.stage()).toBe('wet');
  await clickAction(page, 'dry-leather');
  await expect.poll(() => wheel.stage()).toBe('leather-hard');

  await clickAction(page, 'remount');
  await clickTool(page, 'trim-round');
  const trimHeight = await wheel.height();
  const trimIn = await wheel.project(0.01, trimHeight * 0.2);
  const trimOut = await wheel.project(0.04, trimHeight * 0.35);
  await drag(page, trimIn, trimOut, 8);

  await clickAction(page, 'unmount');
  await clickTool(page, 'handle');
  const handleStart = await wheel.project(0.045, 0.03);
  const handleEnd = await wheel.project(0.05, 0.12);
  await drag(page, handleStart, handleEnd, 16);
  await expect.poll(() => wheel.attachments()).toBeGreaterThan(0);

  await clickTool(page, 'score');
  await tapClay(page);
  await clickTool(page, 'slip');
  await tapClay(page);
  await expect.poll(async () => {
    const join = await wheel.join();
    return join.scored && join.slipped;
  }).toBe(true);

  await clickAction(page, 'dry-bone');
  await expect.poll(() => wheel.stage()).toBe('bone-dry');
  await clickAction(page, 'fire-bisque');
  await openKilnDoor(page);
  await expect.poll(() => wheel.stage()).toBe('bisque');

  await clickAction(page, 'dip');
  await clickAction(page, 'finish-glaze');
  await expect.poll(() => wheel.stage()).toBe('glazed');
  await clickAction(page, 'fire-glaze');
  await openKilnDoor(page);
  await expect.poll(() => wheel.stage()).toBe('glaze-fired');

  await clickAction(page, 'save-gallery');
  await expect(page.getByText('Saved to your gallery.')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await clickAction(page, 'share-gallery');
  await page.getByRole('button', { name: 'Share link' }).click();
  const link = await page.getByLabel('Share link').inputValue();
  expect(link).toContain('#p1.');

  await page.goto(link);
  await expect(page.getByText('A shared pot')).toBeVisible();
});
