# 14. Healing Change Classification

## Goal

Classify healed selector changes as:

- `likely_intentional_refactor`
- `possible_regression`
- `inconclusive`

and **never commit** trusted cache/inventory until the action and business postcondition succeed (under `postvalidated` / `enforce`).

## User Problem

Self-healing can cache a replacement as soon as a locator becomes clickable. A wrong but clickable control, or a UI that still navigates while the API returns 500, looks “healed” and hides regressions.

## Configuration

```yaml
features:
  healingClassification: shadow   # off | shadow | enforce

healing:
  commitPolicy: postvalidated     # legacy | postvalidated
```

Env overrides:

- `WEBPILOT_HEALING_CLASSIFICATION=off|shadow|enforce`
- `WEBPILOT_HEALING_COMMIT_POLICY=legacy|postvalidated`

| Mode | Behavior |
|------|----------|
| `legacy` + `off` | Propose may eager-write cache (compat) |
| `postvalidated` | Cache/inventory only after action + classification allows |
| `enforce` | Only `likely_intentional_refactor` may commit |
| `shadow` | Always classify + record; commit follows `commitPolicy` |

## Classification rules

| Label | Requirements |
|-------|----------------|
| likely_intentional_refactor | Unique candidate + action ok + postcondition/assertion ok + no network/console failures + semantic similarity |
| possible_regression | Action fails, postcondition/assertion fails, or network/console errors after heal |
| inconclusive | Action ok but no business proof (or weak similarity) |

## Flow

```text
HealingAgent.propose()  →  bind + verify visible
        →  perform action
        →  HealingTransaction.finalize()
              → classify
              → commit cache/inventory only if allowed
              → write .classification.json sidecar
```

## Implementation Status

- [x] Config flags + ledger healing events
- [x] Gate inventory upsert behind classification commit
- [x] `HealingTransaction` / `HealingClassifier` / `HealingCommitPolicy`
- [x] `HealingAgent.propose()` (no eager cache) + gated `heal()`
- [x] ActHistory replay wires propose → post-action finalize
- [x] `ActHealingRecord` extended with classification/state/committed
- [x] Tests: `npm run test:healing-classification`
- [ ] Wire semantic assertion postconditions into heal finalize automatically
- [ ] Report UI heal ledger section

## Critical Files

- `src/core/healing/*`
- `src/agents/HealingAgent.ts`
- `src/core/replay/ActHistoryPlaywrightRunner.ts`
- `src/core/replay/ActHistoryReplayService.ts`
- `src/core/replay/ActHistoryTypes.ts`

## Exit Criteria

1. Renamed control + preserved outcome → committed refactor — **covered by unit tests**
2. Clickable wrong control + failed business check → possible_regression, no cache write — **covered**
3. Missing postcondition → inconclusive, proposal only under postvalidated — **covered**
4. Legacy healing records load with `classification: inconclusive` — **default when absent**
