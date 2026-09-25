import { defineConfig, devices } from '@playwright/test';

// Browser tests use the same production artifact with QA runtime configuration.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3411';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 4 } : {}),
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
          command: 'node ../../tools/web/serve-standalone.mjs --port 3411',
          url: baseURL,
          env: {
            ROGICHAT_WEB_ENV: 'qa',
            ROGICHAT_API_ORIGIN: 'https://api.qa.rogi.chat',
            // Test-only room is served by browser interception, never built into the app.
            ROGICHAT_DEFAULT_ROOM_ID: '11111111-1111-4111-8111-111111111111',
            // Only this isolated test server trusts the intercepted synthetic signer.
            ROGICHAT_MEDIA_STORAGE_ORIGINS: '["https://media.test.invalid"]',
          },
          reuseExistingServer: false,
          timeout: 30_000,
        },
      }),
});
