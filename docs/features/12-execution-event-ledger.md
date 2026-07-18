# 12. Execution Event Ledger & Evidence Foundation

## Goal

Give every WebPilot run a **schema-versioned, redacted, append-only event ledger** that later phases (semantic assertions, healing classification, grounded root-cause) can cite by event ID.

## User Problem

Signals today are scattered: ActHistory, summaries, screenshots, healing proposals, flake notes. Replay `stepResults` were returned in memory but not persisted. Network/console evidence was not captured as first-class events. Without a shared ledger, root-cause claims cannot be cited and healing cannot be validated against postconditions.

## Product Scope

This feature introduces:

- `ExecutionEvent` schema (version 1)
- `ExecutionEventLedger` (JSONL during run + finalized JSON bundle)
- `EvidenceRedactor` (secrets redacted at ingestion)
- `PlaywrightEventCollector` (network errors + console/page errors)
- Feature flags under `features:` / `evidence:` / `healing:` in `webpilot.yaml`
- Persistence of replay step results under `runtime/reports/data/events/`

Deferred (later phases):

- Full EvidenceBundle governance UI ([11](./11-evidence-first-reports.md))
- Citation-validated AI root-cause ([15](./15-grounded-root-cause.md))
- Transactional healing classification ([14](./14-healing-change-classification.md))

## Schemas

### ExecutionEvent

```json
{
  "schemaVersion": 1,
  "eventId": "slug-20260718T083012Z#00003",
  "runId": "slug-20260718T083012Z",
  "scenarioId": "slug",
  "stepIndex": 4,
  "sequence": 3,
  "timestamp": "2026-07-18T08:30:15.000Z",
  "elapsedMs": 3120,
  "source": "replay",
  "kind": "action",
  "phase": "execute",
  "outcome": "passed",
  "payload": { "action": "click", "locator": "…" }
}
```

### Artifacts

```text
runtime/reports/data/events/<slug>/
  <runId>.jsonl              # append-only during run
  <runId>_events.json        # finalized bundle
  <runId>_step-results.json  # replay step ledger
```

## Configuration

```yaml
features:
  eventLedger: true
evidence:
  captureNetwork: errors   # off | errors | metadata
  captureConsole: errors   # off | errors | all
```

Env overrides: `WEBPILOT_EVENT_LEDGER=0|1`.

## Implementation Status

- [x] Event types + ledger + redactor
- [x] Playwright network/console collector
- [x] Wire into ActHistory replay + BrowserManager + legacy Engine
- [x] Persist replay step results
- [x] Feature flags
- [x] Unit tests (`npm run test:event-ledger`)
- [ ] Browser-use Python event bridge
- [ ] API engine event bridge
- [ ] EvidenceBundle aggregation (feature 11)

## Critical Files

- `src/core/events/*`
- `src/core/lifecycle/FeatureFlags.ts`
- `src/core/BrowserManager.ts`
- `src/core/Engine.ts`
- `src/core/replay/ActHistoryPlaywrightRunner.ts`
- `src/core/replay/ActHistoryReplayService.ts`
- `resources/config/webpilot.yaml`

## Exit Criteria (Phase 1)

1. Replay with `features.eventLedger: true` writes `_events.json` and `_step-results.json`.
2. Secrets in URLs/headers/payloads are redacted before disk write.
3. Legacy Engine closes the browser in `finally` via `CleanupStack`.
4. Existing scenarios continue to run when the ledger is disabled.
