/**
 * Replays WebPilot CLI output timed to match the browser demo video (~27s).
 */
import * as fs from 'fs';
import * as path from 'path';
import { CliDisplay } from '../utils/CliDisplay';
import { UsageTracker } from '../utils/UsageTracker';
import { Logger } from '../utils/Logger';

const ROOT = path.join(__dirname, '..');
const testPath = 'tests/web/automationexercise_add_to_cart.txt';
const testName = 'automationexercise_add_to_cart';
const BROWSER_DURATION_MS = 27100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadNlSteps(): string[] {
  const historyPath = path.join(ROOT, 'reports', `${testName}_execution_history.json`);
  if (fs.existsSync(historyPath)) {
    const data = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    if (Array.isArray(data.nlSteps) && data.nlSteps.length > 0) {
      return data.nlSteps as string[];
    }
  }
  return [
    'Navigate to https://automationexercise.com/',
    'Verify that home page is visible successfully with featured items displayed',
    'Click on Products link in the navigation menu',
    'Verify user is navigated to ALL PRODUCTS page successfully',
    'Hover over the first product on the products page',
    'Click Add to cart on the first product',
    'Click Continue Shopping button in the confirmation modal',
    'Hover over the second product on the products page',
    'Click Add to cart on the second product',
    'Click View Cart button from the cart confirmation',
    'Verify user is on the Cart page with both products listed',
    'Verify each product price, quantity, and total price are visible and correct',
  ];
}

async function main(): Promise<void> {
  const absTest = path.join(ROOT, testPath);
  const content = fs.readFileSync(absTest, 'utf8');
  const nlSteps = loadNlSteps();
  const started = Date.now();

  console.log(`\n$ cat ${testPath}\n`);
  console.log(content.trim().split('\n').slice(0, 14).join('\n'));
  await sleep(1400);

  console.log(`\n$ npm run webpilot -- run ${testPath} --env qa --headed\n`);
  await sleep(700);

  CliDisplay.printBanner({
    test: testPath,
    env: 'qa',
    mode: 'headed',
    architecture: 'pom',
  });

  Logger.info('Initializing execution session');
  Logger.info('Delegating to browser-use runner');
  await sleep(900);

  const introMs = Date.now() - started;
  const outroMs = 3200;
  const stepWindowMs = BROWSER_DURATION_MS - introMs - outroMs;
  const stepDelayMs = Math.max(900, Math.floor(stepWindowMs / nlSteps.length));

  for (let i = 0; i < nlSteps.length; i++) {
    Logger.step(i + 1, nlSteps.length, nlSteps[i]);
    if (i < nlSteps.length - 1) {
      await sleep(stepDelayMs);
    }
  }

  await sleep(800);
  Logger.info('Post-processing generated POMs and specs');
  Logger.success('Generated Playwright spec and page objects');
  await sleep(600);

  const usagePath = path.join(ROOT, 'reports', `${testName}_llm_usage.json`);
  if (fs.existsSync(usagePath)) {
    UsageTracker.loadFromFile(usagePath);
  } else {
    UsageTracker.record({ promptTokens: 166671, completionTokens: 5431, cost: 0.28975 });
  }

  CliDisplay.printJobSummary({
    test: testName,
    success: true,
    durationMs: 272000,
    usage: UsageTracker.getSnapshot(),
    stepsExecuted: 50,
  });

  const elapsed = Date.now() - started;
  const remaining = BROWSER_DURATION_MS - elapsed;
  if (remaining > 0) {
    await sleep(remaining);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
