# WebPilot Feature Implementation Plan

This directory breaks the WebPilot product roadmap into implementation-ready feature specs.

**User-facing documentation:** For detailed guides on how to use each feature, see **[guides/README.md](../guides/README.md)**.

The north star is:

> WebPilot turns natural-language exploration into deterministic, reviewable, self-healing automation frameworks across Playwright, Selenium, Cypress, and WebdriverIO.

## Feature guides (detailed usage docs)

| Spec | User guide |
|------|------------|
| [01 Deterministic Pipeline](./01-deterministic-generated-test-pipeline.md) | [Deterministic Codegen](../guides/deterministic-codegen.md) |
| [02 Selector Intelligence](./02-selector-intelligence-and-healing.md) | [Selector Intelligence & Healing](../guides/selector-intelligence-and-healing.md) |
| [03 Multi-Language Codegen](./03-multi-language-codegen-profiles.md) | [Multi-Language Codegen](../guides/multi-language-codegen.md) |
| [04 Assertion Engine](./04-assertion-engine.md) | [Assertion Engine](../guides/assertion-engine.md) |
| [05 Flake Analyzer](./05-flake-analyzer.md) | [Flake Analyzer](../guides/flake-analyzer.md) |
| [06 Browser Providers](./06-browser-provider-matrix.md) | [Browser Providers](../guides/browser-providers.md) |
| [07 CI & Artifacts](./07-ci-mode-and-release-artifacts.md) | [CI & Artifacts](../guides/ci-and-artifacts.md) |
| [08 Test Authoring](./08-test-authoring-ux.md) | [Test Authoring](../guides/test-authoring.md) |
| [09 Requirements Coverage & Regression](./09-requirements-coverage-regression.md) | [ADO Test Plans](../guides/ado-test-plans.md) |
| [10 Full OpenAPI / Swagger API Automation](./10-api-openapi-full-suite.md) | [API Testing](../guides/api-testing.md) |
| [11 Evidence-First Reports (QA Governance)](./11-evidence-first-reports.md) | [Reports & Evidence](../guides/reports-and-evidence.md) |
| [12 Execution Event Ledger](./12-execution-event-ledger.md) | — |
| [13 Fixture & Test-Data Lifecycle](./13-fixture-lifecycle.md) | — |
| [14 Healing Change Classification](./14-healing-change-classification.md) | [Selector Intelligence & Healing](../guides/selector-intelligence-and-healing.md) |
| [15 Grounded Root-Cause](./15-grounded-root-cause.md) | [Reports & Evidence](../guides/reports-and-evidence.md) |
| [16 Semantic Assertion Runtime](./16-semantic-assertion-runtime.md) | [Assertion Engine](../guides/assertion-engine.md) |
| — | [Intelligent Runner & Site Knowledge](../guides/intelligent-runner-and-site-knowledge.md) |
| — | [Execution & Replay](../guides/execution-and-replay.md) |
| — | [API Testing](../guides/api-testing.md) |
| — | [Repository Knowledge Graph](../guides/repository-knowledge-graph.md) |
| — | [CLI Reference](../guides/cli-reference.md) |

## Implementation Order

Recommended order:

1. [Deterministic Generated Test Pipeline](./01-deterministic-generated-test-pipeline.md) — **complete**
2. [Selector Intelligence and Healing](./02-selector-intelligence-and-healing.md) — **complete**
3. [Multi-Language Codegen Profiles](./03-multi-language-codegen-profiles.md) — **complete**
4. [Assertion Engine](./04-assertion-engine.md) — **complete**
5. [Flake Analyzer](./05-flake-analyzer.md) — **complete**
6. [Browser Provider Matrix](./06-browser-provider-matrix.md) — **complete**
7. [CI Mode and Release Artifacts](./07-ci-mode-and-release-artifacts.md) — **complete**
8. [Test Authoring UX](./08-test-authoring-ux.md) — **complete**
9. [Requirements Coverage and Regression Manager](./09-requirements-coverage-regression.md) — **planned** (Phase 1 + ADO Test Plans shipped)
10. [Full OpenAPI / Swagger API Automation](./10-api-openapi-full-suite.md) — **shipped** (full + smoke modes)
11. [Evidence-First Reports for QA Governance](./11-evidence-first-reports.md) — **shipped** (Phases 1–5)
12. [Execution Event Ledger](./12-execution-event-ledger.md) — **in progress** (Phase 1 foundation shipped)
13. [Fixture & Test-Data Lifecycle](./13-fixture-lifecycle.md) — **in progress** (manager + providers shipped)
14. [Healing Change Classification](./14-healing-change-classification.md) — **in progress** (classifier + transactional commit shipped)
15. [Grounded Root-Cause](./15-grounded-root-cause.md) — **in progress** (analyzer + CitationValidator shipped)
16. [Semantic Assertion Runtime](./16-semantic-assertion-runtime.md) — **in progress** (AST/runtime/codegen shipped)

Recommended next build order for the trust roadmap:

1. Event ledger (12) — **started**
2. Fixture lifecycle (13)
3. Semantic assertions (16)
4. Healing classification (14)
5. Grounded root-cause (15) — **started**
6. EvidenceBundle (11) — **shipped**

## How To Use These Specs

For each feature:

- Start with the product scope section.
- Implement only the smallest vertical slice that satisfies the exit criteria.
- Add tests before widening support to more languages, browsers, or frameworks.
- Update the feature spec with implementation notes as decisions become real code.

## Current Foundation

Already implemented or partially implemented:

- `webpilot init` profile-aware scaffolding.
- `webpilot doctor` profile-aware diagnostics.
- `webpilot graph` repository knowledge graph.
- TypeScript compiler AST extraction.
- Tree-sitter WASM extraction for Python, Java, C#, and Go.
- React-based HTML reports.
- Runtime artifact organization under `runtime/`.
- Official MCP is the integration path for Azure DevOps (bundled `@azure-devops/mcp` + `webpilot ado`), Dataverse (bundled `@microsoft/dataverse` + `webpilot dataverse`), and Jira requirements sync.

## Prioritization Rules

Prioritize features that:

- Make generated automation deterministic and CI-friendly.
- Reduce flakiness.
- Improve code review quality.
- Work without LLM calls during replay.
- Preserve compatibility with Playwright/Selenium/Cypress/WebdriverIO instead of replacing them.

