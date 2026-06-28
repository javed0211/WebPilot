# 07. CI Mode and Release Artifacts

## Goal

Make WebPilot easy to run in GitHub Actions and other CI systems with deterministic exit codes and uploadable artifacts.

## User Problem

Open-source automation tools win when users can add them to CI quickly.

Users need:

- Headless mode by default.
- Clear exit codes.
- JUnit output.
- HTML reports.
- Trace/video/screenshot artifacts.
- Minimal GitHub Actions setup.

## Proposed Commands

```bash
webpilot ci init
webpilot ci run
webpilot ci doctor
```

## GitHub Actions Template

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
      - run: npx webpilot run tests/web --headless --report
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: webpilot-report
          path: runtime/reports
```

## Product Scope

CI mode supports:

- `webpilot ci init` writes `.github/workflows/webpilot.yml`.
- `webpilot ci run` wraps `webpilot run` with CI defaults.
- `doctor` has CI-safe output.
- Reports and JUnit are generated in stable paths.

Deferred for later:

- Provider matrix.
- Sharding.
- PR annotations.

## Implementation Notes

Implemented in `src/core/ci/`:

- `CiWorkflow.ts` renders and writes the GitHub Actions workflow.
- `ArtifactManifest.ts` scans stable report directories and writes `runtime/reports/artifact-manifest.json`.

CLI:

```bash
webpilot ci init
webpilot ci init --force
webpilot ci doctor --provider browser-use
webpilot ci run tests/web --provider browser-use
webpilot doctor --json
webpilot report --json
```

CI defaults:

- `webpilot ci run` sets `CI=true` and `WEBPILOT_CI=1`.
- It runs `webpilot run ... --report` and writes the artifact manifest even when the run fails.
- `webpilot ci init` preserves an existing workflow unless `--force` is passed.

Stable artifacts:

- HTML reports: `runtime/reports/html/`
- JUnit XML: `runtime/reports/junit/junit-results.xml`
- traces: `runtime/reports/traces/`
- videos: `runtime/reports/videos/`
- screenshots: `runtime/reports/screenshots/`
- manifest: `runtime/reports/artifact-manifest.json`

Verification:

```bash
npm run build
node scripts/test-feature-07.cjs
```

## Original Plan

### Phase 1: CI Command

Add command group:

```bash
webpilot ci init
webpilot ci run
```

### Phase 2: Artifact Manifest

Create:

```text
runtime/reports/artifact-manifest.json
```

Manifest includes:

- HTML report path.
- JUnit path.
- trace paths.
- video paths.
- screenshot paths.
- summary JSON paths.

### Phase 3: JSON Output

Support:

```bash
webpilot doctor --json
webpilot report --json
```

### Phase 4: Docs

Add CI section to:

- `README.md`
- `docs/USAGE.md`
- `docs/REPORTING.md`

## Tests

Unit tests:

- Workflow template renders.
- Existing workflow is not overwritten unless `--force`.
- Artifact manifest includes expected files.

Integration tests:

- Create temp project.
- Run `webpilot ci init`.
- Validate YAML exists and has expected steps.

## Exit Criteria

- A user can add WebPilot to GitHub Actions with one command. **Done**
- CI output has deterministic exit code. **Done**
- Report artifacts are uploadable from stable paths. **Done**
- Missing secrets produce actionable messages. **Done**

