# API Testing

WebPilot supports **HTTP API scenarios** in natural language — parallel to web UI tests but without a browser.

---

## Overview

| Aspect | Web UI | API |
|--------|--------|-----|
| Test location | `tests/web/*.txt` | `tests/api/*.txt`, `.yaml`, `.json` |
| Engine | browser-use / Playwright | `ApiEngine` + Playwright `APIRequestContext` |
| Browser required | Yes | No |
| Codegen output | POM + spec | API class + `.api.spec.ts` |

---

## Write an API scenario

```text
@smoke @api
target: api
baseUrl: https://petstore.swagger.io/v2

Test: Get pet by ID

1. Send GET request to /pet/1
2. Verify response status is 200
3. Verify response body contains pet id 1
```

Or YAML/JSON formats for structured requests — see `tests/api/` examples.

---

## Run API tests

```bash
webpilot run tests/api/petstore-single-get.txt --env qa
webpilot run tests/api/ --parallel 2
```

API runs do not require Python browser-use (unless mixed web-api target).

---

## Import from OpenAPI

```bash
webpilot import-api https://petstore.swagger.io/v2/swagger.json
webpilot import-api ./openapi.yaml --out tests/api/petstore_generated.txt
```

Generates a natural-language scenario from OpenAPI operations.

---

## Codegen

When `framework.apiCodegenEnabled: true` (default), successful API runs generate:

```text
packages/test-framework/apis/PetstoreSingleGetApi.ts
packages/test-framework/tests/api/petstore-single-get.api.spec.ts
```

Uses the same deterministic pipeline as UI tests where applicable.

---

## Configuration

```yaml
framework:
  apiCodegenEnabled: true
  useApiPlaywright: true   # Playwright request API (not axios)

project:
  target: api              # or web-api for mixed projects
```

Environments: `resources/config/environments/<env>.json` for `baseUrl` and auth tokens.

---

## Authentication & variables

API scenarios support:

- Bearer tokens from environment variables
- Chained requests (token from login → subsequent calls)
- Variable substitution in paths and bodies

See existing examples:

- `tests/api/api-authenticated-token-chaining.txt`
- `packages/test-framework/apis/ApiAuthenticatedTokenChainingApi.ts`

---

## Reporting

API runs produce:

- JSON summary in `runtime/reports/data/summaries/`
- Execution logs

Full HTML report parity with UI tests is **partial** — JSON artifacts are the primary API reporting path today.

---

## Key source files

| File | Role |
|------|------|
| `src/core/ApiEngine.ts` | API test orchestration |
| `src/core/api/ApiTestParser.ts` | Parse `.txt` API scenarios |
| `src/core/api/OpenApiLoader.ts` | OpenAPI import |
| `src/core/api/ApiCodegenService.ts` | API code generation |

---

## See also

- [Test Authoring](./test-authoring.md)
- [Deterministic Codegen](./deterministic-codegen.md)
- [USAGE.md](../USAGE.md)
