# Flake Analyzer

When a test fails inconsistently, WebPilot classifies **why** it failed and recommends **specific fixes** — in the terminal, JSON summaries, and HTML reports.

---

## Overview

Flaky tests erode trust in automation. The flake analyzer:

- Extracts signals from Playwright errors, browser-use failures, and execution context
- Classifies into categories (selector, wait, network, modal, etc.)
- Assigns confidence to the classification
- Suggests actionable fix text
- Surfaces a **Flake Analysis** card in HTML reports

---

## Flake categories

| Category | Typical cause | Example fix |
|----------|---------------|-------------|
| `selector` | Ambiguous or stale locator | Use `getByRole` with accessible name |
| `wait` | Element not ready in time | Add explicit wait for network idle or locator |
| `network` | Slow or failed API | Increase timeout; mock API in test |
| `modal` | Overlay intercepted click | Dismiss cookie/consent banner first |
| `environment` | Browser crash, remote session | Re-run; check provider credentials |
| `data` | Missing test account/fixture | Verify env vars and test data |
| `assertion` | Expected text changed | Update assertion or baseline |

---

## Signals collected

- Error message and stack trace
- Timeout location
- Selector confidence from registry
- Console errors and failed network requests
- Modal/cookie banner presence in page state
- Element detached / not actionable errors
- Playwright `error-context.md` when available
- Runtime insights from browser-use execution

---

## CLI usage

```bash
# Flake-focused analysis roll-up
webpilot analyze --flakes

# HTML report includes Flake Analysis card on failed runs
webpilot report --html

# Per-test report
webpilot report --html --test booking_search_hotels
```

---

## Summary JSON

Failed runs store analysis in `runtime/reports/data/summaries/<slug>_summary.json`:

```json
{
  "status": "FAILED",
  "flakeAnalysis": {
    "category": "modal",
    "confidence": 0.87,
    "likelyCause": "Cookie consent dialog intercepted the click",
    "recommendation": "Dismiss OneTrust banner before interacting with search form",
    "evidence": ["overlay visible", "click intercepted"]
  }
}
```

Run history snapshots also record `flakeCategory` for trend analysis (roadmap: statistical tracking across CI runs).

---

## Architecture

```text
Failure context
      ↓
FailureSignalExtractor  →  raw signals
      ↓
FlakeClassifier         →  category + confidence
      ↓
FlakeRecommendation   →  fix text
      ↓
FlakeAnalyzer           →  persist to summary + report
```

**Key files:**

- `src/core/flake/FlakeAnalyzer.ts`
- `src/core/flake/FlakeClassifier.ts`
- `src/core/flake/FailureSignalExtractor.ts`
- `src/core/flake/FlakeRecommendation.ts`

---

## Integration with other features

| Feature | Connection |
|---------|------------|
| Selector registry | Low confidence → selector category |
| Intelligent runner | Cookie dismissal reduces modal flakes |
| Self-heal | Selector failures may produce healing proposals |
| Reports | Flake card with evidence links to trace/video |

---

## Roadmap

| Planned | Status |
|---------|--------|
| Statistical flake rate across N CI runs | Not yet |
| ML-based classification | Not yet |
| Auto-create healing proposal from flake | Partial |

---

## See also

- [Selector Intelligence & Healing](./selector-intelligence-and-healing.md)
- [Reports & Evidence](./reports-and-evidence.md)
- [features/05-flake-analyzer.md](../features/05-flake-analyzer.md)
