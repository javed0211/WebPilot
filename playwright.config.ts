import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'packages/test-framework/tests',
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  use: {
    headless: true,
    // Use Playwright's bundled Chromium instead of system Chrome channel to avoid launch failures
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Do not set `channel: 'chrome'` to ensure bundled Chromium is used
      use: { browserName: 'chromium' },
    },
  ],
});
