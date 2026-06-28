#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tracePath = path.join(root, 'runtime/codegen/traces/feature01_smoke.json');
const { CodegenProfileRegistry } = require(path.join(
  root,
  'dist/src/core/codegen/profiles/CodegenProfileRegistry.js'
));

const results = [];
function pass(name, detail = '') {
  results.push({ ok: true, name, detail });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
}
function assert(condition, name, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

function inferPlan(trace, profile) {
  const adapter = CodegenProfileRegistry.resolve(profile);
  const className = 'AutomationexercisecomHomePage';
  const specPath = adapter.specPath(trace.scenarioSlug, profile);
  const pagePath = adapter.pagePath(className, profile, trace.targetUrl);
  const pageObjects =
    profile.frameworkPattern === 'simple'
      ? []
      : [
          {
            path: pagePath,
            operation: 'create',
            reason: 'Feature 03 profile verification page object',
            className,
            urlPattern: trace.targetUrl,
          },
        ];
  return {
    version: '1.0.0',
    scenarioSlug: trace.scenarioSlug,
    profile,
    specPath,
    files: [{ path: specPath, operation: 'create', reason: 'Feature 03 profile verification spec' }, ...pageObjects],
    pageObjects,
    notes: [],
    generatedAt: new Date().toISOString(),
  };
}

if (!fs.existsSync(tracePath)) {
  fail('Feature 03 trace fixture exists', tracePath);
  process.exit(1);
}

const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));

const cases = [
  {
    name: 'TypeScript Playwright POM',
    profile: {
      language: 'typescript',
      automationTool: 'playwright',
      frameworkPattern: 'pom',
      testFramework: 'playwright-test',
    },
    expectSpec: 'packages/test-framework/tests/feature01_smoke.spec.ts',
    contentChecks: ['@playwright/test'],
    replay: 'webpilot replay',
    validate: 'npm run build',
  },
  {
    name: 'Python Playwright POM',
    profile: {
      language: 'python',
      automationTool: 'playwright',
      frameworkPattern: 'pom',
      testFramework: 'pytest',
    },
    expectSpec: 'tests/generated/test_feature01_smoke.py',
    contentChecks: ['from playwright.sync_api import Page, expect', 'def test_feature01_smoke'],
    replay: 'pytest tests/generated/test_feature01_smoke.py',
    validate: 'python -m py_compile',
  },
  {
    name: 'Java Selenium POM',
    profile: {
      language: 'java',
      automationTool: 'selenium',
      frameworkPattern: 'pom',
      testFramework: 'junit',
    },
    expectSpec: 'src/test/java/webpilot/generated/Feature01SmokeTest.java',
    contentChecks: ['import org.openqa.selenium.WebDriver;', '@Test'],
    replay: 'mvn test',
    validate: 'mvn test',
  },
  {
    name: 'TypeScript Cypress simple',
    profile: {
      language: 'typescript',
      automationTool: 'cypress',
      frameworkPattern: 'simple',
      testFramework: 'cypress',
    },
    expectSpec: 'cypress/e2e/generated/feature01_smoke.cy.ts',
    contentChecks: ['describe(', 'cy.visit'],
    replay: 'npx cypress run --spec cypress/e2e/generated/feature01_smoke.cy.ts',
    validate: 'npx cypress run',
  },
];

for (const testCase of cases) {
  const adapter = CodegenProfileRegistry.resolve(testCase.profile);
  const plan = inferPlan(trace, testCase.profile);
  const files = adapter.emit(trace, plan);
  const spec = files.find((file) => file.path === testCase.expectSpec);
  assert(!!spec, `${testCase.name} emits expected spec path`, testCase.expectSpec);
  for (const needle of testCase.contentChecks) {
    assert(spec?.content.includes(needle), `${testCase.name} spec contains ${needle}`);
  }
  if (testCase.profile.frameworkPattern !== 'simple') {
    assert(files.some((file) => file.path !== spec?.path), `${testCase.name} emits page object`);
  }
  if (testCase.profile.language === 'typescript' && testCase.profile.automationTool === 'playwright') {
    assert(
      spec?.content.includes('getByRole') || spec?.content.includes('automationexercisecomHomePage'),
      `${testCase.name} spec uses strong selectors or page object methods`
    );
  }
  assert(adapter.replayCommand(plan.specPath).startsWith(testCase.replay), `${testCase.name} replay command`, adapter.replayCommand(plan.specPath));
  assert(
    (adapter.validationCommand(testCase.profile) || '').startsWith(testCase.validate),
    `${testCase.name} validation command`,
    adapter.validationCommand(testCase.profile) || ''
  );
}

assert(
  CodegenProfileRegistry.supportedProfileIds().includes('python-playwright-pom'),
  'Profile registry lists Python Playwright'
);
assert(
  CodegenProfileRegistry.supportedProfileIds().includes('java-selenium-pom'),
  'Profile registry lists Java Selenium'
);
assert(
  CodegenProfileRegistry.supportedProfileIds().includes('typescript-cypress-simple'),
  'Profile registry lists TypeScript Cypress'
);

const failed = results.filter((result) => !result.ok);
console.log(`\n--- ${results.length - failed.length}/${results.length} checks passed ---`);
process.exit(failed.length ? 1 : 0);
