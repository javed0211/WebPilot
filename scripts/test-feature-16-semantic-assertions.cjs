#!/usr/bin/env node
/**
 * Feature 16: semantic assertion runtime — parser, coercion, evaluation, ledger, codegen.
 */
const path = require('path');

const root = path.resolve(__dirname, '..');
const {
  AssertionDslParser,
  parseExpression,
  ValueCoercion,
  ExpressionEvaluator,
  DomainCheckRegistry,
  SemanticAssertionRuntime,
  AssertionResultLedger,
  AssertionEmitter,
  LegacyAssertionAdapter,
} = require(path.join(root, 'dist/src/core/assertions/index.js'));
const { ExecutionEventLedger } = require(path.join(root, 'dist/src/core/events/index.js'));
const { AssertionRanker } = require(path.join(root, 'dist/src/core/assertions/AssertionRanker.js'));

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
  // Coercion
  assert(ValueCoercion.coerce('$1,234.50', 'currency') === 1234.5, 'F16 coerces currency string');
  assert(ValueCoercion.coerce('12%', 'percentage') === 0.12, 'F16 coerces percentage');
  assert(ValueCoercion.toCents(10.1) + ValueCoercion.toCents(0.2) === ValueCoercion.toCents(10.3), 'F16 money cents add');

  // Expression parse + evaluate
  const sumExpr = parseExpression('(subtotal + tax)');
  assert(sumExpr.kind === 'arithmetic', 'F16 parses arithmetic expression');
  const sum = await ExpressionEvaluator.evaluate(sumExpr, (name) =>
    name === 'subtotal' ? 10.1 : name === 'tax' ? 0.2 : undefined
  );
  assert(sum === 10.3, 'F16 evaluates money-safe addition', String(sum));

  assert(ExpressionEvaluator.compare('approximatelyEquals', 10.305, 10.3, { absoluteTolerance: 0.01 }), 'F16 approx equals');
  assert(!ExpressionEvaluator.compare('approximatelyEquals', 10.5, 10.3, { absoluteTolerance: 0.01 }), 'F16 approx rejects drift');

  // DSL parse
  const plan = AssertionDslParser.parseText(`
Extract subtotal as currency from [data-testid=subtotal]
Extract tax as currency from [data-testid=tax]
Extract total as currency from [data-testid=total]
Assert total approximatelyEquals (subtotal + tax) within 0.01
Assert domain money.total_equals_sum(total=total, parts=[subtotal, tax], tolerance=0.01)
Assert foo bar baz
`);
  assert(plan.extractions.length === 3, 'F16 parses three extractions', String(plan.extractions.length));
  assert(plan.assertions.length === 2, 'F16 parses two assertions', String(plan.assertions.length));
  assert(plan.rejected.length === 1, 'F16 rejects ambiguous Assert line', String(plan.rejected.length));
  assert(plan.extractions[0].source.kind === 'locatorText', 'F16 extraction source is locatorText');
  assert(plan.extractions[0].source.locator?.kind === 'testid', 'F16 parses data-testid locator');

  // Runtime with pre-seeded variables (no page)
  const ledgerEvents = new ExecutionEventLedger({
    scenarioId: 'semantic_fixture',
    source: 'assertion',
    persist: false,
  });
  const runtime = await SemanticAssertionRuntime.executePlan(
    {
      schemaVersion: 1,
      extractions: [],
      rejected: [],
      assertions: plan.assertions,
    },
    {
      context: {
        variables: { subtotal: 10.1, tax: 0.2, total: 10.3 },
      },
      eventLedger: ledgerEvents,
    }
  );
  assert(runtime.results.length === 2, 'F16 runtime executes two assertions');
  assert(runtime.results.every((r) => r.outcome === 'passed'), 'F16 cart total assertions pass');
  assert(runtime.results.every((r) => r.eventId), 'F16 assertion results get event IDs');
  const bundle = ledgerEvents.finalize();
  assert(bundle.events.some((e) => e.kind === 'assertion'), 'F16 ledger contains assertion events');

  // Domain checks list
  assert(
    DomainCheckRegistry.list().some((c) => c.id === 'money.total_equals_sum'),
    'F16 registers money.total_equals_sum'
  );

  // Failure path
  const failRuntime = await SemanticAssertionRuntime.executePlan(
    AssertionDslParser.parseText('Assert total approximatelyEquals (subtotal + tax) within 0.01'),
    {
      context: { variables: { subtotal: 10, tax: 1, total: 50 } },
    }
  );
  assert(failRuntime.results[0].outcome === 'failed', 'F16 mismatched total fails');

  // Extraction error when locator needed without page/var
  const missing = await SemanticAssertionRuntime.executePlan(
    AssertionDslParser.parseText('Extract total as currency from [data-testid=total]\nAssert total exists'),
    { context: { variables: {} } }
  );
  assert(
    missing.results.some((r) => r.outcome === 'extraction_error' || r.outcome === 'evaluation_error' || r.outcome === 'failed'),
    'F16 missing locator extract surfaces as error/fail',
    missing.results.map((r) => r.outcome).join(',')
  );

  // Ranker integration
  const step = {
    index: 1,
    intent: 'Assert total approximatelyEquals (subtotal + tax) within 0.01',
    action: 'assert',
    description: 'Assert total approximatelyEquals (subtotal + tax) within 0.01',
  };
  const candidates = AssertionRanker.candidatesForStep(step);
  assert(candidates[0]?.kind === 'semantic', 'F16 ranker returns semantic candidate');
  assert(step.semanticPlan?.assertions.length === 1, 'F16 ranker attaches semanticPlan');

  // Codegen
  const ts = AssertionEmitter.typeScriptPlaywright(candidates[0], 'page').join('\n');
  assert(ts.includes('semantic-assertion'), 'F16 TS emitter marks semantic assertions');
  assert(ts.includes('toBeLessThanOrEqual'), 'F16 TS emitter emits approx compare');

  // count_at_least fix
  const countLines = AssertionEmitter.typeScriptPlaywright(
    {
      kind: 'count_at_least',
      strength: 'medium',
      confidence: 0.7,
      description: 'at least 2',
      expected: 2,
      source: 'intent',
      signals: [],
      risks: [],
      selector: { kind: 'testid', value: 'row', confidence: 0.9 },
    },
    'page'
  ).join('\n');
  assert(countLines.includes('toBeGreaterThanOrEqual'), 'F16 count_at_least uses >= not exact count');

  // Legacy adapter
  const legacy = LegacyAssertionAdapter.toSemantic({
    kind: 'url_contains',
    strength: 'strong',
    confidence: 0.9,
    description: 'url has products',
    expected: 'products',
    source: 'intent',
    signals: [],
    risks: [],
  });
  assert(legacy.assert?.op === 'contains', 'F16 legacy adapter maps url_contains');

  // Result ledger summary
  const ledger = new AssertionResultLedger();
  ledger.record({ assertionId: 'a', outcome: 'passed', durationMs: 1 });
  ledger.record({ assertionId: 'b', outcome: 'failed', durationMs: 1 });
  const summary = ledger.summary();
  assert(summary.passed === 1 && summary.failed === 1, 'F16 ledger summary counts');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
