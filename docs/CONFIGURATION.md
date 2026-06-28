# WebPilot configuration reference

---

## File map

| File | Purpose |
|------|---------|
| `resources/config/webpilot.yaml` | Framework defaults: browser-use, reports, browser, execution |
| `resources/config/llm.json` | LLM providers and models (placeholders in repo; add keys locally) |
| `resources/config/llm-models.json` | Model-family payload rules (`max_tokens` vs `max_completion_tokens`) |
| `resources/config/environments/*.json` | Per-environment URLs and credentials |
| `.env` | Optional local secrets (copy from `.env.example`; not required in repo) |

---

## `resources/config/webpilot.yaml`

Key settings:

```yaml
framework:
  activeProvider: azure          # LLM provider key in llm.json
  defaultEnvironment: qa
  useBrowserUse: true            # true = Python browser-use path; false = legacy Engine + Playwright
  htmlReport: true               # Write runtime/reports/index.html after browser-use runs
  htmlReportAiAnalysis: true     # LLM quality section in HTML reports
  generatedCodePath: "./framework"
  validationRetries: 3

browser:
  target: chrome                 # chrome | chromium | msedge (local browser-use channel)
  headless: false                # false = visible browser (or use CLI --headed)
  video: on                      # on | off | retain-on-failure
  trace: on
  viewport: { width: 1280, height: 720 }
  testmu:                        # remote TestMu AI browser via CDP (see below)
    enabled: false
```

### TestMu AI remote browser

When `browser.testmu.enabled: true`, WebPilot connects browser-use to a TestMu cloud session instead of launching Chrome locally. Set credentials in `resources/config/webpilot.yaml` **or** via environment variables (recommended for CI):

```bash
# .env
TESTMU_USERNAME=your_username
TESTMU_ACCESS_KEY=your_access_key
```

```yaml
browser:
  testmu:
    enabled: true
    username: ""   # falls back to TESTMU_USERNAME
    accessKey: ""  # falls back to TESTMU_ACCESS_KEY
    platform: "Windows 10"
    browserName: "Chrome"
    build: "WebPilot"
```

Other options under `browser.testmu`: `browserVersion`, `name`, `network`, `video`, `console`, `tunnel`, `tunnelName`, `geoLocation`. Session video is recorded on TestMu; local `browser.video` does not apply in remote mode.

---

## `resources/config/llm.json`

Committed with **placeholder** API keys. Before running, either:

1. Set environment variables (see `.env.example`), or  
2. Fill `apiKey`, `endpoint`, and `deploymentId` in the provider block you use.

**Azure (default for browser-use):**

```json
"azure": {
  "model": "gpt-4.1",
  "endpoint": "https://YOUR_RESOURCE.openai.azure.com",
  "deploymentId": "YOUR_DEPLOYMENT",
  "apiVersion": "2024-12-01-preview",
  "apiKey": "YOUR_KEY_OR_LEAVE_EMPTY_IF_USING_ENV"
}
```

`src/integrations/browser_use/runner.py` loads credentials through
`src/integrations/browser_use/llm_config.py`: values in `resources/config/llm.json` are merged
with `.env` (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`,
`AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`). Empty or placeholder
keys in `llm.json` are ignored in favor of `.env`.

Run `npm run doctor` to verify browser-use can resolve your LLM config before executing UI tests. Doctor also **probes your Azure deployment** and reports which token-limit field it accepts.

---

## `resources/config/llm-models.json`

Different model families expect different chat-completion fields. Example: **gpt-5.x** on Azure requires `max_completion_tokens`, not `max_tokens`.

WebPilot resolves payload shape in `src/core/llmCapabilities.ts` and
`src/integrations/browser_use/llm_capabilities.py` using:

1. **Per-deployment overrides** in `overrides`
2. **Family patterns** in `families` (e.g. `gpt-5`, `o1`)
3. **Defaults** for older models

Example override after `npm run doctor` suggests one:

```json
{
  "overrides": {
    "gpt-5.4": { "tokenLimitField": "max_completion_tokens" }
  }
}
```

If you switch deployments or providers, run `npm run doctor` again — do not rely on one hardcoded payload for all models.

Other providers (`google`, `openai`, `anthropic`, `ollama`, `aws`, `gcp`) are available for alternate code paths.

Reporting (HTML, JSON, artifacts): [REPORTING.md](./REPORTING.md).

---

## Environment files

Example `resources/config/environments/qa.json`:

```json
{
  "environment": "qa",
  "baseUrl": "https://automationexercise.com",
  "apiBaseUrl": "https://qa-api.example.com",
  "credentials": {
    "username": "${QA_USERNAME}",
    "password": "${QA_PASSWORD}"
  },
  "variables": {
    "timeout": 30000,
    "retry": 2
  }
}
```

`${VAR}` syntax is replaced from `process.env` at runtime.

---

## Prompts (editable without code changes)

| Path | Used for |
|------|----------|
| `resources/prompts/browser-use/codegen.md` | Playwright codegen from execution history |
| `resources/prompts/codegen/` | TypeScript fix / agent prompts |
| `resources/prompts/shared/` | Locator rules, framework guidelines, site catalogs |
| `resources/prompts/reports/` | AI analysis text in HTML reports |

---

## What not to commit

Keep real secrets out of git. These stay local or in CI secret stores:

- `.env` with real API keys (`.env.example` is safe to commit)
- Filled-in secrets inside `resources/config/llm.json` if you replace placeholders with live keys

Generated output is gitignored: `runtime/reports/`, `runtime/artifacts/`, `runtime/healing-cache/`, `runtime/playwright-report/`, `runtime/test-results/`.
