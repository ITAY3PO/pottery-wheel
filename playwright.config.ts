import { defineConfig, devices } from '@playwright/test';

const preview = 'http://127.0.0.1:4173/pottery-wheel/';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    ...devices['Pixel 7'],
    viewport: { width: 412, height: 924 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    baseURL: preview,
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: preview,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
