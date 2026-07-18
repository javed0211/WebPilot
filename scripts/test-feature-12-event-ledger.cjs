#!/usr/bin/env node
/**
 * Feature foundation tests: execution event ledger, redaction, cleanup stack,
 * feature flags, and scenario fixture metadata.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const {
  ExecutionEventLedger,
  EvidenceRedactor,
  REDACTED,
  createRunId,
} = require(path.join(root, 'dist/src/core/events/index.js'));
const { CleanupStack } = require(path.join(root, 'dist/src/core/lifecycle/CleanupStack.js'));
const { resolveFeatureFlags } = require(path.join(root, 'dist/src/core/lifecycle/FeatureFlags.js'));
const { ScenarioMetadataParser } = require(path.join(
  root,
  'dist/src/core/authoring/ScenarioMetadata.js'
));
const { ConfigManager } = require(path.join(root, 'dist/src/core/ConfigManager.js'));
const { eventBundlePath } = require(path.join(root, 'dist/src/core/events/EventPaths.js'));

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

async function main() {
  // --- Redaction ---
  const redacted = EvidenceRedactor.redactStructured({
    authorization: 'Bearer secret-token-value',
    password: 'hunter2',
    url: 'https://example.com/api?token=abc123&q=ok',
    nested: { apiKey: 'sk-abcdefghijklmnopqrst', safe: 'visible' },
    body: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb',
  });
  assert(redacted.authorization === REDACTED, 'F12 redacts authorization field');
  assert(redacted.password === REDACTED, 'F12 redacts password field');
  assert(
    String(redacted.url).includes(REDACTED) && String(redacted.url).includes('q=ok'),
    'F12 redacts query secrets but keeps other params'
  );
  assert(redacted.nested.apiKey === REDACTED, 'F12 redacts nested apiKey');
  assert(redacted.nested.safe === 'visible', 'F12 preserves non-secret nested values');
  assert(String(redacted.body).includes(REDACTED), 'F12 redacts bearer/jwt patterns in strings');

  // --- Event ledger (in-memory) ---
  const ledger = new ExecutionEventLedger({
    scenarioId: 'ledger_fixture',
    source: 'replay',
    persist: false,
  });
  const started = ledger.appendLifecycle('replay.started', 'started');
  const action = ledger.appendAction({
    action: 'click',
    stepIndex: 1,
    outcome: 'passed',
    locator: "getByRole('button', { name: 'Search' })",
    url: 'https://example.com/?token=should-hide',
  });
  assert(started.sequence === 1, 'F12 first event sequence is 1');
  assert(action.sequence === 2, 'F12 sequences increment');
  assert(action.eventId.endsWith('#00002'), 'F12 eventId includes padded sequence');
  assert(String(action.payload.url).includes(REDACTED), 'F12 ledger redacts URLs on append');
  const bundle = ledger.finalize();
  assert(bundle.header.eventCount === 2, 'F12 finalize counts events', String(bundle.header.eventCount));
  assert(bundle.header.redacted === true, 'F12 bundle marked redacted');
  assert(bundle.header.schemaVersion === 1, 'F12 schemaVersion is 1');

  let threw = false;
  try {
    ledger.appendLifecycle('after-close');
  } catch {
    threw = true;
  }
  assert(threw, 'F12 append after finalize throws');

  // --- Persistent ledger ---
  // PROJECT_ROOT is resolved at module load, so persistence lands under the
  // real project runtime/. Write then delete the scenario dir.
  const persistent = new ExecutionEventLedger({
    scenarioId: 'persist_fixture',
    source: 'ui',
    persist: true,
  });
  persistent.appendAction({
    action: 'navigate',
    stepIndex: 0,
    outcome: 'passed',
    url: 'https://example.com',
  });
  const saved = persistent.finalize();
  const outPath = eventBundlePath('persist_fixture', saved.header.runId);
  assert(fs.existsSync(outPath), 'F12 persists event bundle JSON', outPath);
  const loaded = ExecutionEventLedger.loadBundle(outPath);
  assert(loaded.events.length === 1, 'F12 loaded bundle has events');
  assert(loaded.header.runId === saved.header.runId, 'F12 loaded runId matches');
  try {
    fs.rmSync(path.dirname(outPath), { recursive: true, force: true });
  } catch {
    // ignore
  }

  // --- Cleanup stack LIFO ---
  const order = [];
  const stack = new CleanupStack();
  stack.push('a', () => {
    order.push('a');
  });
  stack.push('b', async () => {
    order.push('b');
  });
  stack.push('c', () => {
    order.push('c');
  });
  const cleanupResults = await stack.drain();
  assert(order.join(',') === 'c,b,a', 'F12 cleanup drains LIFO', order.join(','));
  assert(cleanupResults.every((r) => r.ok), 'F12 cleanup entries succeed');
  const second = await stack.drain();
  assert(second.length === 0, 'F12 second drain is idempotent');

  const failOrder = [];
  const failStack = new CleanupStack();
  failStack.push('keep-going', () => {
    failOrder.push('keep-going');
  });
  failStack.push(
    'boom',
    () => {
      failOrder.push('boom');
      throw new Error('cleanup boom');
    },
    false
  );
  failStack.push('first', () => {
    failOrder.push('first');
  });
  let hardFail = false;
  try {
    await failStack.drain();
  } catch {
    hardFail = true;
  }
  assert(hardFail, 'F12 non-bestEffort cleanup throws');
  assert(
    failOrder.join(',') === 'first,boom,keep-going',
    'F12 continues draining after hard failure',
    failOrder.join(',')
  );

  // --- Feature flags ---
  const flags = resolveFeatureFlags(ConfigManager.getInstance());
  assert(typeof flags.eventLedger === 'boolean', 'F12 feature flags resolve eventLedger');
  assert(
    ['off', 'shadow', 'enforce'].includes(flags.healingClassification),
    'F12 healingClassification is a known mode'
  );
  assert(
    ['off', 'errors', 'metadata'].includes(flags.captureNetwork),
    'F12 captureNetwork is a known mode'
  );

  const prevHeal = process.env.WEBPILOT_HEALING_CLASSIFICATION;
  process.env.WEBPILOT_HEALING_CLASSIFICATION = 'shadow';
  const overridden = resolveFeatureFlags(ConfigManager.getInstance());
  assert(overridden.healingClassification === 'shadow', 'F12 env overrides healingClassification');
  if (prevHeal == null) delete process.env.WEBPILOT_HEALING_CLASSIFICATION;
  else process.env.WEBPILOT_HEALING_CLASSIFICATION = prevHeal;

  // --- Scenario fixture metadata ---
  const meta = ScenarioMetadataParser.parse(`
Test: Checkout
target: web
fixture: fixtures/checkout.yaml
@smoke

1. Navigate to /
`);
  assert(meta.fixture === 'fixtures/checkout.yaml', 'F12 parses fixture metadata');
  assert(meta.target === 'web', 'F12 still parses target');
  assert(meta.tags.includes('@smoke'), 'F12 still parses tags');
  assert(createRunId('demo').startsWith('demo-'), 'F12 createRunId prefixes scenario');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
