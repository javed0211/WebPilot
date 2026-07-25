# Project Structure

WebPilot keeps only six functional directories at the repository root.

```text
src/         WebPilot application source
packages/    Independently owned engines and generated frameworks
resources/   Configuration, prompts, and static assets
tests/       Natural-language test specifications and fixtures
docs/        Project documentation
scripts/     Setup, validation, and media scripts
runtime/     Generated and local-only output
```

## Ownership

### `src/`

- `cli/`: commands and user-facing orchestration
- `core/`: test engines, code generation, validation, and reporting
- `agents/`: legacy TypeScript agent implementation
- `integrations/browser_use/`: the only WebPilot layer allowed to access Browser Use
- `utils/`: shared product utilities

### `packages/`

- `browser-use/`: pinned upstream Browser Use source plus documented WebPilot patches
- `test-framework/`: canonical and generated **TypeScript Playwright** pages, APIs, fixtures, and tests

Generated Playwright specs live in `packages/test-framework/specs/` for projects scaffolded by `webpilot init` (1.5+). Projects created earlier (including this repository) use `packages/test-framework/tests/`; codegen detects which directory exists and keeps writing there, so nothing moves on upgrade. The rename avoids confusion with the natural-language scripts in the top-level `tests/` directory.

Initialized projects using other codegen profiles store generated code in profile-specific paths (for example `tests/generated/` for Python, `test/specs/generated/` for WebdriverIO, `tests/WebPilot.Playwright.Tests/Generated/` for C# Playwright). See [guides/multi-language-codegen.md](./guides/multi-language-codegen.md).

### `resources/`

- `config/`: runtime and environment configuration
- `prompts/`: editable LLM prompts
- `assets/`: committed visual and demo assets

### `runtime/`

Everything here is generated or machine-local. `webpilot init` no longer scaffolds this tree — it is created on demand the first time a command runs inside the project:

- `reports/html/` — suite and per-test HTML dashboards
- `reports/data/` — JSON summaries, execution history, LLM usage, API results, CLI logs
- `reports/markdown/` — consolidated markdown analysis
- `reports/junit/` — Playwright JUnit XML
- `reports/videos/`, `reports/traces/`, `reports/screenshots/` — run artifacts
- `reports/assets/`, `reports/history/` — report UI assets and run snapshots
- `artifacts/`
- `healing-cache/`
- `playwright-report/`, `test-results/`
- `workspace/`
- `site-knowledge/` — automatically learned page fingerprints, actions, transitions, and validation history

Run `npm run check:architecture` to verify that legacy root folders have not
been reintroduced and Browser Use imports remain behind the integration boundary.
