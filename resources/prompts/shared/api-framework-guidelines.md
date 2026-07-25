# WebPilot API automation guidelines

## Stack
- TypeScript + Playwright `APIRequestContext` (not axios for executed tests).
- `BaseAPI` — low-level HTTP helpers and assertions.
- `ApiContext` — variable interpolation + `executeStep()` for NL runners.
- Generated clients under `packages/test-framework/apis/*` compose `BaseAPI` from the `apiClient` fixture.

## Generated layout
| Artifact | Path |
|----------|------|
| API client | `packages/test-framework/apis/<Name>Api.ts` |
| Playwright spec | `packages/test-framework/specs/api/<slug>.api.spec.ts` (older projects: `tests/api/`) |

## Test sources
1. **Plain text** (`tests/api/*.txt`) — `Send GET request to ...`, `Assert status is 200`, `@api` tags.
2. **OpenAPI URL** — first line is swagger/openapi JSON URL, or `@source https://...`.
3. **OpenAPI file** — `.yaml` / `.json` in `tests/api/` or `import-api` output.
4. **LLM fallback** — unstructured prose when regex parsing yields no steps.

## Commands
```bash
npm run webpilot -- run tests/api/login_api.txt --env qa
npm run webpilot -- import-api https://petstore.swagger.io/v2/swagger.json -o tests/api/petstore_smoke.txt
npx playwright test packages/test-framework/specs/api --config=packages/test-framework/playwright.config.ts
```
