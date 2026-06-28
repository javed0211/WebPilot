# Browser Providers

WebPilot normalizes browser backends behind a **provider model**. The same `.txt` scenario can target local Chrome, legacy Playwright, or remote cloud sessions.

---

## Overview

```bash
webpilot run tests/web/foo.txt --provider <name>
```

Active provider is resolved from (highest priority first):

1. CLI `--provider`
2. `WEBPILOT_BROWSER_PROVIDER` env var
3. `browserProviders.active` in `webpilot.yaml`
4. Legacy `framework.useBrowserUse` / `browser.testmu.enabled`

---

## Runnable providers

| Provider | Status | Description |
|----------|--------|-------------|
| `browser-use` | **Default** | AI-native intelligent runner; local Chrome/Chromium/Edge |
| `local-playwright` | Implemented | Legacy TypeScript Engine + Playwright (no browser-use agent) |
| `testmu` | Implemented | Remote TestMu/LambdaTest via CDP through browser-use |

### `browser-use` (recommended for authoring)

```bash
webpilot run tests/web/foo.txt --provider browser-use --headed
```

- Intelligent runner with site knowledge
- Scoped LLM only for unknown steps
- Records video, trace, execution history
- Requires Python venv (`webpilot setup`) and LLM credentials

Config:

```yaml
browserProviders:
  active: "browser-use"
  browser-use:
    browserName: "chrome"   # chrome | chromium | msedge
    headless: false

browser:
  target: "chrome"
  video: "on"
  trace: "on"
```

### `local-playwright`

```bash
webpilot run tests/web/foo.txt --provider local-playwright
```

- TypeScript multi-agent engine (`PlannerAgent`, `ExecutionAgent`, `HealingAgent`)
- No Python browser-use required
- Useful for debugging legacy path or environments without LLM

### `testmu`

```bash
export TESTMU_USERNAME=...
export TESTMU_ACCESS_KEY=...
webpilot run tests/web/foo.txt --provider testmu
```

Remote browser session via CDP WebSocket. Browser-use agent runs against the remote session.

Config:

```yaml
browserProviders:
  testmu:
    enabled: true
    username: "${TESTMU_USERNAME}"
    accessKey: "${TESTMU_ACCESS_KEY}"
    adapter: "puppeteer"
    browserName: "Chrome"
    platform: "Windows 10"
```

---

## Config-only providers (doctor validates, run deferred)

| Provider | Config key | Env var |
|----------|------------|---------|
| Remote CDP | `remote-cdp` | `REMOTE_CDP_URL` |
| Selenium Grid | `selenium-grid` | `SELENIUM_GRID_URL` |
| BrowserStack | `browserstack` | Planned |
| LambdaTest | `lambdatest` | Planned |

These appear in `webpilot doctor` but are not yet selectable for `webpilot run`.

---

## Full configuration example

```yaml
browserProviders:
  active: "browser-use"
  local-playwright:
    browserName: "chromium"
    headless: true
  browser-use:
    browserName: "chrome"
    headless: false
  remote-cdp:
    endpoint: "${REMOTE_CDP_URL}"
  selenium-grid:
    endpoint: "${SELENIUM_GRID_URL}"
  testmu:
    enabled: false
    username: "${TESTMU_USERNAME}"
    accessKey: "${TESTMU_ACCESS_KEY}"
```

---

## Choosing a provider

| Goal | Provider |
|------|----------|
| SDET authoring, learning locators | `browser-use` |
| Fast knowledge-only replay | `browser-use` + `--knowledge-only` |
| CI regression on generated specs | `webpilot replay` (not a provider — plain Playwright) |
| Legacy TS engine debugging | `local-playwright` |
| Cross-browser cloud matrix | `testmu` (today); BrowserStack/LambdaTest planned |

---

## Doctor checks

```bash
webpilot doctor --provider browser-use
webpilot doctor --json
```

Validates:

- Node, npm, Playwright browsers
- Python venv and vendored browser-use
- LLM credentials for active provider
- Provider-specific env vars (TestMu, CDP, Grid)
- Writable `runtime/` directories

---

## Viewport scaling

```bash
WEBPILOT_VIEWPORT_SCALE=1.5 webpilot run tests/web/foo.txt
```

Scales browser viewport for high-DPI or accessibility testing.

---

## See also

- [Execution & Replay](./execution-and-replay.md)
- [CONFIGURATION.md](../CONFIGURATION.md)
- [features/06-browser-provider-matrix.md](../features/06-browser-provider-matrix.md)
