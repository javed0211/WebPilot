# WebPilot Feature Guides

Detailed, user-facing documentation for every major WebPilot capability. These guides explain **what each feature does**, **how to use it**, and **how it fits into the SDET workflow**.

For quick start, see [USAGE.md](../USAGE.md). For implementation specs and exit criteria, see [features/](../features/README.md).

---

## The SDET workflow

```text
Write .txt scenario  →  webpilot run  →  learn + execute live  →  optional --codegen
                              ↓
              Re-run with knowledge (0 LLM)  →  webpilot replay (CI)
```

| Phase | What you do | WebPilot feature |
|-------|-------------|------------------|
| Author | Write natural-language steps | [Test Authoring](./test-authoring.md) |
| Explore | First run on new flows | [Intelligent Runner](./intelligent-runner-and-site-knowledge.md) |
| Re-run | Fast deterministic replay | [Execution & Replay](./execution-and-replay.md) |
| Promote | Generate Playwright for CI | [Deterministic Codegen](./deterministic-codegen.md) |
| Maintain | Fix broken selectors | [Selector Intelligence & Healing](./selector-intelligence-and-healing.md) |
| Debug | Understand failures | [Flake Analyzer](./flake-analyzer.md) · [Reports](./reports-and-evidence.md) |
| Ship | Run in GitHub Actions | [CI & Artifacts](./ci-and-artifacts.md) |

---

## Feature guides

### Execution

| Guide | Summary |
|-------|---------|
| [Execution & Replay](./execution-and-replay.md) | `webpilot run`, `webpilot replay`, knowledge-only vs discovery, when LLM is used |
| [Intelligent Runner & Site Knowledge](./intelligent-runner-and-site-knowledge.md) | Per-step replay, learned capabilities, registry bridge, performance tuning |
| [Browser Providers](./browser-providers.md) | `browser-use`, `local-playwright`, `testmu`, remote CDP |

### Code generation

| Guide | Summary |
|-------|---------|
| [Deterministic Codegen](./deterministic-codegen.md) | Trace → plan → Playwright spec/POM without LLM |
| [Multi-Language Codegen](./multi-language-codegen.md) | TypeScript, Python, Java, Cypress profiles |
| [Assertion Engine](./assertion-engine.md) | How WebPilot infers and scores assertions |
| [Repository Knowledge Graph](./repository-knowledge-graph.md) | `webpilot graph`, reusing existing page objects |

### Quality & maintenance

| Guide | Summary |
|-------|---------|
| [Selector Intelligence & Healing](./selector-intelligence-and-healing.md) | Registry, confidence, fallbacks, `webpilot self-heal` |
| [Flake Analyzer](./flake-analyzer.md) | Failure classification and fix recommendations |

### Authoring & operations

| Guide | Summary |
|-------|---------|
| [Test Authoring](./test-authoring.md) | `.txt` format, metadata, templates, `webpilot create` |
| [API Testing](./api-testing.md) | HTTP scenarios, OpenAPI import |
| [Reports & Evidence](./reports-and-evidence.md) | HTML dashboards, traces, videos, AI analysis |
| [CI & Artifacts](./ci-and-artifacts.md) | `webpilot ci`, JUnit, artifact manifest |
| [CLI Reference](./cli-reference.md) | All commands, flags, and environment variables |

---

## Related documentation

| Document | Purpose |
|----------|---------|
| [USAGE.md](../USAGE.md) | Install, configure, first run |
| [FRAMEWORK_GUIDE.md](../FRAMEWORK_GUIDE.md) | End-to-end framework reference |
| [CONFIGURATION.md](../CONFIGURATION.md) | `webpilot.yaml`, `llm.json`, environments |
| [REPORTING.md](../REPORTING.md) | Report internals and customization |
| [PROJECT_STRUCTURE.md](../PROJECT_STRUCTURE.md) | Repo layout and `runtime/` output |
| [PUBLISHING.md](../PUBLISHING.md) | npm publishing, Node/Python requirements, release security checks |
| [OPEN_SOURCE_ROADMAP.md](../OPEN_SOURCE_ROADMAP.md) | Product milestones |
