import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build (service worker included) so offline mode is real.
 * Uses the locally installed Microsoft Edge (Chromium) by default; set PW_CHANNEL=chrome
 * or PW_CHANNEL= (empty, bundled Chromium after `npx playwright install chromium`).
 */
const channel = process.env.PW_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    channel: channel || undefined,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    acceptDownloads: true,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: channel || undefined } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
