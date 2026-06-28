# Repository Knowledge Graph

`webpilot graph` builds an **AST index of your test framework** so codegen reuses existing page objects, methods, and tests instead of duplicating them.

---

## Overview

When WebPilot generates Playwright code, it should behave like a senior SDET:

- Extend `BookingHomePage.ts` instead of creating `BookingHomePage2.ts`
- Reuse `BasePage.navigate()` and shared utilities
- Match page objects by URL pattern and semantic method names

The knowledge graph powers this reuse in the **generation plan** stage of deterministic codegen.

---

## Commands

```bash
# Build / refresh graph (default output path)
webpilot graph

# Summary to terminal
webpilot graph --summary

# JSON to stdout
webpilot graph --json

# Custom output path
webpilot graph --out ./runtime/knowledge/my-graph.json
```

**Default output:** `runtime/knowledge/knowledge-graph.json`

---

## What gets indexed

| Source | Extractor | Symbols captured |
|--------|-----------|------------------|
| TypeScript | TypeScript compiler AST | Classes, methods, `urlPattern`, exports |
| Python | Tree-sitter WASM | Classes, functions |
| Java | Tree-sitter WASM | Classes, methods |
| C# | Tree-sitter WASM | Classes, methods |
| Go | Tree-sitter WASM | Types, functions |
| Optional | `.understand-anything/knowledge-graph.json` | External graph merge |

**Key files:**

- `src/core/knowledge/RepoKnowledgeGraph.ts`
- `src/core/SymbolParser.ts`

---

## How codegen uses the graph

```text
Execution trace step: "Click Products in navigation"
        ↓
PlanBuilder queries graph for:
  - Page object with urlPattern matching automationexercise.com
  - Existing method like clickProducts() or navigateToProducts()
        ↓
Generation plan:
  operation: "extend" BookingHomePage.ts
  reason: "existing page object matched URL"
```

Without the graph, codegen would create duplicate files on every run.

---

## Symbol graph (legacy path)

`packages/test-framework/symbol_graph.json` is a focused index used by `CodegenContext` and LLM codegen. `webpilot graph` produces a richer superset under `runtime/knowledge/`.

Run `webpilot graph` after adding new page objects or refactoring framework code.

---

## Example workflow

```bash
# 1. SDET adds manual page object
# packages/test-framework/pages/BookingHomePage.ts

# 2. Refresh graph
webpilot graph --summary

# 3. Run scenario with codegen
webpilot run tests/web/booking_search_hotels.txt --codegen

# 4. Verify plan reused existing page object
cat runtime/codegen/plans/booking_search_hotels.json
```

---

## Graph output (simplified)

```json
{
  "pages": [
    {
      "name": "BookingHomePage",
      "path": "packages/test-framework/pages/BookingHomePage.ts",
      "urlPattern": "https://www.booking.com/",
      "methods": ["goto", "assertLoaded", "searchHotels"]
    }
  ],
  "tests": [...],
  "utilities": [...]
}
```

---

## Best practices

1. **Run graph after framework changes** — new POMs, renamed methods, URL pattern updates.
2. **Use consistent `urlPattern`** on page objects — improves automatic matching.
3. **Commit framework code, not `runtime/knowledge/`** — graph is regenerable locally and in CI before codegen jobs.
4. **Combine with `webpilot init --pattern pom`** — scaffold encourages graph-friendly structure.

---

## See also

- [Deterministic Codegen](./deterministic-codegen.md)
- [PROJECT_STRUCTURE.md](../PROJECT_STRUCTURE.md)
- [FRAMEWORK_GUIDE.md](../FRAMEWORK_GUIDE.md)
