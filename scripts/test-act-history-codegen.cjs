/**
 * Unit tests for ActHistory → codegen adapter (no LLM / browser).
 * Run: npm run build && node scripts/test-act-history-codegen.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const {
  ActHistoryCodegenAdapter,
} = require(path.join(root, 'dist/src/core/codegen/ActHistoryCodegenAdapter.js'));
const { TraceBuilder } = require(path.join(root, 'dist/src/core/codegen/TraceBuilder.js'));

function testMergesActHistoryAndAssertionPlan() {
  const doc = {
    testName: 'wikipedia_complex_dom_verification',
    historySource: 'browser-use-act-history',
    nlSteps: [
      'Navigate to https://www.wikipedia.org/',
      'Verify Wikipedia homepage loads successfully',
      'Click Search',
    ],
    actHistory: [
      {
        index: 1,
        action: 'navigate',
        url: 'https://www.wikipedia.org/',
        value: 'https://www.wikipedia.org/',
        description: 'navigate',
        locators: [],
      },
      {
        index: 2,
        action: 'click',
        url: 'https://www.wikipedia.org/',
        description: 'click | Search',
        locators: [{ kind: 'role', value: 'button', name: 'Search' }],
        selector: JSON.stringify([{ kind: 'role', value: 'button', name: 'Search' }]),
      },
    ],
    assertionPlan: [
      { index: 2, kind: 'assert', nlStep: 'Verify Wikipedia homepage loads successfully' },
    ],
  };

  const source = ActHistoryCodegenAdapter.fromDocument(doc, 'wikipedia_complex_dom_verification');
  assert.strictEqual(source.historySource, 'browser-use-act-history');
  const actions = source.steps.map((s) => s.action);
  assert.deepStrictEqual(actions.slice(0, 2), ['navigate', 'click']);
  assert.ok(actions.includes('assert'));
  const assertStep = source.steps.find((s) => s.action === 'assert');
  assert.ok(String(assertStep.value).startsWith('__url_equals__:'));
}

function testTraceBuilderUsesLocators() {
  const trace = TraceBuilder.build({
    scenario: 'demo',
    scenarioSlug: 'demo',
    steps: [
      {
        index: 1,
        action: 'click',
        description: 'Click View history',
        locators: [{ kind: 'role', value: 'link', name: 'View history' }],
        url: 'https://en.wikipedia.org/wiki/Software_testing',
      },
    ],
  });
  assert.strictEqual(trace.steps[0].action, 'click');
  assert.ok(trace.steps[0].selector);
  assert.strictEqual(trace.steps[0].selector.kind, 'role');
  assert.ok(String(trace.steps[0].selector.expression || '').includes('getByRole'));
}

function testLoadFromSlug() {
  const dir = path.join(root, 'runtime', 'reports', 'data', 'execution-history');
  fs.mkdirSync(dir, { recursive: true });
  const slug = `phase3_adapter_${Date.now()}`;
  const file = path.join(dir, `${slug}_execution_history.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      testName: slug,
      historySource: 'browser-use-act-history',
      actHistory: [
        {
          index: 1,
          action: 'navigate',
          url: 'https://example.com/',
          value: 'https://example.com/',
          description: 'navigate',
        },
      ],
      assertionPlan: [],
    }),
    'utf8'
  );
  try {
    const loaded = ActHistoryCodegenAdapter.loadFromSlug(slug);
    assert.ok(loaded);
    assert.strictEqual(loaded.steps[0].action, 'navigate');
  } finally {
    fs.unlinkSync(file);
  }
}

testMergesActHistoryAndAssertionPlan();
testTraceBuilderUsesLocators();
testLoadFromSlug();
console.log('test-act-history-codegen: ok');
