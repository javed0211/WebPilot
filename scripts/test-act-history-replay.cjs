/**
 * Unit tests for ActHistory Playwright replay helpers (no browser launch).
 * Run: npm run build && node scripts/test-act-history-replay.cjs
 */
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  parseLocatorsFromSelectorJson,
  rankLocators,
  describeLocator,
} = require(path.join(root, 'dist/src/core/replay/LocatorResolver.js'));
const {
  ActHistoryPlaywrightRunner,
} = require(path.join(root, 'dist/src/core/replay/ActHistoryPlaywrightRunner.js'));
const {
  extractAssertText,
  groundAssertStep,
} = require(path.join(root, 'dist/src/core/replay/AssertStepExecutor.js'));

function testParseAndRank() {
  const raw = JSON.stringify([
    { kind: 'css', value: 'a.foo' },
    { kind: 'role', value: 'link', name: 'View history' },
    { kind: 'text', value: 'View history' },
  ]);
  const locs = parseLocatorsFromSelectorJson(raw);
  assert.strictEqual(locs.length, 3);
  const ranked = rankLocators(locs);
  assert.strictEqual(ranked[0].kind, 'role');
  assert.strictEqual(describeLocator(ranked[0]), "getByRole('link', { name: 'View history', exact: true })");
}

function testLoadStepsPrefersActHistory() {
  const doc = {
    actHistory: [{ index: 1, action: 'navigate', value: 'https://example.com' }],
    executionHistory: [{ index: 1, action: 'click', selector: '[]' }],
  };
  const steps = ActHistoryPlaywrightRunner.loadSteps(doc);
  assert.strictEqual(steps.length, 1);
  assert.strictEqual(steps[0].action, 'navigate');
}

function testLoadStepsFallsBackToExecutionHistory() {
  const doc = {
    executionHistory: [
      { index: 1, action: 'click', locators: [{ kind: 'role', value: 'button', name: 'Search' }] },
    ],
  };
  const steps = ActHistoryPlaywrightRunner.loadSteps(doc);
  assert.strictEqual(steps.length, 1);
  assert.strictEqual(steps[0].action, 'click');
}

function testAssertGrounding() {
  assert.strictEqual(extractAssertText('Verify Installation is displayed'), 'Installation');
  assert.strictEqual(
    extractAssertText('Verify Playwright homepage loads successfully'),
    'Playwright homepage'
  );

  const urlNl = groundAssertStep(
    { index: 1, action: 'assert', description: 'Verify page URL contains intro' },
    []
  );
  assert.strictEqual(urlNl.kind, 'url_contains');
  assert.strictEqual(urlNl.fragment, 'intro');

  const urlValue = groundAssertStep(
    { index: 1, action: 'assert', value: '__url_contains__:docs' },
    []
  );
  assert.strictEqual(urlValue.kind, 'url_contains');
  assert.strictEqual(urlValue.fragment, 'docs');

  const loaded = groundAssertStep(
    {
      index: 1,
      action: 'assert',
      description: 'Verify Playwright homepage loads successfully',
      url: 'https://playwright.dev/',
    },
    []
  );
  assert.strictEqual(loaded.kind, 'url_equals');

  const text = groundAssertStep(
    { index: 1, action: 'assert', description: 'Verify Installation is displayed' },
    []
  );
  assert.strictEqual(text.kind, 'visible');
  assert.strictEqual(text.locators[0].kind, 'text');
  assert.strictEqual(text.locators[0].value, 'Installation');

  const ungrounded = groundAssertStep({ index: 1, action: 'assert', description: '' }, []);
  assert.strictEqual(ungrounded.kind, 'ungrounded');
}

testParseAndRank();
testLoadStepsPrefersActHistory();
testLoadStepsFallsBackToExecutionHistory();
testAssertGrounding();
console.log('test-act-history-replay: ok');
