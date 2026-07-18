#!/usr/bin/env node
/**
 * Feature 14: healing change classification — classifier, commit policy, transaction.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const {
  HealingClassifier,
  HealingCommitPolicy,
  HealingPostActionValidator,
  HealingTransaction,
} = require(path.join(root, 'dist/src/core/healing/index.js'));
const { ExecutionEventLedger } = require(path.join(root, 'dist/src/core/events/index.js'));
const { HealingAgent } = require(path.join(root, 'dist/src/agents/HealingAgent.js'));

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

function baseFlags(over = {}) {
  return {
    eventLedger: true,
    fixtureLifecycle: false,
    semanticAssertions: false,
    healingClassification: 'off',
    groundedRootCause: false,
    captureNetwork: 'errors',
    captureConsole: 'errors',
    healingCommitPolicy: 'legacy',
    ...over,
  };
}

// Semantic similarity
const sim = HealingClassifier.estimateSemanticSimilarity(
  "getByRole('button', { name: 'Search' })",
  "getByRole('button', { name: 'Search hotels' })"
);
assert(sim > 0.3, 'F14 similar role/name selectors score > 0.3', String(sim));

// Refactor: action ok + postcondition ok + similar
const refactor = HealingClassifier.classify({
  candidateUnique: true,
  actionSucceeded: true,
  proposalConfidence: 0.9,
  brokenSelector: "getByRole('button', { name: 'Search' })",
  healedSelector: "getByRole('button', { name: 'Search' })",
  postconditionSucceeded: true,
  semanticSimilarity: 0.8,
});
assert(refactor.label === 'likely_intentional_refactor', 'F14 renamed control + postcondition → refactor', refactor.label);

// Regression: action ok but postcondition fails
const regression = HealingClassifier.classify({
  candidateUnique: true,
  actionSucceeded: true,
  proposalConfidence: 0.9,
  brokenSelector: "getByRole('button', { name: 'Pay' })",
  healedSelector: "getByRole('button', { name: 'Cancel' })",
  postconditionSucceeded: false,
  semanticSimilarity: 0.2,
});
assert(regression.label === 'possible_regression', 'F14 wrong control + failed postcondition → regression', regression.label);

// Regression: network failures after heal
const netReg = HealingClassifier.classify({
  candidateUnique: true,
  actionSucceeded: true,
  proposalConfidence: 0.9,
  brokenSelector: 'css=#submit',
  healedSelector: 'css=#submit-btn',
  postconditionSucceeded: null,
  networkFailures: 1,
  semanticSimilarity: 0.6,
});
assert(netReg.label === 'possible_regression', 'F14 network failure after heal → regression', netReg.label);

// Inconclusive: success but no postcondition
const inconclusive = HealingClassifier.classify({
  candidateUnique: true,
  actionSucceeded: true,
  proposalConfidence: 0.7,
  brokenSelector: 'css=#a',
  healedSelector: 'css=#b',
  postconditionSucceeded: null,
  assertionSucceeded: null,
  semanticSimilarity: 0.2,
});
assert(inconclusive.label === 'inconclusive', 'F14 no postcondition → inconclusive', inconclusive.label);

// Commit policy: enforce blocks non-refactor
const enforceBlock = HealingCommitPolicy.decide(inconclusive, baseFlags({ healingClassification: 'enforce' }), {
  actionSucceeded: true,
});
assert(!enforceBlock.commit && enforceBlock.state === 'quarantined', 'F14 enforce quarantines inconclusive');

const enforceAllow = HealingCommitPolicy.decide(refactor, baseFlags({ healingClassification: 'enforce' }), {
  actionSucceeded: true,
});
assert(enforceAllow.commit && enforceAllow.state === 'committed', 'F14 enforce commits refactor');

const postvalidatedReg = HealingCommitPolicy.decide(
  regression,
  baseFlags({ healingCommitPolicy: 'postvalidated', healingClassification: 'shadow' }),
  { actionSucceeded: true }
);
assert(!postvalidatedReg.commit, 'F14 postvalidated rejects regression');

const postvalidatedRefactor = HealingCommitPolicy.decide(
  refactor,
  baseFlags({ healingCommitPolicy: 'postvalidated' }),
  { actionSucceeded: true }
);
assert(postvalidatedRefactor.commit, 'F14 postvalidated commits refactor');

// Transaction end-to-end
const tmpCache = path.join(os.tmpdir(), `webpilot-heal-cache-${Date.now()}.json`);
const ledger = new ExecutionEventLedger({
  scenarioId: 'heal_tx_fixture',
  source: 'healing',
  persist: false,
});
const proposeEvt = ledger.append({
  kind: 'healing',
  phase: 'execute',
  outcome: 'info',
  payload: { event: 'heal.proposed' },
});

let cached = null;
const tx = new HealingTransaction(
  {
    brokenSelector: "getByRole('button', { name: 'Search' })",
    healedSelector: "getByRole('button', { name: 'Search' })",
    confidence: 0.92,
    reasoning: 'same control',
    url: 'https://example.com',
  },
  {
    flags: baseFlags({ healingClassification: 'enforce', healingCommitPolicy: 'postvalidated' }),
    ledger,
    proposeSequence: proposeEvt.sequence,
  }
);
tx.markCandidateVerified(true);
tx.markActionAttempted(true);
tx.markPostcondition(true);
const finalized = tx.finalize({
  saveToCache: (b, h) => {
    cached = { b, h };
    fs.writeFileSync(tmpCache, JSON.stringify({ [b]: h }), 'utf8');
  },
});
assert(finalized.committed === true, 'F14 transaction commits refactor under enforce');
assert(cached?.h.includes('Search'), 'F14 transaction wrote cache via callback');
assert(finalized.classification.label === 'likely_intentional_refactor', 'F14 transaction classification');

// Failed action → no commit
const txFail = new HealingTransaction(
  {
    brokenSelector: 'css=#x',
    healedSelector: 'css=#y',
    confidence: 0.9,
    reasoning: 'guess',
  },
  { flags: baseFlags({ healingClassification: 'enforce' }), ledger }
);
txFail.markCandidateVerified(true);
txFail.markActionAttempted(false, 'click timeout');
const failed = txFail.finalize({
  saveToCache: () => {
    throw new Error('should not commit');
  },
});
assert(!failed.committed && failed.classification.label === 'possible_regression', 'F14 failed action → regression, no commit');

// PostActionValidator counts ledger events
ledger.append({ kind: 'network', phase: 'execute', outcome: 'failed', payload: { status: 500 } });
const evidence = HealingPostActionValidator.collect({
  candidateUnique: true,
  actionSucceeded: true,
  proposalConfidence: 0.8,
  brokenSelector: 'a',
  healedSelector: 'b',
  ledger,
  afterSequence: proposeEvt.sequence,
});
assert(evidence.networkFailures >= 1, 'F14 validator counts network failures after propose');

// HealingAgent.propose does not write cache under postvalidated (via env)
const prevPolicy = process.env.WEBPILOT_HEALING_COMMIT_POLICY;
const prevClass = process.env.WEBPILOT_HEALING_CLASSIFICATION;
process.env.WEBPILOT_HEALING_COMMIT_POLICY = 'postvalidated';
process.env.WEBPILOT_HEALING_CLASSIFICATION = 'enforce';

const agentCache = path.join(os.tmpdir(), `webpilot-agent-cache-${Date.now()}.json`);
fs.writeFileSync(agentCache, '{}', 'utf8');
const agent = new HealingAgent(
  { complete: async () => ({ text: '{"healedSelector":"css=#ok","confidence":0.9,"reasoning":"x"}' }) },
  agentCache
);
Promise.resolve(agent.heal('css=#broken', { url: 'https://x', title: 't', elements: [], screenshotBase64: '' }, 'click'))
  .then((healResult) => {
    const cacheAfter = JSON.parse(fs.readFileSync(agentCache, 'utf8'));
    assert(healResult.cached !== true, 'F14 heal() under enforce+postvalidated does not eager-cache');
    assert(Object.keys(cacheAfter).length === 0, 'F14 cache file unchanged without commit');

    // Legacy still eager-caches
    process.env.WEBPILOT_HEALING_COMMIT_POLICY = 'legacy';
    process.env.WEBPILOT_HEALING_CLASSIFICATION = 'off';
    return agent.heal('css=#broken2', { url: 'https://x', title: 't', elements: [], screenshotBase64: '' }, 'click');
  })
  .then((legacyResult) => {
    const cacheLegacy = JSON.parse(fs.readFileSync(agentCache, 'utf8'));
    assert(legacyResult.cached === true, 'F14 legacy heal() still eager-caches');
    assert(cacheLegacy['css=#broken2'] === 'css=#ok', 'F14 legacy cache entry written');

    if (prevPolicy == null) delete process.env.WEBPILOT_HEALING_COMMIT_POLICY;
    else process.env.WEBPILOT_HEALING_COMMIT_POLICY = prevPolicy;
    if (prevClass == null) delete process.env.WEBPILOT_HEALING_CLASSIFICATION;
    else process.env.WEBPILOT_HEALING_CLASSIFICATION = prevClass;

    try {
      fs.unlinkSync(tmpCache);
      fs.unlinkSync(agentCache);
    } catch {
      /* ignore */
    }

    const failedChecks = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failedChecks.length}/${results.length} passed`);
    if (failedChecks.length) process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
