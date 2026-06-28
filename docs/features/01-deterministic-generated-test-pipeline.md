# 01. Deterministic Generated Test Pipeline

## Goal

Turn an AI-executed natural-language browser flow into deterministic, reviewable automation code that can run in CI without an LLM.

WebPilot should not only "drive a browser with AI." It should produce stable tests that look like a senior automation engineer wrote them.

## User Problem

AI browser execution is useful for exploration, but teams cannot rely on nondeterministic agent behavior in CI.

Users need:

- Natural-language exploration for speed.
- Generated code for review and maintenance.
- Replay without LLM credentials.
- Reports and traces for every run.
- Clear separation between discovery, code generation, and deterministic execution.

## Proposed Commands

```bash
webpilot run tests/web/checkout.txt --codegen
webpilot generate --from runtime/executions/latest
webpilot replay packages/test-framework/tests/checkout.spec.ts
```

Longer-term command shape:

```bash
webpilot explore "login and checkout"
webpilot generate
webpilot run
webpilot replay
```

## Core Concepts

### Execution Trace

The AI/browser-use run should produce a normalized execution trace:

```json
{
  "scenario": "login and checkout",
  "targetUrl": "https://example.com",
  "steps": [
    {
      "intent": "click login",
      "action": "click",
      "selector": { "kind": "role", "value": "button[name='Login']" },
      "url": "https://example.com",
      "before": {},
      "after": {},
      "assertions": []
    }
  ]
}
```

The trace becomes the contract between agent execution and generated code.

### Generation Plan

Before writing files, WebPilot should build a generation plan:

```json
{
  "profile": {
    "language": "typescript",
    "automationTool": "playwright",
    "frameworkPattern": "pom"
  },
  "files": [
    {
      "path": "packages/test-framework/pages/LoginPage.ts",
      "operation": "extend",
      "reason": "existing page object matched URL /login"
    }
  ]
}
```

### Deterministic Replay

Generated tests must run without:

- LLM credentials.
- Browser-use agent planning.
- Natural-language interpretation.

AI should only re-enter during optional healing.

## MVP Scope

MVP should support:

- TypeScript + Playwright.
- POM pattern.
- One natural-language input file.
- One generated spec file.
- Extend existing page objects when a match is found in `webpilot graph`.
- Run `npm run build` and Playwright validation after generation.

MVP can defer:

- Multi-language generation.
- BDD.
- Screenplay.
- Multi-browser matrix.
- Advanced assertion synthesis.

## Implementation Plan

### Phase 1: Trace Schema

Add a normalized trace schema under `src/core/codegen/`.

Files:

- `src/core/codegen/ExecutionTrace.ts`
- `src/core/codegen/GenerationPlan.ts`

Trace sources:

- Browser-use execution history.
- Current Playwright execution history.
- API runner history later.

### Phase 2: Trace Builder

Create a trace builder that converts raw execution history into stable actions.

Responsibilities:

- Normalize click/fill/select/navigation/assert actions.
- Preserve action intent.
- Attach selectors and fallback selectors.
- Attach screenshots/video/trace references.
- Detect target page URL and page object candidate.

### Phase 3: Plan Builder

Use `RepoKnowledgeGraph` to decide:

- Reuse existing page object.
- Extend existing page object.
- Create new page object.
- Create or update spec file.

Rules:

- Prefer existing class with matching `urlPattern` or page identity.
- Prefer methods with matching semantic action names.
- Avoid duplicate page objects.
- Avoid duplicate test files for same scenario slug.

### Phase 4: Writer

Build a deterministic writer:

- Page object writer.
- Spec writer.
- Imports manager.
- Existing file extension through AST merge where supported.

For TypeScript, use the existing TypeScript compiler AST path and `ASTMerger`.

### Phase 5: Validation

Validation should run:

```bash
npm run build
npx playwright test <generated-spec> --reporter=line
```

On failure:

- Attempt one repair pass using the compiler/test error.
- Keep the diff minimal.

## Data Model

### Generated File Metadata

```json
{
  "generatedBy": "webpilot",
  "scenarioSlug": "checkout-flow",
  "sourceTrace": "runtime/executions/checkout-flow/trace.json",
  "profile": "typescript-playwright-pom",
  "updatedAt": "..."
}
```

Store metadata in:

```text
runtime/codegen/history/
```

## Tests

Unit tests:

- Trace builder normalizes raw actions.
- Plan builder reuses matching page object.
- Plan builder creates new page object when no match exists.
- Writer avoids duplicate imports.
- Writer avoids duplicate methods.

Integration tests:

- Generate from a recorded AutomationExercise flow.
- Generated TypeScript compiles.
- Generated Playwright test runs.
- Replay does not require LLM env vars.

## Exit Criteria

- A natural-language AutomationExercise flow can generate a passing Playwright test.
- The generated test can run without LLM credentials.
- Existing page objects are reused instead of recreated.
- Generated files are stable across repeated runs when input trace has not changed.
- Report links point to the generated deterministic test.

## Implementation Status

Started in WebPilot codebase:

- [x] `ExecutionTrace` and `GenerationPlan` schemas (`src/core/codegen/`)
- [x] `TraceBuilder` normalizes raw execution history into stable trace steps
- [x] `PlanBuilder` uses `RepoKnowledgeGraph` to reuse/extend page objects
- [x] `DeterministicCodegenPipeline` persists trace/plan/metadata under `runtime/codegen/`
- [x] `DeterministicSpecWriter` emits Playwright specs without LLM calls
- [x] `webpilot generate --from <slug|latest>` CLI command
- [x] Engine persists trace/plan after browser-use and Playwright execution paths
- [x] Playwright Engine path uses deterministic codegen by default (`framework.codegenMode` / `WEBPILOT_CODEGEN_MODE`)
- [x] `DeterministicPageObjectWriter` generates page objects for new routes and extends existing ones
- [x] Report metadata links to generated spec, page objects, trace/plan, and replay command

