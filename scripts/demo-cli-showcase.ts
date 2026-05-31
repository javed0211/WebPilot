/**
 * Replays authentic WebPilot CLI output for demo video recording.
 * Uses real CliDisplay, UsageTracker, and saved run data from reports/.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CliDisplay } from '../utils/CliDisplay';
import { UsageTracker } from '../utils/UsageTracker';

const ROOT = path.join(__dirname, '..');
const testPath = 'tests/web/automationexercise_add_to_cart.txt';
const testName = 'automationexercise_add_to_cart';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const absTest = path.join(ROOT, testPath);
  const content = fs.readFileSync(absTest, 'utf8');

  console.log(`\n$ cat ${testPath}\n`);
  console.log(content.trim().split('\n').slice(0, 14).join('\n'));

  await sleep(1200);

  console.log(`\n$ npm run webpilot -- run ${testPath} --env qa --headed\n`);
  await sleep(600);

  CliDisplay.printBanner({
    test: testPath,
    env: 'qa',
    mode: 'headed',
    architecture: 'pom',
  });

  console.log('[INFO] Initializing execution session');
  console.log('[INFO] Delegating to browser-use runner');
  await sleep(400);
  console.log('[INFO] Starting execution of 1 tests with concurrency 1...');
  await sleep(300);
  console.log('[INFO] Loaded browser-use LLM usage: 172,102 tokens, ~$0.2898');
  console.log('[INFO] Post-processing generated POMs and specs');
  await sleep(500);

  const usagePath = path.join(ROOT, 'reports', `${testName}_llm_usage.json`);
  if (fs.existsSync(usagePath)) {
    UsageTracker.loadFromFile(usagePath);
  } else {
    UsageTracker.record({
      promptTokens: 166671,
      completionTokens: 5431,
      cost: 0.28975,
    });
  }

  CliDisplay.printJobSummary({
    test: testName,
    success: true,
    durationMs: 272000,
    usage: UsageTracker.getSnapshot(),
    stepsExecuted: 50,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
