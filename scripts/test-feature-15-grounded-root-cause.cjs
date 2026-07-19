#!/usr/bin/env node
/**
 * Feature 15: grounded root-cause — CitationValidator + RootCauseAnalyzer.
 */
const path = require('path');

const root = path.resolve(__dirname, '..');
const { ExecutionEventLedger, createRunId } = require(path.join(
  root,
  'dist/src/core/events/index.js'
));
const { CitationValidator } = require(path.join(
  root,
  'dist/src/core/execution_report/CitationValidator.js'
));
const { RootCauseAnalyzer } = require(path.join(
  root,
  'dist/src/core/execution_report/RootCauseAnalyzer.js'
));
const { REDACTED } = require(path.join(root, 'dist/src/core/events/EvidenceRedactor.js'));

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

function buildCheckoutFailureBundle() {
  const ledger = new ExecutionEventLedger({
    scenarioId: 'checkout',
    runId: createRunId('checkout', new Date('2026-07-18T12:00:00Z')),
    source: 'replay',
    persist: false,
  });

  ledger.append({
    kind: 'action',
    phase: 'execute',
    outcome: 'passed',
    stepIndex: 1,
    payload: { action: 'click', selector: 'text=Place order' },
  });
  const net = ledger.append({
    kind: 'network',
    phase: 'execute',
    outcome: 'failed',
    stepIndex: 1,
    payload: {
      event: 'response',
      method: 'POST',
      url: 'https://shop.example/api/orders',
      status: 500,
      statusText: 'Internal Server Error',
    },
  });
  ledger.append({
    kind: 'assertion',
    phase: 'validate',
    outcome: 'failed',
    stepIndex: 2,
    payload: { message: 'Expected order confirmation, got error banner' },
  });

  return { bundle: ledger.finalize(), networkEventId: net.eventId };
}

// 1) Checkout failed because POST /orders returned 500 — cites network event
{
  const { bundle, networkEventId } = buildCheckoutFailureBundle();
  const rca = RootCauseAnalyzer.analyze({
    bundle,
    status: 'FAILED',
    failOnInvalidCitation: true,
  });
  assert(rca.status === 'grounded', 'F15 POST /orders 500 → grounded');
  assert(
    rca.findings.some(
      (f) =>
        f.claimType === 'network_error' &&
        f.causeEventIds.includes(networkEventId) &&
        /POST/.test(f.claim) &&
        /500/.test(f.claim)
    ),
    'F15 cites network event for POST 500',
    networkEventId
  );
}

// 2) Missing network capture → insufficient_evidence
{
  const ledger = new ExecutionEventLedger({
    scenarioId: 'checkout_no_net',
    runId: createRunId('checkout_no_net'),
    source: 'ui',
    persist: false,
  });
  ledger.append({
    kind: 'action',
    phase: 'execute',
    outcome: 'passed',
    payload: { action: 'click' },
  });
  const bundle = ledger.finalize();
  const rca = RootCauseAnalyzer.analyze({
    bundle,
    status: 'FAILED',
    failOnInvalidCitation: true,
  });
  assert(rca.status === 'insufficient_evidence', 'F15 missing causal events → insufficient_evidence');
  assert(
    Array.isArray(rca.missingEvidence) && rca.missingEvidence.includes('network_capture'),
    'F15 missingEvidence lists network_capture',
    String(rca.missingEvidence)
  );
}

// 3) No event bundle at all
{
  const rca = RootCauseAnalyzer.analyze({
    status: 'FAILED',
    scenarioId: 'missing_bundle',
  });
  assert(rca.status === 'insufficient_evidence', 'F15 no bundle → insufficient_evidence');
  assert(
    rca.missingEvidence?.includes('event_ledger_bundle'),
    'F15 missingEvidence lists event_ledger_bundle'
  );
}

// 4) CitationValidator rejects unknown event ID
{
  const { bundle } = buildCheckoutFailureBundle();
  const bad = {
    findingId: 'bad-1',
    claim: 'Invented failure',
    claimType: 'network_error',
    confidence: 0.9,
    causeEventIds: ['not-a-real-event'],
    supportingEventIds: [],
  };
  const v = CitationValidator.validate([bad], bundle, { failOnInvalidCitation: true });
  assert(v.accepted.length === 0, 'F15 unknown event ID rejected');
  assert(
    v.issues.some((i) => i.code === 'missing_event'),
    'F15 missing_event issue'
  );
}

// 5) Wrong run rejected
{
  const { bundle } = buildCheckoutFailureBundle();
  const foreignId = 'other-run#00001';
  const forged = {
    ...bundle.events[0],
    eventId: foreignId,
    runId: 'other-run',
  };
  const polluted = {
    ...bundle,
    events: [...bundle.events, forged],
  };
  // Simulate citing an event whose runId mismatches header by mutating lookup:
  // CitationValidator checks event.runId vs bundle.header.runId
  const bad = {
    findingId: 'bad-run',
    claim: 'Cross-run claim',
    claimType: 'action_failure',
    confidence: 0.5,
    causeEventIds: [foreignId],
    supportingEventIds: [],
  };
  const v = CitationValidator.validate([bad], polluted, { failOnInvalidCitation: true });
  assert(
    v.issues.some((i) => i.code === 'wrong_run'),
    'F15 wrong_run rejected',
    v.issues.map((i) => i.code).join(',')
  );
}

// 6) Unsupported kind
{
  const { bundle, networkEventId } = buildCheckoutFailureBundle();
  const bad = {
    findingId: 'bad-kind',
    claim: 'Network event cited as assertion',
    claimType: 'assertion_failure',
    confidence: 0.5,
    causeEventIds: [networkEventId],
    supportingEventIds: [],
  };
  const v = CitationValidator.validate([bad], bundle);
  assert(
    v.issues.some((i) => i.code === 'unsupported_kind'),
    'F15 unsupported_kind rejected'
  );
}

// 7) Temporal violation — cause after effect
{
  const ledger = new ExecutionEventLedger({
    scenarioId: 'temporal',
    runId: createRunId('temporal'),
    source: 'replay',
    persist: false,
  });
  const assertion = ledger.append({
    kind: 'assertion',
    phase: 'validate',
    outcome: 'failed',
    payload: { message: 'failed early' },
  });
  const lateNet = ledger.append({
    kind: 'network',
    phase: 'execute',
    outcome: 'failed',
    payload: { method: 'GET', url: '/late', status: 500 },
  });
  const bundle = ledger.finalize();
  const bad = {
    findingId: 'late-cause',
    claim: 'Late network caused earlier assertion',
    claimType: 'network_error',
    confidence: 0.5,
    causeEventIds: [lateNet.eventId],
    supportingEventIds: [],
  };
  const v = CitationValidator.validate([bad], bundle, {
    effectEventId: assertion.eventId,
  });
  assert(
    v.issues.some((i) => i.code === 'temporal_violation'),
    'F15 temporal_violation rejected'
  );
}

// 8) Redacted payload rejected
{
  const ledger = new ExecutionEventLedger({
    scenarioId: 'redacted',
    runId: createRunId('redacted'),
    source: 'replay',
    persist: false,
  });
  const net = ledger.append({
    kind: 'network',
    phase: 'execute',
    outcome: 'failed',
    payload: {
      method: REDACTED,
      url: REDACTED,
      status: REDACTED,
    },
  });
  const bundle = ledger.finalize();
  const bad = {
    findingId: 'redacted-1',
    claim: 'Something failed',
    claimType: 'network_error',
    confidence: 0.5,
    causeEventIds: [net.eventId],
    supportingEventIds: [],
  };
  const v = CitationValidator.validate([bad], bundle);
  assert(
    v.issues.some((i) => i.code === 'redacted_payload'),
    'F15 redacted_payload rejected'
  );
}

// 9) Invalid proposed LLM finding → dropped; deterministic still ships
{
  const { bundle, networkEventId } = buildCheckoutFailureBundle();
  const rca = RootCauseAnalyzer.analyze({
    bundle,
    status: 'FAILED',
    failOnInvalidCitation: true,
    proposedFindings: [
      {
        findingId: 'llm-hallucination',
        claim: 'Database was down',
        claimType: 'network_error',
        confidence: 0.99,
        causeEventIds: ['hallucinated-id'],
        supportingEventIds: [],
      },
    ],
  });
  assert(rca.status === 'grounded', 'F15 keeps deterministic findings when LLM invalid');
  assert(
    !rca.findings.some((f) => f.findingId === 'llm-hallucination'),
    'F15 does not ship invalid LLM finding'
  );
  assert(
    rca.findings.some((f) => f.causeEventIds.includes(networkEventId)),
    'F15 still cites real network event'
  );
}

// 10) Only invalid proposed → insufficient_evidence
{
  const ledger = new ExecutionEventLedger({
    scenarioId: 'llm_only',
    runId: createRunId('llm_only'),
    source: 'ui',
    persist: false,
  });
  ledger.append({
    kind: 'lifecycle',
    phase: 'execute',
    outcome: 'info',
    payload: { event: 'start' },
  });
  const bundle = ledger.finalize();
  const rca = RootCauseAnalyzer.analyze({
    bundle,
    status: 'FAILED',
    proposedFindings: [
      {
        findingId: 'llm-only',
        claim: 'Made up',
        claimType: 'generic',
        confidence: 1,
        causeEventIds: ['nope'],
        supportingEventIds: [],
      },
    ],
  });
  assert(rca.status === 'insufficient_evidence', 'F15 only-invalid LLM → insufficient_evidence');
  assert(rca.findings.length === 0, 'F15 no findings shipped without citations');
}

// 11) Markdown compatibility text
{
  const { bundle } = buildCheckoutFailureBundle();
  const rca = RootCauseAnalyzer.analyze({ bundle, status: 'FAILED' });
  const md = RootCauseAnalyzer.toMarkdown(rca);
  assert(/Root cause \(grounded\)/.test(md), 'F15 markdown includes status');
  assert(/Evidence:/.test(md), 'F15 markdown includes evidence lines');
}

// 12) Empty causes rejected
{
  const { bundle } = buildCheckoutFailureBundle();
  const v = CitationValidator.validate(
    [
      {
        findingId: 'empty',
        claim: 'No cites',
        claimType: 'generic',
        confidence: 0.1,
        causeEventIds: [],
        supportingEventIds: [],
      },
    ],
    bundle
  );
  assert(v.issues.some((i) => i.code === 'empty_causes'), 'F15 empty_causes rejected');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
