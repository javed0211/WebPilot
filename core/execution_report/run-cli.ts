import { ConfigManager } from '../ConfigManager';
import { generateExecutionReports } from '../ExecutionReportService';

const args = process.argv.slice(2);
const skipAi =
  args.includes('--no-ai') ||
  !ConfigManager.getInstance().get('framework.htmlReportAiAnalysis', true);
const testIdx = args.indexOf('--test');
const testSlug = testIdx >= 0 ? args[testIdx + 1] : undefined;
const envIdx = args.indexOf('--env');
const env = envIdx >= 0 ? args[envIdx + 1] : 'qa';

generateExecutionReports({
  testSlugs: testSlug ? [testSlug] : undefined,
  env,
  skipAi,
  suiteName: testSlug ? `WebPilot — ${testSlug}` : 'WebPilot Execution Suite',
})
  .then((r) => {
    console.log('OK', r.suiteHtmlPath);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
