# Deterministic Codegen

Turn a successful natural-language browser run into **reviewable, CI-ready test code** — without LLM calls during generation.

The output language and framework depend on your `webpilot init` profile (TypeScript Playwright, Python Playwright, Java Selenium, Cypress, WebdriverIO, C# Selenium, C# Playwright). See [Multi-Language Codegen](./multi-language-codegen.md).

---

## Overview

Codegen is the **promotion step** in the SDET workflow:

```text
.txt exploration (live)  →  execution trace  →  generation plan  →  spec + page objects (profile-aware)
```

Generated tests run with the profile's replay command (`webpilot replay` for TypeScript Playwright, `pytest`, `mvn test`, `wdio run`, `dotnet test`, etc.) — no LLM credentials required for replay.

---

## When codegen runs

| Trigger | Command |
|---------|---------|
| After **successful** run | `webpilot run tests/web/foo.txt --codegen` |
| From saved trace | `webpilot generate --from latest` |
| Scenario metadata | `codegen: true` in the `.txt` file header |

By default, `webpilot run` **skips** codegen. You must opt in with `--codegen` or metadata.

**Failed executions never generate code.** If discovery fails, WebPilot prints that codegen was skipped and exits failed — it will not write POMs/specs from a failed ActHistory. See [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md).

---

## Pipeline stages

### 1. Execution trace

Raw browser history is normalized into a stable trace:

```json
{
  "scenario": "booking_search_hotels",
  "steps": [
    {
      "intent": "Enter London in destination field",
      "action": "fill",
      "selector": { "kind": "role", "value": "textbox", "name": "Where are you going?" },
      "confidence": 0.91,
      "fallbacks": []
    }
  ]
}
```

**Source files:** `src/core/codegen/ExecutionTrace.ts`, `TraceBuilder.ts`

**Artifacts:** `runtime/codegen/traces/<slug>.json`

### 2. Generation plan

WebPilot consults the repository knowledge graph to decide:

- Reuse existing page object (matching `urlPattern`)
- Extend existing page object (add method)
- Create new page object
- Create or update spec file

**Source files:** `PlanBuilder.ts`, `RepoKnowledgeGraph.ts`

**Artifacts:** `runtime/codegen/plans/<slug>.json`

### 3. Deterministic writer

Emits code for the active profile without LLM:

- Page object methods with ranked selectors
- Spec file calling page objects
- Import management and merge for existing files
- Selector confidence comments in generated code

**Source files:** profile modules under `src/core/codegen/profiles/`, `DeterministicCodegenPipeline.ts`

**Output (varies by profile):**

| Profile | Typical paths |
|---------|----------------|
| TypeScript Playwright | `packages/test-framework/pages/`, `packages/test-framework/tests/` |
| Python Playwright | `tests/generated/pages/`, `tests/generated/` |
| Java Selenium | `src/test/java/webpilot/generated/` |
| Cypress | `cypress/support/pages/`, `cypress/e2e/generated/` |
| WebdriverIO | `test/pageobjects/`, `test/specs/generated/` |
| C# Selenium / Playwright | `tests/WebPilot.Tests/Generated/` or `tests/WebPilot.Playwright.Tests/Generated/` |

### 4. Validation

Validation is **profile-aware**. Examples:

```bash
# TypeScript Playwright
npm run build
npx playwright test <generated-spec> --reporter=line

# Python Playwright
python -m compileall -q tests/generated

# Java Selenium
mvn -q test-compile

# Cypress / WebdriverIO
npx tsc --noEmit

# C# Selenium / Playwright
dotnet build tests/WebPilot.Tests/WebPilot.Tests.csproj
dotnet build tests/WebPilot.Playwright.Tests/WebPilot.Playwright.Tests.csproj
```

TypeScript Playwright may fall back to LLM codegen (`CodegenAgent`) on validation failure when `codegenMode: auto`. Other profiles run the profile validation command and surface errors in the terminal.

---

## Codegen modes

Configure in `resources/config/webpilot.yaml`:

```yaml
framework:
  codegenMode: deterministic  # deterministic | llm | auto
  generatedCodePath: "./packages/test-framework"
  validationLoopEnabled: true
  validationRetries: 3
```

| Mode | LLM for file emission | Use when |
|------|----------------------|----------|
| `deterministic` | Never | Default; trace is complete |
| `llm` | Always | Experimental / complex flows |
| `auto` | On validation failure | Balance of stability and recovery |

Environment:

```bash
WEBPILOT_CODEGEN=1
WEBPILOT_CODEGEN_MODE=deterministic
```

---

## CLI reference

```bash
# Run + generate
webpilot run tests/web/checkout.txt --codegen --report

# Regenerate from last trace without re-running browser
webpilot generate --from latest
webpilot generate --from booking_search_hotels

# Skip Playwright validation during generate
webpilot generate --from latest --no-validate

# Run generated spec in CI (TypeScript Playwright)
webpilot replay packages/test-framework/tests/checkout.spec.ts

# Profile-specific replay is also recorded in codegen metadata, e.g.:
# pytest tests/generated/test_checkout.py
# npx wdio run wdio.conf.ts --spec test/specs/generated/checkout.spec.ts
# dotnet test tests/WebPilot.Playwright.Tests/WebPilot.Playwright.Tests.csproj
```

---

## Cursor-style RepoEdit codegen

When deterministic codegen fails validation, WebPilot repairs with **RepoEditCodegenAgent** (default):

1. Lists / reads real files under `packages/test-framework/pages/`
2. Filters ActHistory (drops `search_page`, `extract`, `evaluate`, …)
3. Writes surgical POM/spec updates under `pages/<site>/` (never invents `Www*…Page`)
4. Rejects invented flat page classes in reference validation

Legacy one-shot invent: `WEBPILOT_CODEGEN_LEGACY_AGENT=1`

See [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md).

## How reuse works

### ActHistory (skip rediscovery)

On repeat `--codegen` runs for the same scenario, a **successful** ActHistory may be reused so WebPilot skips browser-use **rediscovery**, then **replays ActHistory in a real browser** before codegen. Failed histories are never reused and never generate code.

```bash
webpilot history list
webpilot history clear foo
webpilot run tests/web/foo.txt --codegen --force-discovery
```

Full rules: [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md).

### Page objects (knowledge graph)

Before creating `BookingHomePage.ts`, WebPilot checks:

1. `webpilot graph` output — `runtime/knowledge/knowledge-graph.json`
2. Existing page objects with matching URL patterns
3. Methods with semantically similar names

This prevents duplicate page objects and encourages extending framework code like a senior SDET would.

```bash
webpilot graph --summary
```

---

## Generated file metadata

Each codegen run records metadata under `runtime/codegen/history/<slug>.json`:

- Source trace path
- Profile (`typescript-playwright-pom`)
- Generated files list
- Replay command
- Assertion summary

HTML reports link to generated spec and page objects when `--report` is used.

---

## API codegen

API test runs can generate:

- `packages/test-framework/apis/<ApiClass>.ts`
- `packages/test-framework/tests/api/<slug>.api.spec.ts`

Enabled via `framework.apiCodegenEnabled: true`.

See [API Testing](./api-testing.md).

---

## Artifacts layout

```text
runtime/codegen/
  traces/<slug>.json      # Normalized execution trace
  plans/<slug>.json       # File operations plan
  history/<slug>.json     # Metadata + replay command
  latest.json             # Pointer to most recent run

# Generated test output (profile-dependent), e.g.:
packages/test-framework/   # TypeScript Playwright
tests/generated/           # Python Playwright
src/test/java/webpilot/    # Java Selenium
cypress/e2e/generated/     # Cypress
test/specs/generated/      # WebdriverIO
tests/WebPilot.Tests/      # C# Selenium
tests/WebPilot.Playwright.Tests/  # C# Playwright
```

---

## Best practices

1. **Run live first, codegen second** — let the intelligent runner learn locators before promoting to CI scripts.
2. **Review generated diffs** — treat output like a PR from a junior SDET; edit naming and assertions as needed.
3. **Commit generated framework code, not `runtime/`** — `runtime/` is local learned state; profile output directories are what CI runs.
4. **Re-generate when trace changes** — if you `--force-discovery` and steps change, run `--codegen` again.
5. **Use the profile replay command in CI** — faster and more deterministic than live `.txt` runs in pipelines.

---

## Limitations

| Limitation | Workaround |
|------------|------------|
| Richest framework scaffold is TypeScript Playwright (`packages/test-framework/`) | Other profiles have full runnable scaffolds; see [Multi-Language Codegen](./multi-language-codegen.md) |
| Codegen skipped by default on `run` | Pass `--codegen` or set `codegen: true` in scenario |
| LLM fallback validation loop is TypeScript Playwright only | Other profiles use compile/build validation |
| Unchanged re-runs still queue codegen with `--codegen` | TypeScript may reuse a passing existing spec; clear history or `--force-discovery` to rediscover |
| Failed runs must not generate code | Enforced — see [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md) |

---

## Key source files

| File | Role |
|------|------|
| `src/core/codegen/DeterministicCodegenPipeline.ts` | Orchestrator |
| `src/core/codegen/TraceBuilder.ts` | History → trace |
| `src/core/codegen/PlanBuilder.ts` | Trace → plan |
| `src/core/codegen/PostExecutionCodegen.ts` | Engine integration |
| `src/agents/CodegenAgent.ts` | LLM fallback |

---

## See also

- [Multi-Language Codegen](./multi-language-codegen.md)
- [ActHistory & Codegen Reuse](./act-history-and-codegen-reuse.md)
- [Execution & Replay](./execution-and-replay.md)
- [Repository Knowledge Graph](./repository-knowledge-graph.md)
- [Assertion Engine](./assertion-engine.md)
- [features/01-deterministic-generated-test-pipeline.md](../features/01-deterministic-generated-test-pipeline.md)
