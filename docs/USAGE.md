# WebPilot usage guide

WebPilot turns plain-language test scripts (`.txt`) into live browser automation and Playwright TypeScript. This guide covers install, configuration, running tests, reports, and generated code.

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** 20+ | For CLI, TypeScript, Playwright |
| **Python** 3.11+ | For the default **browser-use** execution path |
| **Google Chrome** (recommended) | Set `browser.target: chrome` in `config/webpilot.yaml` |
| **LLM API access** | Azure OpenAI is the default (`framework.activeProvider: azure`) |

---

## 2. Install

From the repository root:

```bash
npm ci
npx playwright install chromium
npm run setup    # Python 3.11+ venv + browser-use in .venv/
```

Optional checks:

```bash
npm run doctor
npm run webpilot -- init   # creates missing folders if you skipped clone layout
```

---

## 3. Configure credentials

WebPilot reads secrets from **environment variables** and/or **`config/llm.json`**. The committed `config/llm.json` uses placeholders only — add your real keys locally (do not commit secrets).

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

Also set environment credentials if your `config/environments/*.json` references them:

```env
QA_USERNAME=your_user
QA_PASSWORD=your_password
```

Load `.env` before running (Node loads it via `dotenv` when the CLI starts).

### Option B — `config/llm.json`

Fill in the `azure` section (or another provider) in `config/llm.json`. Keys in this file override placeholders when the app reads LLM config.

### Environments

Target URLs live in `config/environments/`:

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
npm run webpilot -- run tests/web/automationexercise_add_to_cart.txt --env qa --headed
```

### Run several tests

```bash
npm run webpilot -- run tests/web --env qa --parallel 2
```

### Run and open HTML report after

```bash
npm run webpilot -- run tests/web/automationexercise_add_to_cart.txt --env qa --report
```

### Interactive mode (approve each step)

```bash
npm run webpilot -- interactive tests/web/login.txt --env qa
```

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
npm run webpilot -- run tests/api/login_api.txt --env qa

# Import Swagger/OpenAPI into a new scenario file
npm run webpilot -- import-api https://petstore.swagger.io/v2/swagger.json -o tests/api/petstore_smoke.txt

# Run generated Playwright API specs
npx playwright test --project=api --config=framework/playwright.config.ts
```

On success, WebPilot can generate `framework/apis/<Name>Api.ts` and `framework/tests/api/<slug>.api.spec.ts` when `framework.apiCodegenEnabled: true` in `config/webpilot.yaml`.

Set `apiBaseUrl` in `config/environments/<env>.json` for your API host.

---

## 6. What happens on a UI run

With `framework.useBrowserUse: true` in `config/webpilot.yaml` (default):

1. **browser-use** opens Chrome and executes your steps with an LLM agent.
2. Execution history is saved under `reports/<test>_execution_history.json`.
3. **Codegen** generates or updates Playwright POMs under `framework/pages/` and specs under `framework/tests/`.
4. Optional **HTML report** is written if `framework.htmlReport: true` (default).

During the run you should see:

- Blue border and **WebPilot** badge in the browser
- Bottom bar with current goal, token usage, and estimated cost

---

## 7. Reports and artifacts

| Output | Location |
|--------|----------|
| HTML suite report | `reports/index.html` |
| Per-test HTML report | `reports/<test>-report.html` |
| Summary JSON | `reports/<test>_summary.json` |
| LLM usage | `reports/<test>_llm_usage.json` |
| Videos | `reports/videos/` |
| Playwright traces | `reports/traces/` |
| Step screenshots | `reports/screenshots/<test>/` |

Regenerate HTML from existing JSON (no re-run):

```bash
npm run webpilot -- report --html
npm run webpilot -- report --html --no-ai          # skip AI analysis section
npm run webpilot -- report --html --test automationexercise_add_to_cart
```

Terminal summary only:

```bash
npm run report
```

---

## 8. Generated Playwright code

After a successful UI run, check:

- **Page objects:** `framework/pages/<site>/`
- **Specs:** `framework/tests/*.spec.ts`

Run generated Playwright tests:

```bash
cd framework
npx playwright test
```

Canonical automationexercise POMs may be merged from `core/CodegenCanonicalPages.ts` for stability; see `prompts/shared/framework-guidelines.md`.

---

## 9. Other CLI commands

| Command | Purpose |
|---------|---------|
| `npm run webpilot -- init` | Create default folders |
| `npm run webpilot -- doctor` | Check dirs and env vars |
| `npm run webpilot -- create test <name>` | New `tests/web/<name>.txt` template |
| `npm run webpilot -- create api <name>` | New `tests/api/<name>.txt` template |
| `npm run webpilot -- self-heal` | List healed selectors in cache |
| `npm run webpilot -- self-heal --clean` | Clear healing cache |

---

## 10. Docker

```bash
docker compose build
docker compose run webpilot run tests/web/login.txt --env qa
```

Pass API keys via environment variables in `docker-compose.yml` or a local `.env` file (not committed if you add secrets there).

---

## 11. Troubleshooting

| Issue | What to try |
|-------|-------------|
| `python3` / `browser-use` not found | Run `npm run setup` (creates `.venv` with Python 3.12+). Set `WEBPILOT_PYTHON` if needed. |
| Azure errors | Check `AZURE_OPENAI_*` in `.env` and `azure` block in `config/llm.json` |
| Browser does not open | Use `--headed` or set `browser.headless: false` in `config/webpilot.yaml` |
| Codegen / TS errors | See terminal output; validators retry fixes under `framework/` |
| Empty reports | Run a test first; `reports/` is gitignored and created per run |

More detail: [CONFIGURATION.md](./CONFIGURATION.md), [README.md](../README.md).
