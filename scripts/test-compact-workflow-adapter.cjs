#!/usr/bin/env node
/**
 * Compact workflow adapter preference + coverage gates.
 */
const path = require('path');
const root = path.resolve(__dirname, '..');
const { ActHistoryCodegenAdapter } = require(path.join(
  root,
  'dist/src/core/codegen/ActHistoryCodegenAdapter.js'
));
const {
  evaluateCompactCoverageGate,
  evaluateCompactVerifiedGate,
  compactWorkflowToActSteps,
} = require(path.join(root, 'dist/src/core/codegen/CompactWorkflow.js'));
const { ActHistoryPlaywrightRunner } = require(path.join(
  root,
  'dist/src/core/replay/ActHistoryPlaywrightRunner.js'
));

let failed = 0;
function assert(cond, name, detail = '') {
  if (cond) console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
  else {
    failed += 1;
    console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const noisyActHistory = [
  { index: 1, action: 'navigate', url: 'https://example.test/', value: 'https://example.test/' },
  { index: 2, action: 'search_page', description: '204 matches' },
  {
    index: 3,
    action: 'click',
    locators: [{ kind: 'role', value: 'button', name: 'NoiseOnly' }],
  },
];

const compactWorkflow = {
  schemaVersion: 1,
  source: 'browser-use-compact',
  steps: [
    {
      index: 1,
      action: 'navigate',
      url: 'https://example.test/',
      value: 'https://example.test/',
      locator: null,
      semanticLocators: [],
      selectorCandidates: [],
      verified: false,
    },
    {
      index: 2,
      action: 'click',
      locator: { kind: 'role', value: 'button', name: 'Continue', verified: true },
      semanticLocators: [{ kind: 'role', value: 'button', name: 'Continue' }],
      selectorCandidates: [{ kind: 'role', value: 'button', name: 'Continue' }],
      verified: true,
      verifiedBy: 'playwright',
      nlStep: 'Click Continue',
    },
  ],
  dropped: [{ index: 2, action: 'search_page', reason: 'drop agent-tool search_page' }],
  coverage: { nlTotal: 2, mapped: 2, unmapped: [] },
};

const adapted = ActHistoryCodegenAdapter.fromDocument(
  {
    testName: 'Digital',
    nlSteps: ['Navigate', 'Click Continue'],
    actHistory: noisyActHistory,
    compactWorkflow,
    assertionPlan: [],
  },
  'Digital'
);

assert(adapted.historySource === 'browser-use-compact', 'Adapter prefers compact source');
assert(
  adapted.steps.some((s) => JSON.stringify(s.locators || s.selector || '').includes('Continue')),
  'Adapter keeps Continue from compact'
);
assert(
  !adapted.steps.some((s) => JSON.stringify(s.locators || s.selector || '').includes('NoiseOnly')),
  'Adapter ignores noisy actHistory click when compact present'
);

const replaySteps = ActHistoryPlaywrightRunner.loadSteps({
  actHistory: noisyActHistory,
  compactWorkflow,
});
assert(replaySteps.length === 2, 'Replay loadSteps uses compact length', String(replaySteps.length));
assert(
  JSON.stringify(replaySteps[1].locators || []).includes('Continue'),
  'Replay uses compact Continue locator'
);

const gateOk = evaluateCompactCoverageGate(compactWorkflow, { codegen: true });
assert(gateOk.ok, 'Coverage gate passes when fully mapped');

const incomplete = {
  ...compactWorkflow,
  coverage: {
    nlTotal: 3,
    mapped: 2,
    unmapped: ['Click Backward until disabled'],
  },
};
const prev = process.env.WEBPILOT_COMPACT_COVERAGE_GATE;
delete process.env.WEBPILOT_COMPACT_COVERAGE_GATE;
const gateFail = evaluateCompactCoverageGate(incomplete, { codegen: true });
assert(!gateFail.ok, 'Coverage gate blocks unmapped NL by default');
process.env.WEBPILOT_COMPACT_COVERAGE_GATE = 'warn';
const gateWarn = evaluateCompactCoverageGate(incomplete, { codegen: true });
assert(gateWarn.ok, 'Coverage gate warn mode does not block');
if (prev === undefined) delete process.env.WEBPILOT_COMPACT_COVERAGE_GATE;
else process.env.WEBPILOT_COMPACT_COVERAGE_GATE = prev;

process.env.WEBPILOT_COMPACT_REQUIRE_VERIFIED = '1';
const unverifiedCompact = {
  ...compactWorkflow,
  steps: [
    {
      index: 1,
      action: 'click',
      locator: { kind: 'css', value: 'button' },
      semanticLocators: [],
      selectorCandidates: [],
      verified: false,
    },
  ],
};
const vGate = evaluateCompactVerifiedGate(unverifiedCompact);
assert(!vGate.ok, 'Verified gate blocks unverified interactive steps when enabled');
delete process.env.WEBPILOT_COMPACT_REQUIRE_VERIFIED;

const asActs = compactWorkflowToActSteps(compactWorkflow);
assert(asActs[1].locators[0].name === 'Continue', 'compactWorkflowToActSteps primary first');

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nCompact workflow adapter tests passed.');
