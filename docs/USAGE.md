# WebPilot usage guide

WebPilot turns plain-language test scripts (`.txt`) into live browser automation and Playwright TypeScript. This guide covers install, configuration, running tests, reports, and generated code.

For the full framework reference (architecture, all CLI commands, test formats, CI), see **[FRAMEWORK_GUIDE.md](./FRAMEWORK_GUIDE.md)**.

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** 20+ | For CLI, TypeScript, Playwright |
| **Python** 3.11+ | For the default **browser-use** execution path |
| **Google Chrome** (recommended) | Set `browser.target: chrome` in `resources/config/webpilot.yaml` |
| **LLM API access** | Azure OpenAI is the default (`framework.activeProvider: azure`) |

---

## 2. Install

From the repository root during development:

```bash
npm ci
npx playwright install chromium
npm run build
npm link
webpilot setup   # Python 3.11+ venv + vendored Browser Use in .venv/
```

Optional checks:

```bash
webpilot doctor
webpilot init   # creates missing folders if you skipped clone layout
```

---

## 3. Configure credentials

WebPilot reads secrets from **environment variables** and/or **`resources/config/llm.json`**. The committed `resources/config/llm.json` uses placeholders only — add your real keys locally (do not commit secrets).

### Option A — `.env` (recommended)

```bash
cp .env.example .env
```

Edit `.env` and set the provider you use. For Azure (default browser-use path):

```env
AZURE_OPENAI_API_KEY=your_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
OPENAI_API_VERSION=2024-12-01-preview
```

Also set environment credentials if your `resources/config/environments/*.json` references them:

```env
QA_USERNAME=your_user
QA_PASSWORD=your_password
```

Load `.env` before running (Node loads it via `dotenv` when the CLI starts).

### Option B — `resources/config/llm.json`

Fill in the `azure` section (or another provider) in `resources/config/llm.json`. Keys in this file override placeholders when the app reads LLM config.

### Environments

Target URLs live in `resources/config/environments/`:

- `dev.json`
- `qa.json` (default)
- `prod.json`

Use `--env qa` (or `dev` / `prod`) on the CLI. Values like `${QA_USERNAME}` are replaced from your environment.

---

## 4. Write a test script

Put scenarios in `tests/web/` (UI) or `tests/api/` (HTTP).

**Numbered steps** (common for browser-use):

```text
@smoke @cart
Test: Add Products in Cart

1. Navigate to https://automationexercise.com/
2. Verify that home page is visible successfully
3. Click on Products link in the navigation menu
...
```

**BDD style** (`Given` / `When` / `Then`) is also supported.

Tags on the first lines (`@smoke`) are metadata only. The line `Test: ...` is the scenario title.

**Hybrid metadata** can drive authoring defaults:

```text
@smoke @checkout
target: web
baseUrl: https://automationexercise.com
codegen: true
report: true

Test: Checkout flow

1. Navigate to https://automationexercise.com/
2. Add the first product to the cart
3. Verify the product appears in the cart
```

Create starter files:

```bash
webpilot create test checkout --template checkout-flow
webpilot create test smoke --template web-smoke
webpilot create api petstore
```

Sample scripts in the repo:

- `tests/web/automationexercise_add_to_cart.txt`
- `tests/web/automationexercise_contact_us.txt`
- `tests/web/login.txt`
- `tests/api/login_api.txt`

File uploads: place files under `tests/fixtures/` (e.g. `sample.txt` for contact form tests).

---

## 5. Run tests

All commands use:

```bash
npm run webpilot -- <command> [options]
```

### Run one UI test (browser-use + codegen)

```bash
npm run webpilot -- run tests/web/automationexercise_add_to_cart.txt --env qa
```

### Run headed (see the browser)

```bash
webpilot run tests/web/automationexercise_add_to_cart.txt --env qa --headed
```

### Run several tests

```bash
webpilot run tests/web --env qa --parallel 2
```

### Run and open HTML report after

```bash
webpilot run tests/web/automationexercise_add_to_cart.txt --env qa --report
```

If a scenario includes `codegen: true` or `report: true`, `webpilot run <file>` applies those defaults automatically.

### Interactive mode (approve each step)

```bash
webpilot interactive tests/web/login.txt --env qa
```

### Intelligent learned execution

On the first run, Browser Use handles each unknown test step in one shared
browser session. WebPilot records validated page fingerprints, actions,
locators and resulting states under `runtime/site-knowledge/`.

On later runs, known steps execute deterministically. Browser Use is invoked
only for the current missing or invalid step, then WebPilot learns that result
and continues in the same browser session.

```bash
# Normal intelligent mode
webpilot run tests/web/booking_search_hotels.txt

# Use learned capabilities only; never spend LLM tokens
webpilot run tests/web/booking_search_hotels.txt --knowledge-only

# Force Browser Use discovery for every step and refresh knowledge
webpilot run tests/web/booking_search_hotels.txt --force-discovery

# Also generate and validate Playwright code
webpilot run tests/web/booking_search_hotels.txt --codegen
```

Knowledge belongs to page states and test-step capabilities rather than test
filenames, so it can grow across scenarios and websites.

### API tests (Playwright request, no browser)

API tests use **TypeScript + Playwright `APIRequestContext`** via `BaseAPI` / `ApiContext`. Sources:

| Source | Example |
|--------|---------|
| Plain text | `tests/api/login_api.txt` |
| OpenAPI URL | First line is spec URL, or `@source https://...` in `.txt` |
| OpenAPI file | `tests/api/specs/petstore.yaml` |
| Unstructured prose | LLM parses when line-based rules do not match |

```bash
# Run NL API test (regex parser + LLM fallback)
webpilot run tests/api/login_api.txt --env qa

# Import Swagger/OpenAPI into a new scenario file
webpilot import-api https://petstore.swagger.io/v2/swagger.json -o tests/api/petstore_smoke.txt

# Replay generated Playwright API specs without Browser Use or an LLM
webpilot replay packages/test-framework/tests/api --project api
```

On success, WebPilot can generate `packages/test-framework/apis/<Name>Api.ts` and `packages/test-framework/tests/api/<slug>.api.spec.ts` when `framework.apiCodegenEnabled: true` in `resources/config/webpilot.yaml`.

Set `apiBaseUrl` in `resources/config/environments/<env>.json` for your API host.

---

## 6. What happens on a UI run

With `framework.useBrowserUse: true` in `resources/config/webpilot.yaml` (default):

1. **browser-use** opens Chrome and executes your steps with an LLM agent.
2. Execution history is saved under `runtime/reports/<test>_execution_history.json`.
3. **Codegen** generates or updates Playwright POMs under `packages/test-framework/pages/` and specs under `packages/test-framework/tests/`.
4. Optional **HTML report** is written if `framework.htmlReport: true` (default).

During the run you should see:

- Blue border and **WebPilot** badge in the browser
- Bottom bar with current goal, token usage, and estimated cost

---

## 7. Reports and artifacts

Full guide: **[REPORTING.md](./REPORTING.md)**.

| Output | Location |
|--------|----------|
| HTML suite report | `runtime/reports/index.html` |
| Per-test HTML report | `runtime/reports/<test>-report.html` |
| Summary JSON | `runtime/reports/<test>_summary.json` |
| LLM usage | `runtime/reports/<test>_llm_usage.json` |
| Videos | `runtime/reports/videos/` |
| Playwright traces | `runtime/reports/traces/` |
| Step screenshots | `runtime/reports/screenshots/<test>/` |
| CI artifact manifest | `runtime/reports/artifact-manifest.json` |

```bash
npm run report
npm run webpilot -- report --html
npm run webpilot -- report --html --no-ai
npm run webpilot -- report --html --test automationexercise_add_to_cart
npm run webpilot -- analyze
```

---

## 8. CI mode

Create a GitHub Actions workflow:

```bash
webpilot ci init
```

Run WebPilot with CI defaults:

```bash
webpilot ci doctor --provider browser-use
webpilot ci run tests/web --provider browser-use
webpilot report --json
```

`webpilot ci run` sets CI environment defaults, generates HTML reports, and writes `runtime/reports/artifact-manifest.json` for upload steps.

---

## 9. Generated Playwright code

After a successful UI run, check:

- **Page objects:** `packages/test-framework/pages/<site>/`
- **Specs:** `packages/test-framework/tests/*.spec.ts`

Replay generated Playwright tests without Browser Use or an LLM:

```bash
webpilot replay
```

Canonical automationexercise POMs may be merged from `src/core/CodegenCanonicalPages.ts` for stability; see `resources/prompts/shared/framework-guidelines.md`.

---

## 10. Other CLI commands

| Command | Purpose |
|---------|---------|
| `webpilot init` | Create default folders |
| `webpilot setup` | Create `.venv` and install vendored Browser Use |
| `webpilot doctor` | Check dirs and environment |
| `webpilot doctor --json` | Machine-readable doctor output |
| `webpilot ci init` | Create `.github/workflows/webpilot.yml` |
| `webpilot ci run` | Run with CI defaults and write artifact manifest |
| `webpilot create test <name> --template checkout-flow` | Create a metadata-rich web starter |
| `webpilot create test <name>` | New `tests/web/<name>.txt` template |
| `webpilot create api <name>` | New `tests/api/<name>.txt` template |
| `webpilot replay [paths...]` | Run generated Playwright specs without AI |
| `webpilot self-heal` | List healed selectors in cache |
| `webpilot self-heal --clean` | Clear healing cache |

---

## 11. Docker

```bash
docker compose build
docker compose run webpilot run tests/web/login.txt --env qa
```

Pass API keys via environment variables in `docker-compose.yml` or a local `.env` file (not committed if you add secrets there).

---

## 12. Troubleshooting

| Issue | What to try |
|-------|-------------|
| `python3` / `browser-use` not found | Run `webpilot setup` (creates `.venv` with Python 3.11+). Set `WEBPILOT_PYTHON` if needed. |
| Azure errors | Check `AZURE_OPENAI_*` in `.env` and `azure` block in `resources/config/llm.json` |
| Browser does not open | Use `--headed` or set `browser.headless: false` in `resources/config/webpilot.yaml` |
| Codegen / TS errors | See terminal output; validators retry fixes under `packages/test-framework/` |
| Empty reports | Run a test first; `runtime/reports/` is gitignored and created per run |

More detail: [CONFIGURATION.md](./CONFIGURATION.md), [REPORTING.md](./REPORTING.md), [README.md](../README.md).
