# 10. Full OpenAPI / Swagger API Automation

## Goal

Turn a Swagger/OpenAPI URL or file into **complete** API automation: every (non-deprecated) operation, request bodies, response JSON Schema validation, auth wiring, optional negatives, Playwright codegen, and web-parity reports (`_summary.json` + HTML) so ADO/coverage work for API runs.

## User commands

```bash
# Full suite (default)
webpilot import-api https://petstore.swagger.io/v2/swagger.json --mode full

# Smoke sample (legacy behavior)
webpilot import-api ./openapi.yaml --mode smoke

# Split by tag + negatives
webpilot import-api ./openapi.yaml --mode full --split-by tag --negatives

webpilot run tests/api/<title>_openapi.txt --env qa
```

## Deliverables

| Artifact | Path |
|----------|------|
| NL suite | `tests/api/*_openapi.txt` |
| Schema sidecars | `tests/api/schemas/<operationId>.json` |
| Codegen client | `packages/test-framework/apis/*.ts` |
| Codegen specs | `packages/test-framework/tests/api/*.api.spec.ts` |
| Summary | `runtime/reports/data/summaries/<slug>_summary.json` |
| HTML | via `generateExecutionReports` |

## Implementation modules

- `src/core/api/OpenApiSuiteBuilder.ts` — contract compiler
- `src/core/api/OpenApiLoader.ts` — fetch/validate spec
- `src/core/api/ApiTestParser.ts` — NL + schemaRef / statusIn / @auth / @var
- `src/core/api/ApiCodegenService.ts` — bodies + schema asserts + tag describes
- `src/core/ApiEngine.ts` — auth headers, `_summary.json`, HTML, history, ADO hook
- `packages/test-framework/core/BaseAPI.ts` — `assertStatusIn`, Ajv `strict: false`
- `packages/test-framework/core/ApiContext.ts` — schema sidecar resolve, auth helpers

## Safety

- `import-api` only writes files; it does not execute mutating calls.
- Prefer disposable / QA `apiBaseUrl` for POST/PUT/DELETE.
- Deprecated ops skipped unless `--include-deprecated`.

## Exit criteria

1. `--mode full` emits steps for every non-deprecated operation.
2. Response schemas validate via Ajv when present in the spec.
3. Generated Playwright specs include status + schema checks.
4. API runs write `_summary.json` usable by `webpilot ado publish-results`.
5. `--mode smoke` remains available.
