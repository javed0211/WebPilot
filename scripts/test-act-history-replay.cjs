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
  assert.strictEqual(describeLocator(ranked[0]), "getByRole('link', { name: 'View history' })");
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

testParseAndRank();
testLoadStepsPrefersActHistory();
testLoadStepsFallsBackToExecutionHistory();
console.log('test-act-history-replay: ok');
