#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tracePath = path.join(root, 'runtime/codegen/traces/feature01_smoke.json');
const { AssertionRanker } = require(path.join(root, 'dist/src/core/assertions/AssertionRanker.js'));
const { AssertionEmitter } = require(path.join(root, 'dist/src/core/assertions/AssertionEmitter.js'));
const { TraceBuilder } = require(path.join(root, 'dist/src/core/codegen/TraceBuilder.js'));
const { DeterministicCodegenPipeline } = require(path.join(
  root,
  'dist/src/core/codegen/DeterministicCodegenPipeline.js'
));
const { PythonPlaywrightProfile } = require(path.join(
  root,
  'dist/src/core/codegen/profiles/PythonPlaywrightProfile.js'
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

const rawSteps = [
  {
    action: 'navigate',
    url: 'https://automationexercise.com/',
    description: 'Open home page',
  },
  {
    action: 'click',
    selector: "getByRole('link', { name: 'Products' })",
    url: 'https://automationexercise.com/',
    description: 'Open products page',
  },
  {
    action: 'navigate',
    url: 'https://automationexercise.com/products',
    description: 'Products page loaded',
  },
  {
    action: 'assert',
    selector: "getByRole('heading', { name: 'All Products' })",
    url: 'https://automationexercise.com/products',
    description: 'Verify products page',
  },
];

const trace = TraceBuilder.build({
  scenario: 'AutomationExercise smoke',
  scenarioSlug: 'feature01_smoke',
  steps: rawSteps,
  targetUrl: 'https://automationexercise.com/',
});

const navigateProducts = trace.steps.find((step) => step.url?.endsWith('/products') && step.action === 'navigate');
const verifyStep = trace.steps.find((step) => step.action === 'assert');
const urlAssertion = navigateProducts?.assertions?.find((assertion) => assertion.kind === 'url_contains');
const visibleAssertion = verifyStep?.assertions?.find((assertion) => assertion.kind === 'role_visible');

assert(!!urlAssertion, 'F04 URL change creates URL assertion');
assert(urlAssertion?.strength === 'medium', 'F04 URL assertion is medium strength', urlAssertion?.strength);
assert(!!visibleAssertion, 'F04 verify step creates role-visible assertion');
assert(visibleAssertion?.strength === 'strong', 'F04 role visible assertion is strong', visibleAssertion?.strength);

const summary = AssertionRanker.summarize(trace.steps);
assert(summary.total >= 2, 'F04 assertion summary counts generated assertions', String(summary.total));
assert(summary.strong >= 1, 'F04 assertion summary counts strong assertions', String(summary.strong));

const tsLines = AssertionEmitter.typeScriptPlaywright(visibleAssertion, 'page').join('\n');
assert(tsLines.includes('assertion(strong)'), 'F04 TypeScript emitter includes strength comment');
assert(tsLines.includes('toBeVisible()'), 'F04 TypeScript emitter emits Playwright expect');

const pyLines = AssertionEmitter.pythonPlaywright(visibleAssertion, 'page').join('\n');
assert(pyLines.includes('assertion(strong)'), 'F04 Python emitter includes strength comment');
assert(pyLines.includes('to_be_visible()'), 'F04 Python emitter emits Playwright expect');

const historyPath = path.join(root, 'runtime/reports/data/execution-history/feature01_smoke_execution_history.json');
fs.mkdirSync(path.dirname(historyPath), { recursive: true });
if (!fs.existsSync(historyPath)) {
  fs.writeFileSync(
    historyPath,
    JSON.stringify({ scenario: trace.scenario, testName: trace.scenario, executionHistory: rawSteps }, null, 2),
    'utf8'
  );
}

async function main() {
  const result = await DeterministicCodegenPipeline.runFromSlug('feature01_smoke', { validate: false });
  const spec = result.files.find((file) => file.path.endsWith('.spec.ts'));
  assert(spec?.content.includes('assertion(medium): URL contains'), 'F04 generated TS spec includes URL assertion');
  assert(spec?.content.includes('assertion(strong): role selector is visible'), 'F04 generated TS spec includes strong UI assertion');
  assert(result.metadata.assertionSummary?.strong >= 1, 'F04 metadata includes strong assertion summary');
  assert(Array.isArray(result.metadata.assertionSummary?.warnings), 'F04 metadata includes assertion warnings array');

  const pythonProfile = new PythonPlaywrightProfile();
  const pyPlan = {
    ...result.plan,
    profile: {
      language: 'python',
      automationTool: 'playwright',
      frameworkPattern: 'pom',
      testFramework: 'pytest',
    },
    specPath: 'tests/generated/test_feature01_smoke.py',
    pageObjects: [],
    files: [],
  };
  const pyFiles = pythonProfile.emit(trace, pyPlan);
  const pySpec = pyFiles.find((file) => file.path.endsWith('.py'));
  assert(pySpec?.content.includes('assertion(medium): URL contains'), 'F04 generated Python spec includes URL assertion');
  assert(pySpec?.content.includes('to_be_visible()'), 'F04 generated Python spec includes UI assertion');

  const summaryPath = path.join(root, 'runtime/reports/data/summaries/feature01_smoke_summary.json');
  if (fs.existsSync(summaryPath)) {
    const summaryJson = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    summaryJson.codegen = {
      ...(summaryJson.codegen || {}),
      assertionSummary: result.metadata.assertionSummary,
      specPath: result.plan.specPath,
      replayCommand: result.metadata.replayCommand,
      pageObjectPaths: result.metadata.pageObjectPaths,
      metadataPath: 'runtime/codegen/history/feature01_smoke.json',
      tracePath: result.metadata.sourceTrace,
      planPath: result.metadata.sourcePlan,
      mode: 'deterministic',
      generatedFiles: result.metadata.generatedFiles,
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summaryJson, null, 2), 'utf8');
    const { collectTestCaseReport } = require(path.join(root, 'dist/src/core/execution_report/collector.js'));
    const report = collectTestCaseReport('feature01_smoke');
    assert(report?.codegen?.assertionSummary?.strong >= 1, 'F04 report collector exposes assertion summary');
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n--- ${results.length - failed.length}/${results.length} checks passed ---`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
