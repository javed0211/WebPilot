import { defineConfig, devices } from '@playwright/test';
import { config } from './config/ConfigManager';

export default defineConfig({
  testDir: './tests',
  outputDir: '../../runtime/test-results',
  testMatch: '**/*.spec.ts',
  timeout: Math.max(config.variables?.timeout ?? 0, 60000),
  expect: {
    timeout: 10000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: config.variables.retry || 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never', outputFolder: '../../runtime/playwright-report' }],
    ['junit', { outputFile: '../../runtime/reports/junit/junit-results.xml' }],
    ['list']
  ],
  use: {
    baseURL: config.baseUrl,
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: '**/*.spec.ts',
      testIgnore: '**/*.api.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Use installed Google Chrome (same as browser-use) so codegen validation
        // works on Windows without `npx playwright install chromium`.
        channel: 'chrome',
      },
    },
    {
      name: 'api',
      testMatch: '**/*.api.spec.ts',
      use: {
        baseURL: config.apiBaseUrl || config.baseUrl,
        extraHTTPHeaders: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      },
    },
  ],
});
