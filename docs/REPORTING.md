# WebPilot reporting guide

WebPilot produces execution reports at multiple levels: **terminal summaries**, **JSON artifacts**, **HTML dashboards** (with optional AI analysis), and **Markdown roll-ups**. This guide covers what is generated, when, where files live, and how to regenerate reports without re-running tests.

**Related docs:** [USAGE.md](./USAGE.md) · [CONFIGURATION.md](./CONFIGURATION.md) · [FRAMEWORK_GUIDE.md](./FRAMEWORK_GUIDE.md)

---

## Table of contents

1. [Overview](#1-overview)
2. [When reports are generated](#2-when-reports-are-generated)
3. [Output locations](#3-output-locations)
4. [CLI commands](#4-cli-commands)
5. [HTML reports](#5-html-reports)
6. [JSON report files](#6-json-report-files)
7. [Artifacts (video, trace, screenshots)](#7-artifacts-video-trace-screenshots)
8. [Configuration](#8-configuration)
9. [AI analysis in reports](#9-ai-analysis-in-reports)
10. [Markdown analysis report](#10-markdown-analysis-report)
11. [API test reporting](#11-api-test-reporting)
12. [Playwright & CI outputs](#12-playwright--ci-outputs)
13. [Regenerating reports](#13-regenerating-reports)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Overview

| Report type | Format | Primary use |
|-------------|--------|-------------|
| **Terminal dashboard** | CLI text | Quick pass/fail after one or more runs |
| **Per-test summary** | JSON | Machine-readable result + token/cost data |
| **Execution history** | JSON | Step-by-step agent/browser actions |
| **HTML suite report** | `reports/index.html` | Executive overview across all recent tests |
| **HTML per-test report** | `reports/<slug>-report.html` | Deep dive: NL steps, execution log, artifacts, AI analysis |
| **Markdown analysis** | `reports/execution_analysis_report.md` | Consolidated table for docs or PRs |
| **API run log** | JSON | Timestamped API pipeline results |

All paths under `reports/` are **gitignored** — generated locally on each run.

---

## 2. When reports are generated

### Web UI (browser-use path — default)

After a successful or failed browser-use run (`framework.useBrowserUse: true`):

1. Python runner writes `reports/<test>_summary.json` and `reports/<test>_execution_history.json`.
2. Videos, traces, and step screenshots are finalized under `reports/`.
3. `reports/<test>_llm_usage.json` is written with token/cost totals.
4. **HTML reports are generated automatically** via `core/execution_report/run-cli.ts` (suite + per-test pages).

### Web UI (legacy TypeScript engine)

When `framework.useBrowserUse: false`, the legacy engine in `core/Engine.ts`:

1. Writes `reports/<test>_summary.json` after codegen.
2. Calls `generateExecutionReports()` to produce HTML (with AI analysis unless disabled).

### CLI `run --report`

After a batch run completes, passing `--report` regenerates HTML from existing JSON:

```bash
npm run webpilot -- run tests/web --env qa --report
```

### API tests

`core/ApiEngine.ts` writes a timestamped JSON file per run:

```
reports/api-<test-name>-<timestamp>.json
```

API runs do **not** currently produce HTML suite reports or `_summary.json` in the same format as UI tests.

---

## 3. Output locations

```
reports/
├── index.html                              # Suite dashboard (all tests with _summary.json)
├── <test-slug>-report.html                 # Per-test detailed HTML report
├── <test-slug>_summary.json                # Core result + pricing + codegen notes
├── <test-slug>_execution_history.json      # NL steps + agent execution log
├── <test-slug>_llm_usage.json              # Token and cost snapshot
├── execution_analysis_report.md            # From `webpilot analyze`
├── api-<name>-<timestamp>.json             # API run results
├── junit-results.xml                       # From Playwright test project runs
├── videos/
│   └── <test-slug>.mp4                     # Browser recording (when video enabled)
├── traces/
│   └── <test-slug>_trace.zip               # Playwright trace (when trace enabled)
├── screenshots/
│   └── <test-slug>/
│       └── step_<n>.png                    # Per-step captures
└── assets/
    └── webpilot-logo.png                   # Copied for HTML report branding
```

**Test slug** = basename of the NL file without extension (e.g. `automationexercise_add_to_cart` from `tests/web/automationexercise_add_to_cart.txt`).

---

## 4. CLI commands

### Terminal summary (no HTML)

```bash
npm run report
# or
npm run webpilot -- report
```

Prints the **Executive Quality Dashboard**: recent executions, pass/fail counts, success rate.

### HTML suite + per-test reports

```bash
npm run webpilot -- report --html
npm run report:html
```

| Option | Description |
|--------|-------------|
| `--html` | Generate `reports/index.html` and `reports/<slug>-report.html` |
| `--no-ai` | Skip LLM quality analysis sections |
| `--test <slug>` | Limit to one test (e.g. `automationexercise_add_to_cart`) |
| `-e, --env <env>` | Environment label in report header (default: `qa`) |

Examples:

```bash
npm run webpilot -- report --html --no-ai
npm run webpilot -- report --html --test automationexercise_add_to_cart --env qa
```

### Markdown analysis report

```bash
npm run webpilot -- analyze
```

Writes `reports/execution_analysis_report.md` — executive summary table, token/cost totals, and embedded AI analysis excerpts from `_summary.json` files.

### Generate HTML after a run

```bash
npm run webpilot -- run tests/web/login.txt --env qa --report
```

Runs the test(s), then invokes the HTML report generator.

---

## 5. HTML reports

### Suite report (`reports/index.html`)

Aggregates every test that has a `reports/<slug>_summary.json` file.

**Includes:**

- Pass rate, total steps, total LLM cost, total tokens
- Environment (`dev` / `qa` / `prod`) and browser config
- Framework metadata (WebPilot version, active LLM provider, browser-use flag)
- Links to each per-test report
- Optional **suite-level AI analysis** when multiple tests are present

### Per-test report (`reports/<slug>-report.html`)

**Includes:**

| Section | Contents |
|---------|----------|
| **Overview** | Status, timestamp, steps executed, test file path |
| **NL steps** | Original natural-language steps from the `.txt` spec |
| **Execution log** | Agent actions (navigate, click, input, assert) from execution history |
| **URL sequence** | Pages visited during the run |
| **Runtime insights** | Warnings or notes captured during execution |
| **Codegen summary** | What Playwright files were created or updated |
| **Artifacts** | Links to video, trace zip, step screenshots |
| **LLM pricing** | Prompt/completion tokens, calls, estimated USD cost, model/provider |
| **AI analysis** | LLM-generated quality review (locator stability, flakiness, coverage vs intent) |

Open in any browser:

```bash
open reports/index.html
open reports/automationexercise_add_to_cart-report.html
```

---

## 6. JSON report files

### `reports/<slug>_summary.json`

Primary record for HTML report collection. Example fields:

| Field | Description |
|-------|-------------|
| `test` | Test slug |
| `testName` | Human-readable title from `Test:` line |
| `testFile` | Path to NL spec |
| `environment` | Target env name |
| `status` | `PASSED` or `FAILED` |
| `timestamp` | ISO datetime |
| `stepsExecuted` | Number of agent/execution steps |
| `summary` | Codegen outcome (string or array of strings) |
| `tokens`, `promptTokens`, `completionTokens` | LLM usage |
| `estimatedCostUsd`, `llmCalls` | Cost and call count |
| `executionHistoryPath` | Path to full history JSON |
| `artifacts` | `{ video, trace, screenshots[] }` |
| `aiAnalysis` | Markdown AI review (after HTML generation with AI enabled) |
| `browser` | Browser target, headless, viewport, recording flags |

### `reports/<slug>_execution_history.json`

| Field | Description |
|-------|-------------|
| `nlSteps` | Parsed natural-language steps |
| `executionHistory` | Array of `{ index, action, selector, value, url, description }` |
| `urlSequence` | Ordered list of URLs visited |
| `runtimeInsights` | Structured insights from the agent run |
| `isSuccessful`, `isDone` | Agent completion flags |

Used by HTML reports and codegen; also input for demo/replay tooling.

### `reports/<slug>_llm_usage.json`

Standalone token/cost snapshot:

```json
{
  "promptTokens": 166671,
  "completionTokens": 5431,
  "estimatedCostUsd": 0.28975,
  "llmCalls": 13
}
```

---

## 7. Artifacts (video, trace, screenshots)

Controlled by `config/webpilot.yaml` → `browser` section:

```yaml
browser:
  video: on                    # on | off | retain-on-failure
  trace: on                    # on | off | retain-on-failure
  screenshots: only-on-failure # off | on | only-on-failure
```

| Artifact | Typical path | View |
|----------|--------------|------|
| **Video** | `reports/videos/<slug>.mp4` | Linked from HTML report or open directly |
| **Trace** | `reports/traces/<slug>_trace.zip` | `npx playwright show-trace reports/traces/<slug>_trace.zip` |
| **Screenshots** | `reports/screenshots/<slug>/step_*.png` | Linked in per-test HTML report |

Artifacts are attached to `_summary.json` under the `artifacts` key after the run finalizes.

---

## 8. Configuration

In `config/webpilot.yaml`:

```yaml
framework:
  reportsPath: "./reports"
  htmlReportAiAnalysis: true   # LLM quality section in HTML reports (default: on)

browser:
  video: on
  trace: on
  screenshots: only-on-failure # off | on | only-on-failure
```

| Setting | Effect |
|---------|--------|
| `framework.reportsPath` | Base directory for all report output |
| `framework.htmlReportAiAnalysis` | When `true`, HTML generation includes AI analysis (disable with `--no-ai`) |
| `browser.video` / `trace` / `screenshots` | Which artifacts are captured during UI runs |

Environment URLs shown in reports come from `config/environments/<env>.json`.

---

## 9. AI analysis in reports

When AI analysis is enabled (default), `ExecutionReportService`:

1. Loads each test’s execution data (NL steps, log sample, codegen summary, pricing).
2. Calls the configured LLM with prompts from `prompts/reports/`:
   - `ai-analysis-system.md`
   - `ai-analysis-user.md` (per test)
   - `ai-analysis-suite-user.md` (suite overview)
3. Renders the response in the HTML **AI Analysis** section.
4. Persists analysis back into `_summary.json` as `aiAnalysis`.

**Disable AI analysis** (faster, no extra LLM cost):

```bash
npm run webpilot -- report --html --no-ai
```

Or set `framework.htmlReportAiAnalysis: false` in `config/webpilot.yaml`.

AI analysis covers topics such as:

- Coverage vs NL test intent
- Locator stability and strict-mode risks
- Flakiness signals (modals, timing, cookies)
- Codegen/POM alignment with live execution
- Cost efficiency (tokens vs value)

---

## 10. Markdown analysis report

```bash
npm run webpilot -- analyze
```

Produces `reports/execution_analysis_report.md` containing:

- Executive summary table (test name, status, steps, tokens, cost)
- Aggregate totals
- Per-test breakdown with artifact counts
- AI analysis excerpts (when present in `_summary.json`)

Useful for attaching to PRs, wikis, or sprint reviews without opening HTML.

---

## 11. API test reporting

API runs write JSON only:

```
reports/api-login_api-1780056640985.json
```

Structure:

```json
{
  "scenario": "API Authenticated Token Chaining",
  "result": {
    "success": true,
    "steps": [ /* per-step request/response details */ ]
  }
}
```

There is no `_summary.json` or HTML report for API tests today. Use the JSON file or terminal CLI output for API run results.

---

## 12. Playwright & CI outputs

When running generated Playwright specs directly:

```bash
npx playwright test --config=framework/playwright.config.ts
```

Additional outputs:

| Output | Path |
|--------|------|
| Playwright HTML report | `playwright-report/` |
| JUnit XML | `reports/junit-results.xml` |

These are separate from WebPilot’s AI execution reports but useful for CI pipelines.

**CI example — archive WebPilot reports:**

```yaml
- run: npm run webpilot -- run tests/web --env qa --report
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: webpilot-reports
    path: reports/
```

---

## 13. Regenerating reports

You do **not** need to re-run tests to refresh HTML or Markdown reports if JSON files already exist.

```bash
# Regenerate all HTML from existing _summary.json files
npm run webpilot -- report --html

# Single test
npm run webpilot -- report --html --test automationexercise_add_to_cart

# Skip AI (uses cached aiAnalysis in summary when present)
npm run webpilot -- report --html --no-ai

# Markdown roll-up
npm run webpilot -- analyze
```

---

## 14. Troubleshooting

| Issue | What to try |
|-------|-------------|
| Empty `reports/` | Run a test first: `npm run webpilot -- run tests/web/login.txt --env qa` |
| No HTML generated | Run `npm run webpilot -- report --html` manually; check terminal for `[ExecutionReport]` errors |
| AI analysis missing | Ensure LLM credentials in `.env`; or use `--no-ai` if credentials unavailable |
| No video/trace | Set `browser.video: on` and `browser.trace: on` in `config/webpilot.yaml` |
| Broken links in HTML | Open reports via `file://` from repo root; artifact paths are relative to `reports/` |
| API test has no HTML | Expected — API reporting is JSON-only today |

---

## Quick reference

```bash
# Run test + HTML report
npm run webpilot -- run tests/web/automationexercise_add_to_cart.txt --env qa --report

# Terminal dashboard
npm run report

# HTML suite + per-test pages
npm run webpilot -- report --html

# Markdown roll-up
npm run webpilot -- analyze

# Open suite report
open reports/index.html
```
