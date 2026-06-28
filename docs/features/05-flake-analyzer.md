# 05. Flake Analyzer

## Goal

Identify why tests are flaky and recommend specific fixes.

## User Problem

Teams abandon automation tools when tests fail inconsistently. WebPilot should make flakiness understandable and fixable.

## Flake Signals

Collect:

- Retry count.
- Timeout location.
- Selector confidence.
- Network latency.
- Console errors.
- Failed requests.
- Modal/cookie banner interference.
- Page load timing.
- Element detached errors.
- Actionability failures.

## Flake Categories

| Category | Example |
|----------|---------|
| selector | selector matched multiple elements |
| wait | timeout before element visible |
| network | API took longer than expected |
| modal | cookie banner intercepted click |
| environment | browser crashed, remote session failed |
| data | test account or fixture missing |
| assertion | expected text changed |

## Product Scope

The flake analyzer supports:

- Playwright failure parsing.
- Browser-use failure parsing.
- Flake classification in reports.
- Suggested fix text.

Deferred for later:

- Statistical flake tracking across many CI runs.
- ML-based classification.

## Implementation Notes

Implemented in `src/core/flake/`:

- `FailureSignal.ts` — signal and analysis types.
- `FlakeClassifier.ts` — deterministic category rules for Playwright and browser-use errors.
- `FlakeRecommendation.ts` — category-specific fix guidance.
- `FailureSignalExtractor.ts` — parses failure context, Playwright `error-context.md`, selector registry, and runtime insights.
- `FlakeAnalyzer.ts` — orchestrates analysis and summary persistence.

Report integration:

- Failed runs get a **Flake Analysis** card in HTML reports.
- `runtime/reports/data/summaries/*_summary.json` stores `flakeAnalysis`.
- Run history snapshots include `flakeCategory`.

CLI:

```bash
webpilot analyze --flakes
webpilot report --html
```

Verification:

```bash
npm run build
node scripts/test-feature-05.cjs
```

## Exit Criteria

- Failed runs include a flake/failure category. **Done**
- Reports include evidence and recommended fix. **Done**
- Classifier has deterministic tests for top Playwright/browser-use failure modes. **Done**

## Original Spec

### Phase 1: Failure Model

Create:

- `src/core/flake/FailureSignal.ts`
- `src/core/flake/FlakeClassifier.ts`
- `src/core/flake/FlakeRecommendation.ts`

### Phase 2: Signal Extraction

Extract from:

- Playwright error message.
- Trace/video/screenshot availability.
- Runtime logs.
- Network logs.
- Selector registry.

### Phase 3: Report Integration

Add report sections:

- Failure category.
- Most likely cause.
- Fix recommendation.
- Evidence links.

### Phase 4: CLI Integration

```bash
webpilot analyze --flakes
webpilot report --html
```

## Tests

Unit tests:

- Timeout maps to wait category.
- Strict mode violation maps to selector category.
- `ECONNRESET` maps to network/environment.
- Click intercepted maps to modal/actionability.

Integration tests:

- Deliberately break a selector and confirm selector category.
- Add slow-loading element and confirm wait category.

## Exit Criteria

- Failed runs include a flake/failure category.
- Reports include evidence and recommended fix.
- Classifier has deterministic tests for top Playwright/browser-use failure modes.

