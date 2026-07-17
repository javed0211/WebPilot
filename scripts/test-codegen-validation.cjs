#!/usr/bin/env node
/**
 * Validates CodegenReferenceValidator + CodegenValidationBundle behavior.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const results = [];
function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
}
function assert(cond, name, detail) {
  if (cond) pass(name, detail);
  else fail(name, detail);
}
function assertThrows(fn, pattern, name) {
  try {
    fn();
    fail(name, 'did not throw');
  } catch (error) {
    assert(pattern.test(String(error && error.message || error)), name, String(error && error.message || error));
  }
}

function main() {
  const { CodegenReferenceValidator } = require(path.join(
    root,
    'dist/src/core/CodegenReferenceValidator.js'
  ));
  const { CodegenValidationBundle } = require(path.join(
    root,
    'dist/src/core/CodegenValidationBundle.js'
  ));
  const { CANONICAL_PAGE_CONTENT } = require(path.join(
    root,
    'dist/src/core/CodegenCanonicalPages.js'
  ));
  const { pageForStep } = require(path.join(
    root,
    'dist/src/core/codegen/PageMapping.js'
  ));
  const { DeterministicSpecWriter } = require(path.join(
    root,
    'dist/src/core/codegen/DeterministicSpecWriter.js'
  ));
  const { CodegenAuditWriter } = require(path.join(
    root,
    'dist/src/core/codegen/CodegenAuditWriter.js'
  ));
  const { enforceCodegenQuality } = require(path.join(
    root,
    'dist/src/core/codegen/CodegenQualityPolicy.js'
  ));
  const { TraceBuilder } = require(path.join(
    root,
    'dist/src/core/codegen/TraceBuilder.js'
  ));
  const { methodNameFromStep } = require(path.join(
    root,
    'dist/src/core/codegen/CodegenExpressions.js'
  ));

  const plannedPage = {
    path: 'packages/test-framework/pages/example/ExampleResultsPage.ts',
    operation: 'reuse',
    reason: 'test fixture',
    className: 'ExampleResultsPage',
    urlPattern: 'https://example.com/results',
  };
  const plan = {
    version: '1',
    scenarioSlug: 'page_context_audit',
    profile: {
      language: 'typescript',
      automationTool: 'playwright',
      frameworkPattern: 'pom',
    },
    specPath: 'packages/test-framework/tests/page_context_audit.spec.ts',
    files: [plannedPage],
    pageObjects: [plannedPage],
    notes: [],
    generatedAt: new Date().toISOString(),
  };
  const trace = {
    version: '1',
    scenario: 'page context audit',
    scenarioSlug: 'page_context_audit',
    generatedAt: new Date().toISOString(),
    steps: [
      {
        index: 1,
        intent: 'verify results heading',
        action: 'assert',
        description: 'Verify results heading',
        pageCandidate: 'https://example.com/results',
      },
      {
        index: 2,
        intent: 'capture results',
        action: 'screenshot',
        description: 'Capture results',
        pageCandidate: 'https://example.com/results',
      },
    ],
  };
  const pageArtifact = {
    path: plannedPage.path,
    className: plannedPage.className,
    content: '',
    operation: 'reuse',
    stepMethods: { 1: 'assertResultsHeading', 2: 'captureResults' },
  };

  assert(
    pageForStep(trace.steps[0], plan.pageObjects, trace) === plannedPage,
    'Uses pageCandidate when step.url is missing'
  );
  const generatedSpec = DeterministicSpecWriter.write(trace, plan, [pageArtifact]);
  assert(
    generatedSpec.content.includes('exampleResultsPage.assertResultsHeading()'),
    'Assertion without step.url maps to the correct POM'
  );
  const diagnostics = DeterministicSpecWriter.diagnosticsFor(plan);
  assert(
    diagnostics && diagnostics.rawFallbackUsed === false,
    'Does not use raw fallback when POM mappings are sufficient'
  );
  assert(
    diagnostics && diagnostics.mappedPomStepIndexes.length === 2,
    'Reports all emitted POM mappings',
    diagnostics ? diagnostics.mappedPomStepIndexes.join(', ') : 'missing diagnostics'
  );

  const nearbyTrace = {
    ...trace,
    steps: [
      {
        index: 1,
        intent: 'open results',
        action: 'navigate',
        description: 'Open results',
        url: 'https://example.com/results',
      },
      {
        index: 2,
        intent: 'verify result count',
        action: 'assert',
        description: 'Verify result count',
      },
    ],
  };
  assert(
    pageForStep(nearbyTrace.steps[1], plan.pageObjects, nearbyTrace) === plannedPage,
    'Uses nearest page URL context when assertion URL fields are empty'
  );

  const { bindParameterizedMethod, extractStepSubject } = require(path.join(
    root,
    'dist/src/core/codegen/ParameterizedMethodBinder.js'
  ));
  const sectionStep = {
    index: 1,
    action: 'assert',
    intent: 'assert See also section',
    description: 'Verify See also section',
    value: 'See also section',
  };
  const sectionBind = bindParameterizedMethod(sectionStep, [
    { name: 'assertSectionVisible', parameters: [{ name: 'section', type: 'string' }], returnType: 'Promise<void>' },
    { name: 'assertTextVisible', parameters: [{ name: 'text', type: 'string' }], returnType: 'Promise<void>' },
  ]);
  assert(
    sectionBind &&
      sectionBind.method === 'assertSectionVisible' &&
      sectionBind.args[0] === 'See also',
    'Parameterized binder maps section asserts to assertSectionVisible(arg)',
    sectionBind ? `${sectionBind.method}(${sectionBind.args.join(',')})` : 'null'
  );
  assert(
    extractStepSubject({
      index: 1,
      action: 'assert',
      intent: 'assert',
      description: 'Verify Categories is displayed',
      value: 'Categories',
    }) === 'Categories',
    'Extracts assert subject from NL verify text'
  );

  const emptyDiagnostics = {
    mappedPomStepIndexes: [],
    unmappedStepIndexes: [1, 2],
    rawFallbackUsed: true,
    rawFallbackStepIndexes: [1],
    omittedStepIndexes: [2],
  };
  const degraded = CodegenAuditWriter.build([], trace, plan, emptyDiagnostics);
  assert(degraded.quality === 'degraded', 'Empty POM mapping produces a degraded audit');
  assert(degraded.rawFallbackUsed === true, 'Audit reports explicit raw fallback use');
  assert(degraded.mappedPomSteps === 0 && degraded.unmappedSteps === 2, 'Audit reports mapped and unmapped totals');
  assert(
    degraded.qualityRawFallbackStepIndexes.length === 1 && degraded.qualityRawFallbackStepIndexes[0] === 1,
    'Audit excludes screenshot fallback from primary quality fallback metrics'
  );
  assertThrows(
    () => enforceCodegenQuality(degraded, { allowRawPageFallback: false, minPomMappedStepRatio: 0 }),
    /rejected raw page\.\* fallback/,
    'Hard-fail policy rejects quality-eligible raw fallback'
  );
  assertThrows(
    () => enforceCodegenQuality(degraded, { allowRawPageFallback: true, minPomMappedStepRatio: 0.5 }),
    /below configured minimum/,
    'Hard-fail policy enforces minimum POM mapping ratio'
  );

  const screenshotOnlyTrace = { ...trace, steps: [trace.steps[1]] };
  const screenshotOnlyAudit = CodegenAuditWriter.build([], screenshotOnlyTrace, plan, {
    mappedPomStepIndexes: [],
    unmappedStepIndexes: [2],
    rawFallbackUsed: true,
    rawFallbackStepIndexes: [2],
    omittedStepIndexes: [],
  });
  assert(
    screenshotOnlyAudit.quality === 'good' && screenshotOnlyAudit.pomMappedStepRatio === 1,
    'Screenshot-only fallback remains visible without degrading primary POM quality'
  );

  const semanticTrace = TraceBuilder.build({
    scenario: 'semantic naming',
    scenarioSlug: 'semantic_naming',
    steps: [{
      index: 1,
      action: 'click',
      description: 'click | Accept | Clicked button "Accept" id=onetrust-accept-btn-handler',
      locators: [{ kind: 'role', value: 'button', name: 'Accept' }],
      url: 'https://example.com/',
    }],
  });
  const semanticMethod = methodNameFromStep(semanticTrace.steps[0], new Set());
  assert(
    semanticMethod === 'clickAcceptButton',
    'Method naming prefers semantic target over browser-use outcome prose',
    semanticMethod
  );

  const resultsPage = {
    ...plannedPage,
    path: 'packages/test-framework/pages/example/ExampleDetailsPage.ts',
    className: 'ExampleDetailsPage',
    urlPattern: 'https://example.com/details',
  };
  const transitionTrace = {
    ...trace,
    steps: [
      { index: 1, intent: 'open results', action: 'navigate', description: 'open', url: 'https://example.com/results' },
      {
        index: 2,
        intent: 'open details',
        action: 'click',
        description: 'open details',
        urlBefore: 'https://example.com/results',
        url: 'https://example.com/details',
        urlAfter: 'https://example.com/details',
      },
      { index: 3, intent: 'verify details', action: 'assert', description: 'verify details' },
    ],
  };
  assert(
    pageForStep(transitionTrace.steps[2], [plannedPage, resultsPage], transitionTrace) === resultsPage,
    'Nearest context stops at navigation transition and maps assertion to destination POM'
  );

  const stubSpec = {
    path: 'packages/test-framework/tests/stub-only.spec.ts',
    content: `import { test } from '@playwright/test';
import { DemoPage } from '../pages/DemoPage';

test('stub only', async ({ page }) => {
  const demoPage = new DemoPage(page);
  await demoPage.goto();
});`,
  };

  const stubPage = {
    path: 'packages/test-framework/pages/DemoPage.ts',
    content: `import { BasePage } from '../core/BasePage';
import { Page } from '@playwright/test';

export class DemoPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }
}`,
  };

  const broken = CodegenReferenceValidator.validate([stubSpec, stubPage]);
  assert(!broken.valid, 'Rejects stub page object with missing methods');
  assert(
    broken.issues.some((issue) => issue.code === 'stub_page_object' || issue.code === 'missing_method'),
    'Reports stub/missing page object methods',
    broken.issues.map((issue) => issue.message).join(' | ')
  );

  const commentOnlySpec = {
    path: 'packages/test-framework/tests/comment-only.spec.ts',
    content: `import { test } from '@playwright/test';
test('comments only', async () => {
  // custom: Navigate to https://example.com/
});`,
  };
  const commentOnly = CodegenReferenceValidator.validate([commentOnlySpec]);
  assert(!commentOnly.valid, 'Rejects comment-only spec');
  assert(
    commentOnly.issues.some((issue) => issue.code === 'non_executable_spec'),
    'Reports non_executable_spec',
    commentOnly.issues.map((issue) => issue.code).join(', ')
  );

  // Canonical POM injection is opt-in (Phase 4). Exercise that path explicitly.
  process.env.WEBPILOT_CANONICAL_POMS = '1';
  const cartSpec = {
    path: 'packages/test-framework/tests/add-products-in-cart-automation-exercise.spec.ts',
    content: `import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '../pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '../pages/automationexercise/AutomationExerciseProductsPage';

test('cart', async ({ page }) => {
  const home = new AutomationExerciseHomePage(page);
  const products = new AutomationExerciseProductsPage(page);
  await home.goto();
  await home.goToProductsPage();
  await products.assertAllProductsPageLoaded();
  await products.addToCartProductAt(0);
});
`,
  };

  const bundle = CodegenValidationBundle.expand([cartSpec], {
    testSlug: 'add-products-in-cart-automation-exercise',
    urls: ['https://automationexercise.com/products'],
  });
  const canonicalCount = bundle.filter((file) =>
    file.path.includes('automationexercise/')
  ).length;
  assert(canonicalCount >= 4, 'Bundle includes canonical automationexercise POMs when opted in', String(canonicalCount));

  const ok = CodegenReferenceValidator.validate(bundle);
  assert(ok.valid, 'Cart spec + canonical POMs pass reference validation', ok.issues.map((i) => i.message).join(' | '));
  delete process.env.WEBPILOT_CANONICAL_POMS;

  const productsCanonical =
    CANONICAL_PAGE_CONTENT[
      'packages/test-framework/pages/automationexercise/AutomationExerciseProductsPage.ts'
    ];
  assert(
    productsCanonical.includes("waitUntil: 'domcontentloaded'") ||
      productsCanonical.includes('domcontentloaded'),
    'Canonical products page uses domcontentloaded navigation fallback'
  );
  assert(
    productsCanonical.includes('handleCartModal'),
    'Canonical products page defines handleCartModal'
  );

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
