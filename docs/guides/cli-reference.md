# CLI Reference

Complete reference for WebPilot CLI commands, flags, and environment variables.

---

## Command summary

| Command | Purpose |
|---------|---------|
| `webpilot init` | Scaffold project, config, starter tests |
| `webpilot setup` | Python venv + vendored browser-use |
| `webpilot doctor` | Validate environment and credentials |
| `webpilot run` | Execute `.txt` scenarios (web or API) |
| `webpilot replay` | Run generated Playwright specs (no LLM) |
| `webpilot generate` | Codegen from saved execution trace |
| `webpilot report` | HTML/JSON reports and terminal dashboard |
| `webpilot analyze` | Markdown roll-up / flake analysis |
| `webpilot knowledge-status` | Per-step site knowledge maturity for a `.txt` test |
| `webpilot self-heal` | Selector healing proposals and apply |
| `webpilot graph` | Build repository knowledge graph |
| `webpilot create` | Create test from template |
| `webpilot import-api` | OpenAPI → API scenario |
| `webpilot interactive` | Human-in-the-loop headed run |
| `webpilot ci` | CI init, doctor, run |
| `webpilot reports-tidy` | Migrate legacy report paths |
| `webpilot history list` | List saved ActHistory scenarios |
| `webpilot history clear` | Clear ActHistory (one scenario or `--all`) |

---

## `webpilot run`

Primary execution command.

```bash
webpilot run <file|directory> [options]
```

| Flag | Description |
|------|-------------|
| `-e, --env <name>` | Environment: `dev`, `qa`, `prod`, `azure` (default: `qa`) |
| `--headed` | Visible browser |
| `--architecture <mode>` | `flat`, `pom`, `bdd`, `pom-bdd` |
| `--parallel <n>` | Concurrent tests |
| `--provider <name>` | `browser-use`, `local-playwright`, `testmu` |
| `--report` | Generate HTML report after suite |
| `--codegen` | Generate Playwright code **only after a successful** run |
| `--knowledge-only` | Replay learned steps only; fail on unknown |
| `--force-discovery` | Ignore prior ActHistory reuse; re-explore all steps |

**Sets env vars:** `WEBPILOT_KNOWLEDGE_ONLY`, `WEBPILOT_DISABLE_SITE_KNOWLEDGE` / `WEBPILOT_FORCE_DISCOVERY`, `WEBPILOT_CODEGEN`, `WEBPILOT_CODEGEN_MODE`, `WEBPILOT_BROWSER_PROVIDER`

**ActHistory reuse:** with `--codegen`, a prior **successful** history for the same slug may skip the browser. Failed histories are never reused. Manage with `webpilot history` — see [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md).

---

## `webpilot replay`

```bash
webpilot replay [paths...] [options]
```

| Flag | Description |
|------|-------------|
| `[paths...]` | Spec files (default: `packages/test-framework/tests`) |
| `--project <name>` | Playwright project |
| `--headed` | Visible browser |
| `--grep <pattern>` | Filter tests |

No LLM. No browser-use. Pure Playwright.

---

## `webpilot generate`

```bash
webpilot generate --from <slug|latest> [--no-validate]
```

Regenerate Playwright files from `runtime/codegen/traces/` without re-running the browser.

> There is no `webpilot codegen` command — use `generate` or `run --codegen`.

---

## `webpilot report`

```bash
webpilot report [options]
```

| Flag | Description |
|------|-------------|
| `--html` | Generate HTML suite + per-test reports |
| `--json` | JSON suite report + artifact manifest |
| `--no-ai` | Skip LLM analysis section in HTML |
| `--test <slug>` | Single test report |
| `-e, --env <name>` | Environment filter |
| `--file <path>` | Report from specific summary file |

---

## `webpilot doctor`

```bash
webpilot doctor [--provider <name>] [--json]
```

Checks Node, Python, browser-use, LLM credentials, provider config, writable `runtime/`, and **profile-specific toolchains** (Playwright, pytest, Maven, Cypress, WebdriverIO, .NET SDK, etc.) based on `resources/config/webpilot.yaml`.

---

## `webpilot init`

```bash
webpilot init [directory] [options]
```

Interactive init (without `-y`) asks whether to start blank or from an **existing code repository** (clone Git URL or use a local path), then builds the knowledge graph so codegen can reuse page objects.

| Flag | Description |
|------|-------------|
| `-f, --force` | Overwrite WebPilot-owned files |
| `-y, --yes` | Non-interactive defaults (skips repo-source wizard → blank project) |
| `--clone <gitUrl>` | Clone a Git repo, overlay WebPilot, build knowledge graph |
| `--from-path <dir>` | Use an existing local repo (no clone) |
| `--branch <name>` | Branch to checkout with `--clone` |
| `--skip-graph` | Skip knowledge graph build after init |
| `--language`, `--tool`, `--pattern`, `--target` | Project profile |
| `--llm-provider`, `--llm-model` | LLM defaults |

**Credentials:** `--clone` shells out to system `git`. WebPilot does not manage tokens or SSH keys — use SSH URLs, Git Credential Manager / `gh auth login`, or `--from-path` for an already-cloned private repo. Details: [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md#git-credentials-private-repos).

### Supported init profiles

| `--language` | `--tool` | Scaffold highlights |
|--------------|----------|---------------------|
| `typescript` | `playwright` | `packages/test-framework/`, Playwright config |
| `python` | `playwright` | `tests/generated/`, `pyproject.toml`, `conftest.py` |
| `java` | `selenium` | `src/test/java/webpilot/`, `pom.xml` |
| `typescript` | `cypress` | `cypress/`, `cypress.config.ts` |
| `typescript` | `webdriverio` | `wdio.conf.ts`, `test/specs/`, `test/pageobjects/` |
| `csharp` | `selenium` | `tests/WebPilot.Tests/`, NUnit + Selenium |
| `csharp` | `playwright` | `tests/WebPilot.Playwright.Tests/`, NUnit + Playwright |

`webpilot doctor` runs profile-specific toolchain checks after init.

See [Multi-Language Codegen](./multi-language-codegen.md) and [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md) (init from existing repo).

---

## `webpilot knowledge-status`

```bash
webpilot knowledge-status tests/web/CRM.txt
webpilot knowledge-status tests/web/CRM.txt --json
```

Shows per-step: `missing` | `candidate` | `trusted` | `quarantined` | `unsafe-no-replay`, intent, success/failure counts, and whether the file is eligible for full knowledge-only replay.

---

## `webpilot self-heal`

```bash
webpilot self-heal [--clean]
webpilot self-heal --proposals
webpilot self-heal --apply <proposal.json> --file <target.ts>
```

Manual-review healing workflow. Does not auto-patch without `--apply`.

---

## `webpilot graph`

```bash
webpilot graph [--summary] [--json] [--out <path>]
```

---

## `webpilot create`

```bash
webpilot create test <name> [--template <name>] [--base-url <url>]
webpilot create api <name> [--template api-smoke]
```

---

## `webpilot ci`

```bash
webpilot ci init      # Write .github/workflows/webpilot.yml
webpilot ci doctor    # CI environment checks
webpilot ci run       # CI wrapper for webpilot run
```

---

## Environment variables

### WebPilot core

| Variable | Purpose |
|----------|---------|
| `WEBPILOT_PROJECT_ROOT` | Project root (set by CLI) |
| `WEBPILOT_INSTALL_ROOT` | Install / vendored packages root |
| `WEBPILOT_PYTHON` | Override Python binary |
| `WEBPILOT_SKIP_PYTHON_SETUP` | Skip venv setup |
| `WEBPILOT_BROWSER_PROVIDER` | Override active browser provider |
| `WEBPILOT_CI` | CI mode behavior |

### Intelligent runner

| Variable | Purpose |
|----------|---------|
| `WEBPILOT_KNOWLEDGE_ONLY` | `1` = knowledge-only replay |
| `WEBPILOT_RESET_AUTH` | `1` = clear cookies before run (fresh login proof) |
| `WEBPILOT_FRESH_CONTEXT` | `1` = clear cookies + web storage (full fresh session) |
| `WEBPILOT_KNOWLEDGE_TTL_DAYS` | Skip stale capabilities after N days (default `30`) |
| `WEBPILOT_CROSS_SCENARIO` | `1` (default) = merge lookup from scenario stores in global scope |
| `WEBPILOT_DATA_SET` | Tag trust scoring with a data variant label |
| `WEBPILOT_DISABLE_SITE_KNOWLEDGE` | `1` = force discovery |
| `WEBPILOT_JUDGE_MODE` | `verification`, `always`, `off` |
| `WEBPILOT_FLASH_MODE` | `1` = fast low-quality mode |

### Codegen

| Variable | Purpose |
|----------|---------|
| `WEBPILOT_CODEGEN` | `1` = enable post-run codegen (only after successful discovery) |
| `WEBPILOT_CODEGEN_MODE` | `deterministic`, `llm`, `auto` |
| `WEBPILOT_FORCE_DISCOVERY` | `1` = ignore ActHistory reuse; rediscover |
| `WEBPILOT_REUSE_HISTORY` | `0` = disable reuse; `1` = allow reuse without `--codegen` |
| `WEBPILOT_FORCE_CODEGEN` | `1` = do not reuse an existing passing generated spec |

### LLM providers

| Variable | Purpose |
|----------|---------|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI |
| `AZURE_OPENAI_ENDPOINT` | Azure endpoint URL |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GEMINI_API_KEY` | Google Gemini |
| `WEBPILOT_LLM_PROVIDER` | Override provider in Python runner |

### Test credentials

| Variable | Purpose |
|----------|---------|
| `QA_USERNAME`, `QA_PASSWORD` | From `environments/*.json` interpolation |

### Remote browsers

| Variable | Purpose |
|----------|---------|
| `TESTMU_USERNAME`, `TESTMU_ACCESS_KEY` | TestMu / LambdaTest |
| `REMOTE_CDP_URL` | Remote CDP endpoint |
| `SELENIUM_GRID_URL` | Selenium Grid |

### Other

| Variable | Purpose |
|----------|---------|
| `WEBPILOT_VIEWPORT_SCALE` | Viewport scaling factor |
| `WEBPILOT_NODE`, `WEBPILOT_REPORT_CLI` | Python → Node report bridge |

---

## `webpilot history`

Manage ActHistory used for `--codegen` reuse (skip rediscovery). Full guide: [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md).

```bash
webpilot history list
webpilot history clear Digital
webpilot history clear tests/web/Digital.txt
webpilot history clear Digital --related
webpilot history clear --all
webpilot history clear --all --related -y
```

| Flag / arg | Description |
|------------|-------------|
| `list` | Show saved scenarios and whether history was successful |
| `clear <slug\|path>` | Delete ActHistory for one scenario (forces rediscovery next `--codegen`) |
| `--all` | Clear ActHistory for every scenario (asks to confirm unless `-y`) |
| `--related` | Also remove summary, LLM usage, HTML report, screenshots, video, trace, codegen failure memory / traces / plans |
| `-y, --yes` | Skip confirmation for `--all` |

**Policies encoded in the product:**

- Codegen runs **only** after successful discovery (`isSuccessful === true`).
- Failed ActHistory is **never** reused and **never** used to generate code.
- One-off rediscovery without deleting files: `webpilot run … --codegen --force-discovery`.

---

## npm scripts (development)

```bash
npm run webpilot -- run tests/web/foo.txt --env qa
npm run build
npm run test:web
```

---

## See also

- [USAGE.md](../USAGE.md)
- [CONFIGURATION.md](../CONFIGURATION.md)
- [FRAMEWORK_GUIDE.md](../FRAMEWORK_GUIDE.md)
- [guides/README.md](./README.md)
