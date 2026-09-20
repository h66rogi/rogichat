import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests run against the QA build (`.next-qa`, ROGICHAT_WEB_ENV=qa) so the preview screens
 * are reachable. The isolation of the production build is verified separately by
 * tools/web/check-preview-isolation.mjs. Set PLAYWRIGHT_BASE_URL to test an already running server.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3101';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    locale: 'ko-KR',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'node ../../tools/web/serve-standalone.mjs --shape qa --port 3101',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      }),
});
