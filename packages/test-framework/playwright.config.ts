import { defineConfig, devices } from '@playwright/test';
import { config } from './config/ConfigManager';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/** Headless from resources/config/webpilot.yaml (provider → browser.headless). */
function resolveHeadlessFromYaml(): boolean {
  try {
    const configPath = path.join(process.cwd(), 'resources', 'config', 'webpilot.yaml');
    if (!fs.existsSync(configPath)) return true;
    const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any> | null;
    if (!raw) return true;
    const browser = raw.browser || {};
    const providers = raw.browserProviders || {};
    const active =
      process.env.WEBPILOT_BROWSER_PROVIDER ||
      providers.active ||
      (browser?.testmu?.enabled ? 'testmu' : raw.framework?.useBrowserUse ? 'browser-use' : 'local-playwright');
    const providerBlock = providers[active] || {};
    if (providerBlock.headless != null) return Boolean(providerBlock.headless);
    if (browser.headless != null) return Boolean(browser.headless);
  } catch {
    /* fall through */
  }
  return true;
}

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
    headless: resolveHeadlessFromYaml(),
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    video: process.env.WEBPILOT_PW_VIDEO === 'on' ? 'on' : 'retain-on-failure',
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
