# CI & Artifacts

Run WebPilot in GitHub Actions and other CI systems with **deterministic exit codes**, JUnit output, and uploadable artifacts.

---

## Overview

CI should run **generated Playwright specs** (`webpilot replay`), not live browser-use with LLM. WebPilot provides:

- `webpilot ci init` — scaffold GitHub Actions workflow
- `webpilot ci run` — CI-safe wrapper around `webpilot run`
- `webpilot ci doctor` — validate CI environment
- Stable artifact paths under `runtime/reports/`
- JUnit XML for test result parsers
- Artifact manifest for `actions/upload-artifact`

---

## Quick setup

```bash
# Generate .github/workflows/webpilot.yml
webpilot ci init

# Validate CI environment locally
webpilot ci doctor

# CI-style run (headless defaults, exit codes)
webpilot ci run tests/web --report
```

---

## Recommended CI workflow

```yaml
name: WebPilot

on:
  pull_request:
  push:
    branches: [main]

jobs:
  webpilot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx webpilot doctor
      # Regression: replay generated Playwright specs (no LLM)
      - run: npx webpilot replay
      # Or: run .txt scenarios headless (requires LLM secrets for discovery)
      # - run: npx webpilot ci run tests/web --report
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: webpilot-report
          path: runtime/reports
```

### Two CI strategies

| Strategy | Command | LLM required | Best for |
|----------|---------|--------------|----------|
| **Regression (recommended)** | `webpilot replay` | No | Stable suites in PR checks |
| **Live scenarios** | `webpilot ci run tests/web` | Yes (for unknown steps) | Nightly exploration jobs |

---

## Environment variables for CI

```bash
WEBPILOT_CI=1                    # CI artifact behavior
WEBPILOT_BROWSER_PROVIDER=browser-use
WEBPILOT_KNOWLEDGE_ONLY=1        # Optional: zero-LLM replay in nightly jobs
```

Store LLM secrets in GitHub Actions secrets (never commit):

```yaml
env:
  AZURE_OPENAI_API_KEY: ${{ secrets.AZURE_OPENAI_API_KEY }}
  AZURE_OPENAI_ENDPOINT: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
  AZURE_OPENAI_DEPLOYMENT: ${{ secrets.AZURE_OPENAI_DEPLOYMENT }}
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All tests passed |
| Non-zero | One or more failures, doctor blockers, or setup errors |

`webpilot ci run` propagates failures with clear terminal output.

---

## Artifacts for upload

`runtime/reports/artifact-manifest.json` indexes:

- HTML reports (`html/index.html`, per-test HTML)
- JUnit XML (`junit/*.xml`)
- Videos, traces, screenshots
- JSON summaries and execution history
- LLM usage logs

```yaml
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: webpilot-artifacts
    path: |
      runtime/reports/html
      runtime/reports/junit
      runtime/reports/videos
      runtime/reports/traces
```

---

## JUnit output

Enabled via `execution.reporters` in `webpilot.yaml`:

```yaml
execution:
  reporters:
    - "html"
    - "json"
    - "junit"
```

Output: `runtime/reports/junit/*.xml` — compatible with GitHub Actions test reporting and Jenkins.

---

## Docker

The root `Dockerfile` supports containerized runs. See [FRAMEWORK_GUIDE.md](../FRAMEWORK_GUIDE.md) § CI/CD and Docker for image build and run examples.

---

## Roadmap

| Planned | Status |
|---------|--------|
| Provider matrix in CI | Not yet |
| Test sharding | Config present; not fully wired |
| PR annotations from flake analysis | Not yet |

---

## Key source files

| File | Role |
|------|------|
| `src/core/ci/CiWorkflow.ts` | GitHub Actions template |
| `src/core/ci/ArtifactManifest.ts` | Manifest generation |
| `.github/workflows/webpilot.yml` | Generated workflow |

---

## See also

- [Execution & Replay](./execution-and-replay.md)
- [Reports & Evidence](./reports-and-evidence.md)
- [features/07-ci-mode-and-release-artifacts.md](../features/07-ci-mode-and-release-artifacts.md)
