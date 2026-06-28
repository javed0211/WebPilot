# Contributing to WebPilot

Thanks for helping make WebPilot a stronger open-source automation tool.

WebPilot combines TypeScript, Playwright, Browser Use, Python integration code, generated automation assets, and static reports. The most valuable contributions keep the user experience clear and the generated output trustworthy.

## Before You Start

Read these first:

- [README.md](README.md)
- [docs/OPEN_SOURCE_ROADMAP.md](docs/OPEN_SOURCE_ROADMAP.md)
- [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)
- [docs/USAGE.md](docs/USAGE.md)

## Development Setup

```bash
npm ci
npm run build
npx playwright install chromium
npm run setup
cp .env.example .env
```

Run a smoke scenario:

```bash
npm run webpilot -- run tests/web/automationexercise_add_to_cart.txt --env qa --headed --report
```

Generate reports:

```bash
npm run webpilot -- report --html
```

## Useful Checks

```bash
npm run build
npm run doctor
npm run check:architecture
```

If you touch report generation, open:

```text
runtime/reports/html/index.html
```

If you touch generated Playwright output, run replay where possible:

```bash
npm run webpilot -- replay
```

## Contribution Areas

Good places to start:

- docs and quickstart fixes
- sample scenarios against public demo sites
- CLI error messages
- report UI polish
- provider setup recipes
- Playwright codegen quality
- deterministic replay reliability
- `webpilot doctor` diagnostics

Higher-risk areas:

- Browser Use integration boundaries
- report data schema changes
- generated page object merge logic
- self-healing and site knowledge persistence
- package publishing contents

## Repository Rules

- Keep generated and local-only output under `runtime/`.
- Do not commit real API keys, cookies, customer traces, private screenshots, or generated artifacts containing sensitive data.
- Prefer Playwright-native, readable generated code over clever abstractions.
- Keep Browser Use imports behind `src/integrations/browser_use/`.
- Update docs when changing CLI behavior, report structure, config keys, or generated output contracts.
- Add focused tests or verification steps when touching shared behavior.

## Commit and PR Guidance

Use concise, outcome-focused commit messages, for example:

```text
docs: clarify quickstart provider setup
fix: normalize report artifact links
feat: add report manifest output
```

Pull requests should include:

- what changed
- why it changed
- how it was tested
- screenshots for report UI changes
- any migration or compatibility notes

## Reporting Bugs

Please include:

- WebPilot version or commit
- OS and Node version
- command you ran
- relevant `.txt` test file or a minimal reproduction
- sanitized logs
- whether the issue reproduces with `--headed`
- report artifact paths if relevant

Never attach secrets or private traces without sanitizing them first.
