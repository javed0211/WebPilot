# Repository Knowledge Graph

`webpilot graph` builds a **WebPilot-owned** index of your test framework so codegen reuses existing page objects, methods, and tests. Packaged users need **no Cursor** and **no Understand-Anything** plugin.

---

## Overview

When WebPilot generates Playwright code, it should behave like a senior SDET / coding agent:

- Extend `BookingHomePage.ts` instead of creating `BookingHomePage2.ts`
- Reuse existing methods discovered via the knowledge graph
- Match architecture to the repo (flat / POM / BDD) instead of hardcoding POM

**Roles:**

| Layer | Source | Role |
|-------|--------|------|
| Structural | TypeScript / tree-sitter AST | Pages, methods, imports, `urlPattern` |
| Semantic | WebPilot LLM enrich (`--enrich`) | Summaries, intent tags, relationship hints |
| Optional import | `.ua/` Understand-Anything JSON | Merged if present; never required |

---

## Semantic enrich pipeline (UA-inspired, WebPilot-owned)

`webpilot graph --enrich` runs:

1. **SCAN** — write `runtime/knowledge/intermediate/scan-manifest.json` (test-framework pages/methods)
2. **BATCH** — LLM `analysis-batch-NNN.json` files (summaries, intent tags, relations)
3. **MERGE** — normalize types, dedupe edges, remap related targets by name, drop dangling edges → update `knowledge-graph.json` + `merge-report.json`

No Cursor / Understand-Anything plugin required. Incremental: nodes with matching `contentHash` are skipped.

---

## Commands

```bash
# Build / refresh AST graph
webpilot graph

# AST + scan→batch→merge LLM enrich
webpilot graph --enrich

# Summary injected into codegen prompts
webpilot graph --summary
```

**Outputs:**

- `runtime/knowledge/knowledge-graph.json`
- `runtime/knowledge/intermediate/scan-manifest.json`
- `runtime/knowledge/intermediate/analysis-batch-*.json`
- `runtime/knowledge/intermediate/merge-report.json`

---

## Coding-agent codegen

```bash
# Default when the graph has page objects: agent + tools over the KG
webpilot generate --from <slug>

# Force deterministic templates
webpilot generate --from <slug> --deterministic

# Force agent path; skip enrich
webpilot generate --from <slug> --agent --no-enrich

# Override layout detection
webpilot generate --from <slug> --architecture flat
```

Agent tools include: `kg_search`, `kg_find_page`, `kg_find_method`, `read_file`, `list_dir`, `write_files`, `apply_patch`, `run_tests`, `get_compact_steps`, `detect_architecture`.

---

## Architecture detection

`detectRepoArchitecture()` inspects `packages/test-framework/` for `pages/`, `*.feature`, and step dirs. Results feed the agent and profile pattern (`flat` → `simple`). CLI `--architecture` overrides.

---

## Understand-Anything (optional only)

If `.ua/knowledge-graph.json` or legacy `.understand-anything/knowledge-graph.json` exists, it is merged on refresh. Packaged deployments should rely on `webpilot graph --enrich` instead.

---

## Key files

- `src/core/knowledge/RepoKnowledgeGraph.ts` — AST build / save / load
- `src/core/knowledge/GraphLlmEnricher.ts` — scan → batch → merge orchestrator
- `src/core/knowledge/graphEnrich/scanManifest.ts` — deterministic scan
- `src/core/knowledge/graphEnrich/mergeEnrichment.ts` — normalize / dedupe / merge
- `src/core/knowledge/CodegenTools.ts` — agent tool surface
- `src/core/knowledge/RepoArchitectureDetect.ts` — layout detect
- `src/core/codegen/AgentCodegenPipeline.ts` — agent codegen entry
- `src/agents/RepoEditCodegenAgent.ts` — tool loop
