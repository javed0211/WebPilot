#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
process.chdir(root);

process.env.TESTMU_USERNAME = 'webpilot-user';
process.env.TESTMU_ACCESS_KEY = 'webpilot-key';

const { BrowserProviderRegistry } = require(path.join(
  root,
  'dist/src/core/browserProviders/BrowserProviderRegistry.js'
));
const { collectSuiteReport } = require(path.join(
  root,
  'dist/src/core/execution_report/collector.js'
));

const results = [];
function pass(name, detail = '') {
  results.push({ ok: true, name });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ ok: false, name });
  console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
}
function assert(condition, name, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

const providers = BrowserProviderRegistry.availableProviders();
assert(providers.includes('local-playwright'), 'F06 registry lists local-playwright');
assert(providers.includes('browser-use'), 'F06 registry lists browser-use');
assert(providers.includes('testmu'), 'F06 registry lists testmu');

const local = BrowserProviderRegistry.resolve('local-playwright');
assert(local.name === 'local-playwright', 'F06 resolves local Playwright provider', local.config.browserName);
assert(local.sessionInfo().provider === 'local-playwright', 'F06 local session info includes provider');

const testmu = BrowserProviderRegistry.resolve('testmu');
assert(testmu.name === 'testmu', 'F06 resolves TestMu provider');
assert(testmu.config.username === 'webpilot-user', 'F06 TestMu username resolves from env');
assert(testmu.config.accessKey === 'webpilot-key', 'F06 TestMu access key resolves from env');
assert(
  testmu.doctor().some((check) => check.ok && /credentials/.test(check.label)),
  'F06 TestMu doctor passes with env credentials'
);

delete process.env.TESTMU_USERNAME;
delete process.env.TESTMU_ACCESS_KEY;
const missingTestMu = BrowserProviderRegistry.resolve('testmu');
assert(
  missingTestMu.doctor().some((check) => !check.ok && check.required && /credentials missing/.test(check.label)),
  'F06 TestMu doctor fails when credentials are missing'
);

try {
  BrowserProviderRegistry.resolve('unknown-cloud');
  fail('F06 unknown provider throws clear error');
} catch (error) {
  assert(
    /Unknown browser provider/.test(String(error.message)),
    'F06 unknown provider throws clear error',
    error.message
  );
}

const fixtureSlug = 'feature06_provider_fixture';
const summariesDir = path.join(root, 'runtime/reports/data/summaries');
fs.mkdirSync(summariesDir, { recursive: true });
fs.writeFileSync(
  path.join(summariesDir, `${fixtureSlug}_summary.json`),
  JSON.stringify(
    {
      test: fixtureSlug,
      testName: 'Feature 06 provider fixture',
      status: 'PASSED',
      timestamp: new Date().toISOString(),
      stepsExecuted: 1,
      summary: 'Provider metadata fixture',
      browser: {
        target: 'Chrome',
        headless: false,
        provider: {
          provider: 'testmu',
          browserName: 'Chrome',
          browserVersion: 'latest',
          platform: 'Windows 10',
        },
      },
    },
    null,
    2
  ),
  'utf8'
);

const report = collectSuiteReport({ testSlugs: [fixtureSlug], suiteName: 'Feature 06' });
assert(report.browser.provider?.provider === 'testmu', 'F06 reports include provider metadata');
assert(
  report.testCases[0]?.browserProvider?.platform === 'Windows 10',
  'F06 test case exposes provider platform'
);

const failed = results.filter((item) => !item.ok);
console.log(`\nFeature 06 checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
