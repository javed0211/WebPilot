# 11. Evidence-First Reports for QA Governance

## Goal

Make every WebPilot test run produce **governance-grade evidence**, not just pass/fail.

A run should explain:

- what was attempted
- which page/control was targeted
- which locator was used
- whether the locator was verified
- what changed after the action
- what assertion proved success
- whether healing happened
- whether generated code was degraded
- how much token/cost was spent
- how risky the result is for a release gate

Audience is **QE leads and release managers**, not only automation engineers.

## User Problem

Current tools (and today’s WebPilot reports) often stop at:

```text
PASSED | FAILED
```

That is not enough for QA governance. Leads need to answer:

- Did this test actually exercise the intended control?
- Was the locator proven unique, or guessed?
- Did self-healing silently change behavior?
- Is the generated Playwright code review-safe or degraded?
- How much LLM spend did discovery/healing burn?
- Is this a real product failure, a flake, or weak evidence?
- Can we trust this green result in a release gate?

WebPilot already records most of the raw signals. The missing product layer is a **unified evidence bundle**, a **step timeline with outcomes**, and a **risk score** that surfaces those signals in reports QE leads can trust.

## Product Scope

This feature introduces:

- An immutable `EvidenceBundle` per run (schema-versioned, run-ID’d).
- A normalized per-step timeline with outcome, locator, verification, assertion, and media links.
- Report sections for:
  - step timeline
  - ActHistory provenance
  - locator verification status
  - page inventory / drift
  - heal records
  - screenshots / video / trace
  - codegen audit (quality / degradation)
  - LLM usage (tokens / cost / phases)
  - flake classification
  - run risk score + evidence completeness
- Completeness checks so “green but thin evidence” is visible.
- CI/export JSON that ADO, coverage, and release gates can consume.

Deferred:

- Full cryptographic chain-of-custody / signed evidence packs.
- Long-term statistical flake trending across months of CI (see [05](./05-flake-analyzer.md)).
- Live interactive evidence explorer beyond the existing React report shell.
- Bidirectional write-back of evidence into ADO/Jira work items (beyond current result publish).

## Evidence Model (What QE Leads Need)

| Question | Evidence signal | Primary source today |
|----------|-----------------|----------------------|
| What was attempted? | NL steps + ActHistory step descriptions | `execution-history/*_execution_history.json` |
| Which page/control? | URL, page title, element metadata | `ActStep`, page inventory |
| Which locator? | Ranked locators + selector used | `ActLocator`, selector registry |
| Was locator verified? | `verified`, `matchCount`, `verifiedBy` | locator verifiers + ActHistory |
| What changed after action? | URL sequence, page inventory fingerprint diff | partial — inventory exists, **diff missing** |
| What assertion proved success? | Assertion plan + assertion strength | assertion engine + `assertionPlan` |
| Did healing happen? | `ActHealingRecord[]` | `runLog.healing`, healing proposals |
| Was codegen degraded? | `CodegenAudit.quality` | `runtime/codegen/audit/<slug>.json` |
| Token/cost spent? | Usage phases | `_summary.json` + `llm-usage/` |
| Flake? | `flakeAnalysis` | flake analyzer in summary/HTML |
| Risk? | Composite score | **missing** |

## Current Foundation (Reuse, Don’t Rebuild)

### Already strong

| Area | Location | Notes |
|------|----------|-------|
| ActHistory + runLog | `src/core/replay/ActHistoryTypes.ts`, `act_history.py` | Replayable steps, locators, healing array |
| Locator verification | `locator_verifier.py`, `live_locator_verifier.py` | `verified` / `matchCount` / `verifiedBy` |
| Selector registry | `src/core/selectors/` | Confidence, signals, risks, success/fail counts |
| Healing proposals | `src/agents/HealingAgent.ts` | `runtime/selectors/healing-proposals/` |
| Page inventory | `page_inventory.py`, `PageInventory.ts` | Fingerprint + interactive elements |
| Screenshots / video / trace | `ReportPaths.ts`, `report_artifacts.py` | Linked in HTML today |
| Codegen audit | `CodegenAuditWriter.ts` | `good` / `degraded` + reasons |
| LLM usage | `UsageTracker.ts`, `UsagePersistence.ts` | Tokens, cost, phases |
| Flake analysis | `src/core/flake/` | Category + recommendation in HTML |
| HTML / React reports | `renderHtml.ts`, `resources/report-ui/` | Timeline, media, cost, flake |
| History snapshots | `execution_report/history.ts` | Per-run `runId` in history archive |

### Gaps this feature closes

1. **No unified evidence schema** — signals live in many files; reports pick a subset.
2. **No normalized per-step outcome/timing** — timeline is display-oriented (`ReportStep`), not governance-oriented.
3. **Healing / verification / codegen quality not first-class in HTML** — data on disk, weak presentation.
4. **Page inventory has no change history / drift record**.
5. **No run-level risk score or evidence completeness grade**.
6. **Replay step results are not persisted** as an immutable ledger.
7. **Artifact manifest omits** codegen audits, inventories, healing proposals, selector registry refs.
8. **`_summary.json` is loosely typed** across UI/API/replay paths — no `schemaVersion` / evidence ID.

## Proposed Artifacts

```text
runtime/reports/data/evidence/
  <slug>/
    <runId>_evidence.json          # EvidenceBundle (canonical)
    <runId>_step-timeline.json     # Normalized steps (optional extract)
runtime/reports/data/summaries/
  <slug>_summary.json              # Gains evidenceRef + risk + completeness
runtime/page-inventory/
  <origin>/<page>.json             # Current (unchanged)
  <origin>/<page>/history/         # NEW: prior fingerprints / diffs
    <timestamp>.json
```

Also index evidence paths in `runtime/reports/artifact-manifest.json`.

## EvidenceBundle Schema

```json
{
  "schemaVersion": 1,
  "runId": "booking_search_hotels-20260718T073012Z",
  "slug": "booking_search_hotels",
  "testFile": "tests/web/booking_search_hotels.txt",
  "status": "PASSED",
  "startedAt": "2026-07-18T07:30:12.000Z",
  "finishedAt": "2026-07-18T07:31:40.000Z",
  "durationMs": 88000,
  "executionMode": "intelligent-hybrid",
  "environment": { "name": "qa", "baseUrl": "https://..." },
  "browser": { "target": "chrome", "provider": "browser-use", "headless": true },

  "timeline": [
    {
      "index": 4,
      "nlStep": "Enter \"London\" in the destination field",
      "action": "input",
      "url": "https://www.booking.com/",
      "pageTitle": "Booking.com",
      "control": {
        "accessibleName": "Where are you going?",
        "tag": "input",
        "elementIndex": 12
      },
      "locator": {
        "kind": "role",
        "value": "textbox",
        "name": "Where are you going?",
        "used": "getByRole('textbox', { name: 'Where are you going?', exact: true })",
        "verified": true,
        "verifiedBy": "playwright",
        "matchCount": 1,
        "confidence": 0.99
      },
      "outcome": "PASSED",
      "startedAt": "2026-07-18T07:30:22.000Z",
      "durationMs": 410,
      "after": {
        "url": "https://www.booking.com/",
        "pageFingerprint": "a1b2…",
        "inventoryChanged": false
      },
      "assertion": null,
      "healed": false,
      "screenshotPath": null,
      "error": null
    }
  ],

  "assertions": {
    "planned": 3,
    "executed": 3,
    "strong": 2,
    "weak": 1,
    "items": []
  },

  "locators": {
    "total": 11,
    "verified": 9,
    "unverified": 2,
    "verifiedRatio": 0.82
  },

  "healing": {
    "count": 1,
    "records": [
      {
        "stepIndex": 7,
        "brokenSelector": "css=#old",
        "healedSelector": "role=button[name='Search']",
        "confidence": 0.78,
        "reasoning": "Primary CSS no longer unique; role+name unique",
        "proposalPath": "runtime/selectors/healing-proposals/….json",
        "at": "2026-07-18T07:30:55.000Z"
      }
    ]
  },

  "pageInventory": {
    "pagesTouched": ["www.booking.com/", "www.booking.com/searchresults…"],
    "drift": [
      {
        "pageKey": "www.booking.com/",
        "previousFingerprint": "…",
        "currentFingerprint": "…",
        "added": 2,
        "removed": 1,
        "changed": 0
      }
    ]
  },

  "codegen": {
    "mode": "deterministic",
    "auditPath": "runtime/codegen/audit/booking_search_hotels.json",
    "quality": "degraded",
    "qualityReasons": ["Raw Playwright fallback used on 2 steps"],
    "pomMappedStepRatio": 0.71,
    "rawFallbackUsed": true
  },

  "llmUsage": {
    "promptTokens": 12000,
    "completionTokens": 3000,
    "totalTokens": 15000,
    "estimatedCostUsd": 0.042,
    "llmCalls": 6,
    "phases": {
      "execution": { "llmCalls": 4, "estimatedCostUsd": 0.03 },
      "healing": { "llmCalls": 2, "estimatedCostUsd": 0.012 }
    }
  },

  "flake": {
    "category": null,
    "confidence": null,
    "likelyCause": null,
    "recommendation": null
  },

  "artifacts": {
    "executionHistory": "runtime/reports/data/execution-history/….json",
    "summary": "runtime/reports/data/summaries/….json",
    "video": "runtime/reports/videos/….webm",
    "trace": "runtime/reports/traces/….zip",
    "screenshots": [],
    "codegenAudit": "runtime/codegen/audit/….json"
  },

  "completeness": {
    "grade": "B",
    "score": 78,
    "missing": ["page-drift-history", "per-step-timestamps-partial"],
    "warnings": ["2 unverified locators", "codegen quality degraded"]
  },

  "risk": {
    "score": 42,
    "level": "medium",
    "factors": [
      { "id": "healing-used", "weight": 15, "detail": "1 healed step" },
      { "id": "codegen-degraded", "weight": 20, "detail": "raw fallback" },
      { "id": "unverified-locators", "weight": 7, "detail": "2/11 unverified" }
    ]
  }
}
```

## Risk Score

Deterministic, explainable, no LLM required at report time.

| Factor | Weight (max) | Trigger |
|--------|--------------|---------|
| Run failed | 40 | `status === FAILED` |
| Flake category high-confidence | 25 | flake confidence ≥ 0.7 |
| Healing used | 10–25 | +10 per healed step, cap 25 |
| Codegen degraded | 20 | `quality === degraded` |
| Unverified locator ratio | 0–20 | `(1 - verifiedRatio) * 20` |
| Weak assertions only | 15 | no strong assertion on success path |
| Missing critical artifacts | 10 | no trace/screenshot on failure |
| Page drift on interacted pages | 10 | fingerprint changed since last success |
| High LLM spend (discovery) | 5 | optional soft signal for review cost |

Levels:

| Score | Level | Suggested gate |
|-------|-------|----------------|
| 0–24 | low | Release-safe when green |
| 25–49 | medium | Review evidence before promoting |
| 50–74 | high | Block smoke/critical packs unless waived |
| 75–100 | critical | Do not treat as release evidence |

Risk is **orthogonal to pass/fail**: a green run with healing + degraded codegen can still be `medium`/`high`.

## Evidence Completeness Grade

| Grade | Meaning |
|-------|---------|
| A | Timeline + verified locators + media + assertions + usage present |
| B | Core timeline + most locators verified; minor gaps |
| C | Pass/fail + partial history; missing verification or media |
| D | Status only / thin history — not governance-grade |
| F | Incomplete or corrupt evidence pack |

Completeness must appear next to status in HTML and JSON so QE leads see “PASSED (completeness C)” instantly.

## Report UX (QE Lead View)

Add / upgrade sections in suite + per-test HTML (and React shell when rebuilt):

1. **Governance strip** — status · risk level · completeness · healed count · codegen quality · cost.
2. **Step timeline** — NL step, action, locator used, verified badge, outcome chip, duration, heal icon, screenshot thumb.
3. **Locator verification** — verified/unverified table with confidence and risks.
4. **Heal ledger** — broken → healed, confidence, proposal link.
5. **Page drift** — fingerprint changes for pages touched this run.
6. **Assertions** — planned vs executed, strength rating, which step proved success.
7. **Codegen audit** — quality badge, mapping ratio, fallback indexes, link to audit JSON.
8. **LLM usage** — phase breakdown (execution / healing / codegen / analysis).
9. **Flake** — existing card, linked into risk factors.
10. **Artifact index** — video / trace / screenshots / evidence JSON download.

CLI:

```bash
webpilot report --html
webpilot report --evidence                 # write/refresh EvidenceBundle from latest run
webpilot report --evidence --test <slug>
webpilot evidence show <slug> [--json]
webpilot evidence risk <slug>
```

## Configuration

```yaml
# resources/config/webpilot.yaml
evidence:
  enabled: true
  writeBundle: true
  risk:
    failWeight: 40
    healingPerStep: 10
    healingCap: 25
    codegenDegraded: 20
    unverifiedLocatorMax: 20
    weakAssertionOnly: 15
    missingFailureArtifacts: 10
    pageDrift: 10
  completeness:
    requireVerifiedLocatorRatio: 0.8
    requireTraceOnFailure: true
    requireAssertionOnPass: true
  pageInventoryHistory:
    enabled: true
    maxSnapshotsPerPage: 20
```

## Implementation Plan

### Phase 1: EvidenceBundle writer + summary hooks

Files:

- `src/core/evidence/types.ts` — `EvidenceBundle`, timeline step, risk, completeness.
- `src/core/evidence/EvidenceBundleBuilder.ts` — aggregate from summary, ActHistory, flake, usage, codegen audit, artifacts.
- `src/core/evidence/EvidencePaths.ts` — `runtime/reports/data/evidence/…`
- `src/core/evidence/RiskScorer.ts` — deterministic scoring.
- `src/core/evidence/CompletenessGrader.ts` — A–F grade.

Wire after run / replay / report collection:

- `ExecutionReportService.ts`
- `ActHistoryReplayService.ts` (persist replay `stepResults`)
- summary writers (UI + API)

Exit criteria:

- Every `webpilot run` / `webpilot replay` that writes a summary also writes `<runId>_evidence.json` when `evidence.enabled`.
- Summary gains `evidenceRef`, `risk`, `completeness`.
- Unit tests for risk + completeness with fixture histories.

### Phase 2: Normalized step timeline + heal / verify surfaces

- Extend `ReportStep` (or parallel `EvidenceStep`) with outcome, duration, verified, healed, assertion ref, screenshot.
- Persist replay `ActReplayStepResult[]` into the evidence bundle (do not only return to caller).
- HTML: governance strip + verified/heal badges on timeline.
- Artifact manifest includes evidence JSON + codegen audit + healing proposal refs.

Exit criteria:

- HTML timeline shows verified / healed / assertion badges.
- Heal ledger section renders when `healing.count > 0`.
- Locator verification summary visible for passed and failed runs.

### Phase 3: Page inventory history + drift

- On inventory write, archive previous fingerprint under `…/history/`.
- Diff added/removed/changed interactive controls.
- Attach drift records for pages in `urlSequence`.

Exit criteria:

- Evidence bundle includes `pageInventory.drift` when a prior snapshot exists.
- Report shows page drift section when non-empty.

### Phase 4: Codegen audit + LLM usage in governance strip

- Load `CodegenAudit` into evidence + summary.
- Surface `quality` / reasons / mapping ratio in HTML.
- Ensure healing/codegen phases are attributed correctly in usage.

Exit criteria:

- Degraded codegen cannot be silent: badge + reasons in report.
- LLM cost by phase visible without opening a separate file.

### Phase 5: Gate hooks for coverage / regression / ADO

- Feed risk + completeness into [09 Requirements Coverage](./09-requirements-coverage-regression.md) scoring penalties.
- Regression packs can exclude or downgrade high-risk greens.
- `webpilot ado publish-results` can attach evidence summary comment / link paths.
- CI: fail optional `--require-evidence-grade B` / `--max-risk medium`.

Exit criteria:

- `webpilot ci` / report JSON exposes risk + completeness for gates.
- Coverage scoring can penalize unverified/healed/degraded runs.

## Tests

Unit:

- RiskScorer matrix (pass+heal, fail+flake, degraded codegen, unverified locators).
- CompletenessGrader for A/B/C/D fixtures.
- EvidenceBundleBuilder from sample execution-history + audit + usage.

Integration:

- Run fixture scenario → evidence JSON exists with schemaVersion 1.
- Replay with healing → heal ledger non-empty and risk elevated.
- Codegen degraded fixture → quality reflected in evidence + HTML string.
- Manifest lists evidence path.

Contract:

- Stable JSON schema fixture under `tests/fixtures/evidence/`.
- Reject / warn on unknown schemaVersion when loading.

## Security and Privacy

Evidence packs may contain URLs, accessible names, and failure text. WebPilot must:

- Redact secrets / tokens from step values and errors (reuse existing redaction).
- Keep evidence under `runtime/` (gitignored).
- Never embed API keys or PATs in evidence JSON.
- Make optional fields that could include PII (extractions, memories) opt-in.

## Relationship to Other Features

| Feature | Relationship |
|---------|--------------|
| [01 Deterministic Pipeline](./01-deterministic-generated-test-pipeline.md) | Codegen audit quality feeds risk |
| [02 Selector Intelligence](./02-selector-intelligence-and-healing.md) | Verification + heal ledger |
| [04 Assertion Engine](./04-assertion-engine.md) | Assertion strength in timeline |
| [05 Flake Analyzer](./05-flake-analyzer.md) | Flake card + risk factor |
| [07 CI & Artifacts](./07-ci-mode-and-release-artifacts.md) | Manifest + gate flags |
| [09 Requirements Coverage](./09-requirements-coverage-regression.md) | Coverage penalties from weak evidence |
| [10 OpenAPI Full Suite](./10-api-openapi-full-suite.md) | API runs get thinner but schema-compatible evidence |

User guide (update as phases ship): [Reports & Evidence](../guides/reports-and-evidence.md).

## Exit Criteria (Feature Complete)

1. Every UI run writes a schema-versioned `EvidenceBundle` with runId.
2. Timeline answers: attempted step, page/control, locator, verified?, after-state, assertion, healed?, outcome.
3. HTML governance strip shows risk, completeness, heal count, codegen quality, cost.
4. Heal ledger and locator verification are visible without digging in `runtime/`.
5. Codegen `degraded` cannot be silent in reports.
6. LLM usage phases appear in the governance view.
7. Flake classification remains linked and contributes to risk.
8. Page drift appears when inventory history exists.
9. CI/consumers can read risk + completeness from summary/evidence JSON.
10. No secrets persisted in evidence packs.

## Implementation Status

**Feature 11 largely complete** — EvidenceBundle, risk/completeness, HTML + React-shell governance overlay, page drift history, CI gates, coverage/regression penalties, ADO evidence comments + attachments.

### Remaining roadmap

1. ✅ Phase 1 — EvidenceBundle + RiskScorer + CompletenessGrader.
2. ✅ Phase 2 — Timeline badges, heal ledger, locator verification in HTML.
3. ✅ Phase 3 — Page inventory history / drift.
4. ✅ Phase 4 — Governance overlay on React report-ui shell (source tree still absent; vanilla overlay paints heal/locator/drift).
5. ✅ Phase 5 — Coverage/regression evidence penalties + ADO publish comments/attachments.

### Tests

```bash
npm run test:evidence-bundle
```

### Enable

```yaml
evidence:
  enabled: true
  writeBundle: true
  pageInventoryHistory:
    enabled: true
    maxSnapshotsPerPage: 20
```

Env: `WEBPILOT_EVIDENCE_BUNDLE=0|1`

### CI gates

```bash
webpilot report --json --require-evidence-grade B --max-risk medium
webpilot ci run --require-evidence-grade B --max-risk medium
```

### Artifacts

```text
runtime/reports/data/evidence/<slug>/<runId>_evidence.json
runtime/page-inventory/<origin>/<pageKey>.json
runtime/page-inventory/<origin>/history/<pageKey>/<timestamp>.json
```

Summary gains `evidenceRef`, `risk`, `completeness`. Coverage evidence records `rawScore` / `governancePenalty` / `penaltyReasons`. ADO publish attaches EvidenceBundle JSON when present.
