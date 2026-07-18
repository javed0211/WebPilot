# API Testing

WebPilot supports **HTTP API scenarios** in natural language — parallel to web UI tests but without a browser. With **full OpenAPI/Swagger import**, a spec URL becomes a complete automation suite (all operations, bodies, schema validation, auth, codegen, reports).

---

## Overview

| Aspect | Web UI | API |
|--------|--------|-----|
| Test location | `tests/web/*.txt` | `tests/api/*.txt` |
| Engine | browser-use / Playwright | `ApiEngine` + Playwright `APIRequestContext` |
| Browser required | Yes | No |
| Codegen output | POM + spec | API class + `.api.spec.ts` |
| From OpenAPI | — | `webpilot import-api` (`--mode full` \| `smoke`) |

---

## Full OpenAPI / Swagger import

```bash
# All non-deprecated operations + schema sidecars (default)
webpilot import-api https://petstore.swagger.io/v2/swagger.json --mode full

# Quick smoke (sample GETs only)
webpilot import-api ./openapi.yaml --mode smoke

# One file per OpenAPI tag + negative contract cases
webpilot import-api ./openapi.yaml --mode full --split-by tag --negatives

# Filter operations
webpilot import-api ./openapi.yaml --operations "GET /pet/{petId},POST /pet"
```

What full mode generates:

| Item | Detail |
|------|--------|
| Steps | Every non-deprecated operation |
| Bodies | From `requestBody` example / schema synthesis |
| Asserts | Status (+ `statusIn` when multiple 2xx) |
| Schemas | Ajv validation via `tests/api/schemas/<op>.json` |
| Auth | `@auth bearer AUTH_TOKEN` (or apiKey / basic from `securitySchemes`) |
| Seeds | `@var petId="1"` style path/query placeholders |

Then run:

```bash
export AUTH_TOKEN=…   # if the API requires it
webpilot run tests/api/petstore_openapi_full.txt --env qa
```

Successful runs write `_summary.json` + HTML (web parity) and generate Playwright clients under `packages/test-framework/apis/`.

See [Feature 10](../features/10-api-openapi-full-suite.md).

---

## Write an API scenario by hand

```text
@smoke @api
target: api
baseUrl: https://petstore.swagger.io/v2

Test: Get pet by ID

1. Send GET request to /pet/1
2. Assert status is 200
3. Assert response body contains pet id 1
```

Or the structured verbs used by OpenAPI import:

```text
Send GET request to {{apiBaseUrl}}/pet/{{petId}}
With Headers {"Accept":"application/json"}
Assert response schema schemas/getpetbyid.json
Assert status is 200
```

---

## Run API tests

```bash
webpilot run tests/api/petstore_smoke.txt --env qa
webpilot run tests/api/ --env qa
```

API runs do not require Python browser-use (unless mixed web-api target).

---

## Codegen

When `framework.apiCodegenEnabled: true` (default), successful API runs generate:

```text
packages/test-framework/apis/<Suite>Api.ts
packages/test-framework/tests/api/<suite>.api.spec.ts
```

Specs are grouped by OpenAPI tag (`test.describe` per tag) with schema/status asserts.

---

## Configuration

```yaml
framework:
  apiCodegenEnabled: true
  useApiPlaywright: true

api:
  openapi:
    importMode: full          # full | smoke
    generateNegatives: false
    splitBy: none             # none | tag
    schemaSidecars: true
  auth:
    bearerEnv: AUTH_TOKEN
    apiKeyEnv: API_KEY

project:
  target: api                 # or web-api
```

Environments: `resources/config/environments/<env>.json` for `apiBaseUrl` / `baseUrl`.

---

## Authentication & variables

- Bearer: `AUTH_TOKEN` (or `@auth bearer MY_TOKEN`)
- API key: `API_KEY` header/query from OpenAPI `apiKey` schemes
- Basic: `API_BASIC_AUTH` as `user:pass` or pre-encoded base64
- Chained extracts: `Extract response id into petId`
- `@var name=value` seeds in imported suites

---

## Reporting

API runs produce:

- `runtime/reports/data/summaries/<slug>_summary.json` (`PASSED` / `FAILED`)
- Timestamped JSON under `runtime/reports/data/api/`
- HTML via the shared execution report pipeline
- History snapshots for flake / ADO publish

Map API tests in `resources/config/ado-test-map.yaml` and use `webpilot ado publish-results`.

---

## Key source files

| File | Role |
|------|------|
| `src/core/ApiEngine.ts` | Orchestration, reports, auth |
| `src/core/api/OpenApiSuiteBuilder.ts` | Full OpenAPI → suite compiler |
| `src/core/api/OpenApiLoader.ts` | Fetch/validate OpenAPI |
| `src/core/api/ApiTestParser.ts` | Parse `.txt` / OpenAPI |
| `src/core/api/ApiCodegenService.ts` | Playwright codegen |
| `packages/test-framework/core/BaseAPI.ts` | HTTP + Ajv schema asserts |

---

## See also

- [Feature 10 — Full OpenAPI suite](../features/10-api-openapi-full-suite.md)
- [CLI Reference](./cli-reference.md)
- [ADO Test Plans](./ado-test-plans.md)
