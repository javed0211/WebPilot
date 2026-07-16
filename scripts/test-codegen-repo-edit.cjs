#!/usr/bin/env node
/**
 * Regression: ActHistory codegen filter + site-folder naming (no Www* invent).
 */
const path = require('path');
const root = path.resolve(__dirname, '..');

const {
  filterActHistoryForCodegen,
} = require(path.join(root, 'dist/src/core/codegen/ActHistoryCodegenFilter.js'));
const {
  inferSitePageFromUrl,
  isInventedFlatPageName,
  isInventedFlatPagePath,
  siteFolderFromHost,
} = require(path.join(root, 'dist/src/core/codegen/SitePageNaming.js'));
const { PlanBuilder } = require(path.join(root, 'dist/src/core/codegen/PlanBuilder.js'));
const {
  CodegenReferenceValidator,
} = require(path.join(root, 'dist/src/core/CodegenReferenceValidator.js'));

let failed = 0;
function assert(cond, name, detail = '') {
  if (cond) console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
  else {
    failed += 1;
    console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

function main() {
  const filtered = filterActHistoryForCodegen([
    { index: 1, action: 'navigate', selector: null, value: 'https://www.booking.com/', url: 'https://www.booking.com/', description: 'navigate' },
    { index: 2, action: 'search_page', selector: null, value: null, url: null, description: 'custom | Searched page for "Booking.com": 204 matches found.' },
    { index: 3, action: 'extract', selector: null, value: null, url: null, description: 'extract | cart' },
    { index: 4, action: 'click', selector: '[{"kind":"role","value":"button","name":"Accept"}]', value: null, url: 'https://www.booking.com/', description: 'click Accept' },
    { index: 5, action: 'wait', selector: null, value: '30', url: null, description: 'wait 30' },
    { index: 6, action: 'wait', selector: null, value: '2', url: null, description: 'wait 2' },
  ]);
  assert(filtered.dropped >= 3, 'Drops search_page/extract/long wait', `dropped=${filtered.dropped}`);
  assert(
    filtered.steps.every((s) => !['search_page', 'extract'].includes(s.action)),
    'Kept steps exclude agent tools'
  );
  assert(
    filtered.steps.some((s) => s.action === 'click'),
    'Keeps click'
  );
  assert(
    filtered.steps.some((s) => s.action === 'wait' && String(s.value) === '2'),
    'Keeps short wait'
  );

  const booking = inferSitePageFromUrl('https://www.booking.com/');
  assert(booking.siteFolder === 'booking', 'booking.com site folder', booking.siteFolder);
  assert(booking.className === 'BookingHomePage', 'BookingHomePage class', booking.className);
  assert(
    booking.pagePath === 'packages/test-framework/pages/booking/BookingHomePage.ts',
    'site-folder path',
    booking.pagePath
  );
  assert(!isInventedFlatPageName('BookingHomePage'), 'BookingHomePage not invented');
  assert(isInventedFlatPageName('WwwbookingcomHomePage'), 'Www* is invented');
  assert(
    isInventedFlatPagePath('packages/test-framework/pages/WwwbookingcomHomePage.ts'),
    'flat Www path invented'
  );
  assert(
    !isInventedFlatPagePath('packages/test-framework/pages/booking/BookingHomePage.ts'),
    'site path not invented'
  );
  assert(siteFolderFromHost('en.wikipedia.org') === 'wikipedia', 'wikipedia folder');

  const plan = PlanBuilder.build({
    version: '1.0.0',
    scenario: 'booking search',
    scenarioSlug: 'booking_search_hotels',
    steps: [
      {
        index: 1,
        action: 'navigate',
        description: 'go',
        url: 'https://www.booking.com/',
        intent: 'navigate',
      },
      {
        index: 2,
        action: 'click',
        description: 'accept',
        url: 'https://www.booking.com/',
        intent: 'click',
      },
    ],
    targetUrl: 'https://www.booking.com/',
    generatedAt: new Date().toISOString(),
  });
  const pagePaths = plan.pageObjects.map((p) => p.path).join(',');
  assert(
    plan.pageObjects.some((p) => p.path.includes('/pages/booking/')),
    'PlanBuilder uses site-folder pages',
    pagePaths
  );
  assert(
    !plan.pageObjects.some((p) => /Www/i.test(p.className || '')),
    'PlanBuilder does not invent Www* class names',
    plan.pageObjects.map((p) => p.className).join(',')
  );

  const bad = CodegenReferenceValidator.validate([
    {
      path: 'packages/test-framework/pages/WwwbookingcomHomePage.ts',
      content: 'export class WwwbookingcomHomePage {}',
    },
    {
      path: 'packages/test-framework/tests/x.spec.ts',
      content: `import { test } from '@playwright/test';
import { WwwbookingcomHomePage } from '../pages/WwwbookingcomHomePage';
test('t', async ({ page }) => {
  const p = new WwwbookingcomHomePage(page);
  await p.goto();
});`,
    },
  ]);
  assert(!bad.valid, 'Reference validator rejects Www* invent');
  assert(
    bad.issues.some((i) => i.code === 'invented_flat_page'),
    'Reports invented_flat_page',
    bad.issues.map((i) => i.code).join(',')
  );

  if (failed) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll ActHistory/site-folder codegen checks passed.');
}

main();
