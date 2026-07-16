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
