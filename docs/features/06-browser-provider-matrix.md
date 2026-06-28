# 06. Browser Provider Matrix

## Goal

Run the same WebPilot scenario across local browsers, remote CDP, Selenium Grid, and cloud providers.

## User Problem

Serious automation teams need local debugging, CI headless runs, and cloud/browser matrix coverage.

## Provider Types

| Provider | Use Case |
|----------|----------|
| local-playwright | default local/CI runs |
| browser-use | AI-native exploration |
| remote-cdp | managed Chrome sessions |
| selenium-grid | enterprise Selenium infrastructure |
| browserstack | cloud browser matrix |
| lambdatest | cloud browser matrix |
| testmu | existing WebPilot/TestMu path |

## Configuration

Proposed:

```yaml
browserProviders:
  active: "local-playwright"
  local-playwright:
    browserName: "chromium"
    headless: true
  remote-cdp:
    endpoint: "${REMOTE_CDP_URL}"
  selenium-grid:
    endpoint: "${SELENIUM_GRID_URL}"
  testmu:
    enabled: false
    username: "${TESTMU_USERNAME}"
    accessKey: "${TESTMU_ACCESS_KEY}"
```

## Product Scope

The browser provider matrix supports:

- Normalize current local Playwright/browser-use/TestMu config into provider model.
- `webpilot doctor` provider checks.
- `webpilot run --provider <name>`.

Deferred for later:

- BrowserStack/LambdaTest full integration.
- Parallel matrix execution.

## Implementation Notes

Implemented in `src/core/browserProviders/`:

- `BrowserProvider.ts` — provider, session, and doctor check types.
- `BrowserProviderRegistry.ts` — resolves `browserProviders.active`, `WEBPILOT_BROWSER_PROVIDER`, and legacy `browser.testmu`.

Provider execution support:

- `local-playwright` runs the existing Playwright-driven Engine path.
- `browser-use` runs the existing browser-use path.
- `testmu` runs the existing TestMu CDP path through browser-use.
- `remote-cdp`, `selenium-grid`, `browserstack`, and `lambdatest` are represented and validated, but direct run integration is deferred.

Configuration:

```yaml
browserProviders:
  active: "browser-use"
  local-playwright:
    browserName: "chromium"
    headless: true
  browser-use:
    browserName: "chrome"
    headless: false
  testmu:
    enabled: false
    username: "${TESTMU_USERNAME}"
    accessKey: "${TESTMU_ACCESS_KEY}"
    browserName: "Chrome"
    browserVersion: "latest"
    platform: "Windows 10"
```

CLI:

```bash
webpilot run tests/web/login.txt --provider local-playwright
webpilot run tests/web/login.txt --provider browser-use
webpilot run tests/web/login.txt --provider testmu
webpilot doctor --provider testmu
```

Reports:

- HTML reports show provider, browser name/version, platform, and session id fields.
- Summary JSON stores `browser.provider`.
- Run history snapshots store `browserProvider`.

Verification:

```bash
npm run build
node scripts/test-feature-06.cjs
```

## Original Plan

### Phase 1: Provider Interface

Create:

- `BrowserProvider`
- `BrowserProviderRegistry`
- `BrowserSessionInfo`

### Phase 2: Existing Provider Migration

Wrap:

- Local Playwright.
- Browser-use.
- TestMu CDP.

### Phase 3: CLI Support

```bash
webpilot run tests/web/login.txt --provider local-playwright
webpilot run tests/web/login.txt --provider testmu
webpilot doctor --provider testmu
```

### Phase 4: Reports

Reports should show:

- Provider.
- Browser name/version.
- Platform.
- Session id.
- Cloud video/log links when available.

## Tests

Unit tests:

- Provider config resolves env vars.
- Missing provider credentials fail doctor.
- Unknown provider returns clear error.

Integration tests:

- Local Playwright run.
- Browser-use run.
- TestMu config validation with missing credentials.

## Exit Criteria

- Browser provider selection is explicit. **Done**
- Existing browser-use/TestMu behavior remains compatible. **Done**
- Reports identify the browser provider used for each run. **Done**

