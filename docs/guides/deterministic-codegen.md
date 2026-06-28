# Deterministic Codegen

Turn a successful natural-language browser run into **reviewable, CI-ready Playwright code** — without LLM calls during generation.

---

## Overview

Codegen is the **promotion step** in the SDET workflow:

```text
.txt exploration (live)  →  execution trace  →  generation plan  →  Playwright POM + spec
```

Generated tests run with `npx playwright test` or `webpilot replay` — no LLM credentials required.

---

## When codegen runs

| Trigger | Command |
|---------|---------|
| After successful run | `webpilot run tests/web/foo.txt --codegen` |
| From saved trace | `webpilot generate --from latest` |
| Scenario metadata | `codegen: true` in the `.txt` file header |

By default, `webpilot run` **skips** codegen. You must opt in with `--codegen` or metadata.

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

Emits TypeScript (or profile-specific code) without LLM:

- Page object methods with ranked selectors
- Spec file calling page objects
- Import management and AST merge for existing files
- Selector confidence comments in generated code

**Source files:** `DeterministicSpecWriter.ts`, `DeterministicPageObjectWriter.ts`, `DeterministicCodegenPipeline.ts`

**Output:** `packages/test-framework/pages/`, `packages/test-framework/tests/`

### 4. Validation

```bash
npm run build
npx playwright test <generated-spec> --reporter=line
```

On failure with `codegenMode: auto`, WebPilot may fall back to LLM codegen (`CodegenAgent`).

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

# Run generated spec in CI
webpilot replay packages/test-framework/tests/checkout.spec.ts
```

---

## How reuse works

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

packages/test-framework/
  pages/                  # Page objects
  tests/                  # Playwright specs
```

---

## Best practices

1. **Run live first, codegen second** — let the intelligent runner learn locators before promoting to CI scripts.
2. **Review generated diffs** — treat output like a PR from a junior SDET; edit naming and assertions as needed.
3. **Commit POMs, not runtime/** — `runtime/` is local learned state; `packages/test-framework/` is what CI runs.
4. **Re-generate when trace changes** — if you `--force-discovery` and steps change, run `--codegen` again.
5. **Use `webpilot replay` in CI** — faster and more deterministic than live `.txt` runs in pipelines.

---

## Limitations

| Limitation | Workaround |
|------------|------------|
| Full scaffold only for TypeScript Playwright | Other profiles emit code; see [Multi-Language Codegen](./multi-language-codegen.md) |
| Codegen skipped by default on `run` | Pass `--codegen` or set `codegen: true` in scenario |
| Unchanged re-runs still queue codegen with `--codegen` | Roadmap: skip when trace unchanged |

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

- [Execution & Replay](./execution-and-replay.md)
- [Repository Knowledge Graph](./repository-knowledge-graph.md)
- [Assertion Engine](./assertion-engine.md)
- [features/01-deterministic-generated-test-pipeline.md](../features/01-deterministic-generated-test-pipeline.md)
