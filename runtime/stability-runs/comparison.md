# Stability comparison — playwright_page_verification

Date: 2026-07-16

## Discovery + codegen (one shot)

| Phase | Result | Notes |
|-------|--------|-------|
| browser-use discovery | PASSED | ~16 ActHistory steps |
| Deterministic codegen + Playwright validate | FAILED | Bad asserts (`Playwright Test section`), weak `main`-scoped Get started |
| CodegenAgent repair (2 rounds) | FAILED | Same locator issues |
| Manual harden from ActHistory | FIXED | `a[href="/docs/intro"]` + role fallback; heading/text sections |

## Replay matrix (4× each)

| Runner | Run 1 | Run 2 | Run 3 | Run 4 | Pass rate |
|--------|-------|-------|-------|--------|-----------|
| Generated Playwright spec | PASSED (~0.9s) | PASSED (~0.9s) | PASSED (~0.9s) | PASSED (~0.9s) | **4/4** |
| ActHistory Playwright (`webpilot replay --from`) | PASSED (~2s) | PASSED (~1s) | PASSED (~2s) | PASSED (~1s) | **4/4** |

## Does it break on re-execution?

**No** — after hardening locators, both paths are stable across 4 consecutive runs.

Caveats:
- Raw codegen output (before harden) **did** fail validation repeatedly — not flaky, systematically wrong locators/asserts.
- ActHistory replay **skips** `search_page` / `find_text` (informational agent tools), so section verifies are stronger in the generated spec path.
- Logs: `runtime/stability-runs/spec-run-*.log`, `act-run-*.log`, `summary.txt`
