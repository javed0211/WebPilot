# 13. Fixture & Test-Data Lifecycle

## Goal

Make setup, seed, auth-state, isolation, teardown, and failure cleanup a **first-class, auditable lifecycle** shared by UI, API, replay, and generated Playwright tests.

## User Problem

Flaky automation often comes from shared credentials, leftover seeded data, leaked browsers, and secrets in reports — not selectors. WebPilot previously had auth detection inside a live Browser Use session, but no durable fixture contract, no cleanup stack across engines, and no storage-state auth cache.

## How to use

Reference a manifest from a scenario:

```text
Test: Checkout with seeded user
fixture: fixtures/checkout.yaml
target: web

1. Navigate to https://example.com/
2. Verify the home page is visible
```

Declaring `fixture:` opts the scenario into the lifecycle (even when `features.fixtureLifecycle` is false).

### Manifest example

```yaml
schemaVersion: 1
name: checkout-user
seed:
  provider: static-json
  path: fixtures/data/checkout-user.json
auth:
  provider: playwright-storage-state
  profile: standard-user
  ttlMinutes: 240
isolation:
  strategy: per-run
failureCleanup:
  enabled: true
redaction:
  fields: [email, password, token]
```

Providers:

| Provider | Role |
|----------|------|
| `static-json` | Merge JSON into scenario variables |
| `temp-dir` | Create per-run temp directory under `runtime/fixtures/tmp/` (cleaned on teardown) |
| `http-seed` | POST seed resource; register DELETE cleanup from response id |
| `playwright-storage-state` | Apply existing storage-state file (never reported) |

## Product Scope

### Phase A — shipped

- `FixtureManifest` type contract + YAML parser with path confinement
- `CleanupStack` (LIFO, idempotent drain)
- Scenario metadata `fixture: path/to.yaml`
- Feature flag `features.fixtureLifecycle` + scenario opt-in
- `SecretRegistry` for report redaction
- Providers: static-json, temp-dir, http-seed, playwright-storage-state
- `FixtureLifecycleManager` wired into `Engine` and `ApiEngine`
- Example manifests under `fixtures/`

### Phase B — next

- Generated Playwright `webpilotTest` fixtures
- Browser-use lifecycle adapter (Node owns teardown)
- Auth-state capture helper (`webpilot auth save`)
- Crash scavenger for abandoned leases

## V1 exclusions

- Arbitrary shell / inline JS hooks
- Distributed fixture pools
- Automatic production data creation without environment policy
- Embedding storage-state contents in reports

## Implementation Status

- [x] Types + CleanupStack + feature flag
- [x] Scenario `fixture` metadata parsing
- [x] Manifest parser + providers
- [x] Auth-state apply (existing file)
- [x] Wire into Engine / ApiEngine / CLI
- [x] Unit tests (`npm run test:fixture-lifecycle`)
- [ ] Generated framework fixtures
- [ ] Auth-state capture CLI

## Critical Files

- `src/core/lifecycle/FixtureTypes.ts`
- `src/core/lifecycle/FixtureManifestParser.ts`
- `src/core/lifecycle/FixtureLifecycleManager.ts`
- `src/core/lifecycle/SecretRegistry.ts`
- `src/core/lifecycle/providers/*`
- `src/core/Engine.ts`
- `src/core/ApiEngine.ts`
- `fixtures/checkout.yaml`

## Exit Criteria

1. Setup failure still runs registered cleanups.
2. Temp-dir provider removes the directory on teardown.
3. Storage state path is applied to BrowserManager but never written into reports.
4. API result JSON is redacted via SecretRegistry when a fixture is active.
5. Fixture paths cannot escape the project root.
