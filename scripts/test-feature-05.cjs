#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { FlakeClassifier } = require(path.join(root, 'dist/src/core/flake/FlakeClassifier.js'));
const { FailureSignalExtractor } = require(path.join(
  root,
  'dist/src/core/flake/FailureSignalExtractor.js'
));
const { FlakeRecommendation } = require(path.join(root, 'dist/src/core/flake/FlakeRecommendation.js'));
const { FlakeAnalyzer } = require(path.join(root, 'dist/src/core/flake/FlakeAnalyzer.js'));

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

function classifyError(message) {
  const signals = FailureSignalExtractor.extract({
    slug: 'fixture',
    status: 'FAILED',
    failureContext: message,
  });
  return FlakeClassifier.classify(signals, message);
}

const timeout = classifyError(
  'Timeout 30000ms exceeded.\nwaiting for locator("button") to be visible'
);
assert(timeout.category === 'wait', 'F05 timeout maps to wait category', timeout.category);

const strict = classifyError('Error: strict mode violation: locator resolved to 3 elements');
assert(strict.category === 'selector', 'F05 strict mode maps to selector category', strict.category);

const network = classifyError('request failed: ECONNRESET while fetching /api/products');
assert(network.category === 'network', 'F05 ECONNRESET maps to network category', network.category);

const modal = classifyError(
  'locator.click: <div class="cookie-banner"> intercepts pointer events'
);
assert(modal.category === 'modal', 'F05 click intercepted maps to modal category', modal.category);

const assertion = classifyError(
  'Error: expect(locator).toHaveText()\nExpected: "All Products"\nReceived: "Products"'
);
assert(assertion.category === 'assertion', 'F05 assertion mismatch maps to assertion', assertion.category);

const env = classifyError('browser-use agent failed: LLM connection error. Check Azure/OpenAI credentials.');
assert(env.category === 'environment', 'F05 browser-use LLM failure maps to environment', env.category);

const recommendation = FlakeRecommendation.build({
  category: 'selector',
  signals: [{ kind: 'selector_confidence', value: 0.3, source: 'webpilot' }],
});
assert(
  recommendation.includes('self-heal'),
  'F05 selector recommendation mentions self-heal',
  recommendation.slice(0, 80)
);

const analysis = FlakeAnalyzer.analyze({
  slug: 'feature05_fixture',
  status: 'FAILED',
  failureContext: 'Timeout 30000ms exceeded while waiting for getByRole("heading")',
  artifacts: {
    trace: 'traces/feature05.zip',
    screenshots: ['screenshots/fail.png'],
  },
});
assert(analysis?.category === 'wait', 'F05 analyzer returns wait analysis for timeout', analysis?.category);
assert(analysis?.recommendation.length > 20, 'F05 analyzer includes recommendation text');
assert(analysis?.evidence.length >= 2, 'F05 analyzer links trace and screenshot evidence', String(analysis?.evidence.length));

const summariesDir = path.join(root, 'runtime/reports/data/summaries');
fs.mkdirSync(summariesDir, { recursive: true });
const fixtureSlug = 'feature05_flake_fixture';
const fixtureSummary = {
  test: fixtureSlug,
  testName: 'Feature 05 flake fixture',
  status: 'FAILED',
  timestamp: new Date().toISOString(),
  stepsExecuted: 2,
  failureContext: 'strict mode violation: resolved to 2 elements',
};
fs.writeFileSync(
  path.join(summariesDir, `${fixtureSlug}_summary.json`),
  JSON.stringify(fixtureSummary, null, 2),
  'utf8'
);

const slugAnalysis = FlakeAnalyzer.analyzeSlug(fixtureSlug);
assert(slugAnalysis?.category === 'selector', 'F05 analyzeSlug reads summary failure context', slugAnalysis?.category);

const failed = results.filter((item) => !item.ok);
console.log(`\nFeature 05 checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  process.exit(1);
}
