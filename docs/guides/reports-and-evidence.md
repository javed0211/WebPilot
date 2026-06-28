# Reports & Evidence

WebPilot produces **rich execution evidence** — HTML dashboards, JSON artifacts, videos, traces, screenshots, and optional AI analysis.

---

## Overview

Every `webpilot run` can generate:

- Terminal job summary (status, duration, LLM tokens, cost)
- JSON summary and execution history
- HTML suite and per-test reports (React UI)
- Video and Playwright trace
- JUnit XML for CI
- Artifact manifest for upload

---

## Quick commands

```bash
# Run with HTML report
webpilot run tests/web/foo.txt --report

# Generate HTML from existing run data
webpilot report --html

# Single test report
webpilot report --html --test booking_search_hotels

# JSON suite report + artifact manifest
webpilot report --json

# Markdown analysis roll-up
webpilot analyze

# Disable AI analysis section in HTML
webpilot report --html --no-ai
```

Scenario metadata: `report: true` in `.txt` header enables reporting without `--report`.

---

## Artifact layout

All runtime output lives under `runtime/` (not committed to git):

```text
runtime/reports/
  html/
    index.html              # Suite dashboard
    <slug>.html             # Per-test report
  data/
    summaries/              # *_summary.json
    execution-history/      # Step-by-step logs
    llm-usage/              # Token/cost per test
  videos/                   # *.mp4
  traces/                   # Playwright trace zips
  screenshots/              # Failure screenshots
  junit/                    # JUnit XML
  markdown/                 # Consolidated analysis
  artifact-manifest.json    # CI upload index
```

---

## HTML report contents

Per-test HTML reports include:

| Section | Content |
|---------|---------|
| Summary | Pass/fail, duration, environment |
| Steps | Execution history with URLs and actions |
| Evidence | Video, trace, screenshots (linked) |
| LLM usage | Calls, tokens, estimated cost |
| Flake analysis | Category + fix recommendation (failures) |
| Codegen | Links to generated spec/POM (when `--codegen`) |
| AI analysis | Optional LLM quality review (`htmlReportAiAnalysis`) |

Suite dashboard (`index.html`) aggregates all tests in the run.

---

## Configuration

```yaml
framework:
  reportsPath: "./runtime/reports"
  artifactsPath: "./runtime/artifacts"
  htmlReport: true
  htmlReportAiAnalysis: true

browser:
  video: "on"                    # off | on | retain-on-failure
  trace: "on"                    # off | on | retain-on-failure
  screenshots: "only-on-failure"   # off | on | only-on-failure

execution:
  reporters:
    - "html"
    - "json"
    - "junit"
```

---

## JSON summary schema (high level)

`runtime/reports/data/summaries/<slug>_summary.json`:

```json
{
  "test": "booking_home_visibility_smoke",
  "status": "PASSED",
  "durationMs": 12500,
  "llmCalls": 0,
  "promptTokens": 0,
  "completionTokens": 0,
  "reusedSteps": 4,
  "learnedSteps": 0,
  "executionHistoryPath": "runtime/reports/data/execution-history/...",
  "flakeAnalysis": null,
  "codegen": { "specPath": "...", "replayCommand": "webpilot replay ..." }
}
```

---

## CI artifact manifest

`runtime/reports/artifact-manifest.json` lists all uploadable files with stable paths — used by `webpilot ci` and GitHub Actions workflows.

```bash
webpilot reports-tidy   # Migrate legacy flat report files to runtime/ layout
```

---

## AI analysis

When `framework.htmlReportAiAnalysis: true`, WebPilot runs an LLM review of the execution (quality of steps, assertion strength, suggestions). Prompts are editable under `resources/prompts/reports/`.

Disable per run: `webpilot report --html --no-ai`

---

## API test reporting

API runs produce JSON summaries and logs. Full HTML parity with UI tests is partial — UI tests are the primary reporting path today.

See [API Testing](./api-testing.md).

---

## Key source files

| File | Role |
|------|------|
| `src/core/ExecutionReportService.ts` | Report orchestration |
| `src/core/execution_report/collector.ts` | Gather run data |
| `src/core/execution_report/renderHtml.ts` | HTML generation |
| `src/core/execution_report/generateMarkdownReport.ts` | Markdown analysis |
| `resources/report-ui/` | React report UI |
| `src/core/ci/ArtifactManifest.ts` | CI manifest |

---

## See also

- [CI & Artifacts](./ci-and-artifacts.md)
- [Flake Analyzer](./flake-analyzer.md)
- [REPORTING.md](../REPORTING.md)
