# WebPilot configuration reference

---

## File map

| File | Purpose |
|------|---------|
| `config/webpilot.yaml` | Framework defaults: browser-use, reports, browser, execution |
| `config/llm.json` | LLM providers and models (placeholders in repo; add keys locally) |
| `config/environments/*.json` | Per-environment URLs and credentials |
| `.env` | Optional local secrets (copy from `.env.example`; not required in repo) |

---

## `config/webpilot.yaml`

Key settings:

```yaml
framework:
  activeProvider: azure          # LLM provider key in llm.json
  defaultEnvironment: qa
  useBrowserUse: true            # true = Python browser-use path; false = legacy Engine + Playwright
  htmlReport: true               # Write reports/index.html after browser-use runs
  htmlReportAiAnalysis: true     # LLM quality section in HTML reports
  generatedCodePath: "./framework"
  validationRetries: 3

browser:
  target: chrome                 # chrome | chromium | msedge
  headless: false                # false = visible browser (or use CLI --headed)
  video: on                      # on | off | retain-on-failure
  trace: on
  viewport: { width: 1280, height: 720 }
```

---

## `config/llm.json`

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

`browser_use_runner.py` also reads `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, and related env vars from the shell / `.env`.

Other providers (`google`, `openai`, `anthropic`, `ollama`, `aws`, `gcp`) are available for alternate code paths.

---

## Environment files

Example `config/environments/qa.json`:

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
| `prompts/browser-use/codegen.md` | Playwright codegen from execution history |
| `prompts/codegen/` | TypeScript fix / agent prompts |
| `prompts/shared/` | Locator rules, framework guidelines, site catalogs |
| `prompts/reports/` | AI analysis text in HTML reports |

---

## What not to commit

Keep real secrets out of git. These stay local or in CI secret stores:

- `.env` with real API keys (`.env.example` is safe to commit)
- Filled-in secrets inside `config/llm.json` if you replace placeholders with live keys

Generated output is gitignored: `reports/`, `artifacts/`, `healing-cache/`, `playwright-report/`, `test-results/`.
