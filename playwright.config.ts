import { defineConfig } from '@playwright/test';

/**
 * GUI smoke tests drive the real Electron app (not a browser), so they run
 * serially in a single worker and have no `webServer`. They expect a
 * production build to exist at `release/app/dist` — run `npm run build` first,
 * or use `npm run test:smoke`, which builds then tests.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
});
