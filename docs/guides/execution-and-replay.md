# Execution & Replay

WebPilot supports three distinct execution paths. Understanding when each is used is central to the SDET workflow.

---

## Overview

| Path | Command | LLM | Best for |
|------|---------|-----|----------|
| **Intelligent live run** | `webpilot run <file.txt> --provider browser-use` | Only for unknown/broken steps | Authoring, exploration, learning |
| **Knowledge-only replay** | `webpilot run <file.txt> --knowledge-only` | Never | Fast re-runs after learning |
| **Script replay (CI)** | `webpilot replay` or `npx playwright test` | Never | Regression, pipelines |

**Important:** `webpilot run` does **not** write a Playwright script first and then execute it. It reads your `.txt` steps and drives a live browser directly. Codegen is optional and runs **after** a successful execution when you pass `--codegen`.

---

## Intelligent live run (default)

```bash
webpilot run tests/web/booking_home_visibility_smoke.txt --env qa --provider browser-use
```

For each numbered step in the `.txt` file, WebPilot tries in order:

1. **Site knowledge** — replay a previously learned capability from `runtime/site-knowledge/knowledge.json`
2. **POM-aligned recipes** — deterministic actions using canonical selectors (e.g. Booking cookie accept, destination field)
3. **Browser-use discovery** — scoped LLM agent explores only that step, then learns the result

A single run can mix all three. Example output:

```text
[Knowledge] Step 1/4 deterministic: Navigate to https://www.booking.com/
[Knowledge] Step 2/4 deterministic: If a cookie consent dialog is visible...
[Knowledge] Step 3/4 deterministic: Verify the Booking.com logo...
[Knowledge] Step 4/4 recipe replay: Enter "London" in the destination field
```

On first encounter with a new step, you may see:

```text
[Discovery] Step 6/11 Browser Use: Open the date picker
```

After a successful discovery run, that step is stored and replays deterministically next time.

---

## Knowledge-only replay

```bash
webpilot run tests/web/booking_home_visibility_smoke.txt --knowledge-only
# equivalent:
WEBPILOT_KNOWLEDGE_ONLY=1 webpilot run tests/web/booking_home_visibility_smoke.txt
```

- Replays only from site knowledge and recipes
- **Fails** if a step has no validated capability (no browser-use fallback)
- **Zero LLM tokens** when all steps are known
- Ideal for fast local validation and proving reuse across test files

Cross-test reuse example: after running `booking_home_visibility_smoke.txt`, steps 1–3 of `booking_search_hotels.txt` reuse the same `www.booking.com` knowledge without re-learning.

---

## Force discovery (refresh knowledge)

```bash
webpilot run tests/web/foo.txt --force-discovery
# equivalent:
WEBPILOT_DISABLE_SITE_KNOWLEDGE=1 webpilot run tests/web/foo.txt
```

Skips knowledge replay and re-explores every step. Use when:

- The application UI changed significantly
- A learned capability is stale or wrong
- You want to refresh locators intentionally

---

## Script replay (CI / regression)

After codegen (or manual framework work), run generated tests without WebPilot or LLM. The command depends on your init profile:

```bash
# TypeScript Playwright
webpilot replay packages/test-framework/tests/booking_search_hotels.spec.ts
npx playwright test packages/test-framework/tests/booking_search_hotels.spec.ts

# Other profiles (also in runtime/codegen/history/<slug>.json)
pytest tests/generated/test_booking_search_hotels.py
mvn -q test -Dtest=BookingSearchHotelsTest
npx wdio run wdio.conf.ts --spec test/specs/generated/booking_search_hotels.spec.ts
dotnet test tests/WebPilot.Playwright.Tests/WebPilot.Playwright.Tests.csproj
```

This path:

- Uses committed page objects and specs for your framework
- Does not read `.txt` files
- Does not call browser-use or LLM
- Is the recommended CI execution mode for stable suites

See [Multi-Language Codegen](./multi-language-codegen.md).

---

## Optional codegen after run

```bash
webpilot run tests/web/checkout.txt --codegen --report
```

**Codegen runs only after a successful discovery.** Failed runs skip code generation and do not mark the job PASSED via reuse of a bad ActHistory.

After live execution succeeds:

1. Execution history is saved under `runtime/reports/data/execution-history/`
2. A trace and generation plan are written under `runtime/codegen/`
3. Spec and page object files are emitted to the active profile's output paths (see [Multi-Language Codegen](./multi-language-codegen.md))
4. HTML report is generated (with `--report`)

### Reusing ActHistory on re-runs

On a later `webpilot run <same.txt> --codegen`, WebPilot may skip the browser and reuse a **successful** ActHistory (0 rediscovery tokens). Failed histories are never reused.

```bash
webpilot history list                 # inspect
webpilot history clear checkout       # force rediscovery next time
webpilot run … --codegen --force-discovery   # one-off rediscovery
```

Full rules: [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md).

Codegen mode is controlled by `framework.codegenMode` in `webpilot.yaml`:

| Mode | Behavior |
|------|----------|
| `deterministic` (default) | No LLM for file generation |
| `llm` | LLM generates files via CodegenAgent |
| `auto` | Deterministic first, LLM fallback on validation failure |

You can also regenerate without re-running:

```bash
webpilot generate --from latest
```

---

## Provider selection

```bash
webpilot run tests/web/foo.txt --provider browser-use      # default, intelligent runner
webpilot run tests/web/foo.txt --provider local-playwright # legacy TS engine path
webpilot run tests/web/foo.txt --provider testmu           # remote TestMu/LambdaTest CDP
```

See [Browser Providers](./browser-providers.md) for details.

---

## Scenario file metadata

Steps in `.txt` files can enable features without extra CLI flags:

```text
@smoke @booking
target: web
baseUrl: https://www.booking.com
codegen: true
report: true

Test: Booking home smoke
1. Navigate to https://www.booking.com/
...
```

Metadata lines are parsed but **not executed** as test steps.

---

## Artifacts produced per run

| Artifact | Path |
|----------|------|
| Execution history | `runtime/reports/data/execution-history/<slug>_execution_history.json` |
| Summary | `runtime/reports/data/summaries/<slug>_summary.json` |
| LLM usage | `runtime/reports/data/llm-usage/<slug>_llm_usage.json` |
| Video | `runtime/reports/videos/<slug>.mp4` |
| Trace | `runtime/reports/traces/<slug>_trace.zip` |
| Site knowledge (updated) | `runtime/site-knowledge/knowledge.json` |

---

## When to use which path

| Situation | Recommended command |
|-----------|---------------------|
| SDET writing a new test | `webpilot run <file.txt>` |
| Re-run after successful learning | `webpilot run <file.txt> --knowledge-only` |
| Generate CI script | `webpilot run <file.txt> --codegen` |
| CI regression | `webpilot replay` or `npx playwright test` |
| UI changed, refresh locators | `webpilot run <file.txt> --force-discovery` |
| Clear bad / stale ActHistory | `webpilot history clear <slug>` or `--all` |

---

## See also

- [Intelligent Runner & Site Knowledge](./intelligent-runner-and-site-knowledge.md)
- [Deterministic Codegen](./deterministic-codegen.md)
- [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md)
- [Test Authoring](./test-authoring.md)
