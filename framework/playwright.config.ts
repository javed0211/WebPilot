import { defineConfig, devices } from '@playwright/test';
import { config } from './config/ConfigManager';

export default defineConfig({
  testDir: './tests',
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
    ['html', { open: 'never', outputFolder: '../playwright-report' }],
    ['junit', { outputFile: '../reports/junit-results.xml' }],
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
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
