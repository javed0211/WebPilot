# WebPilot documentation

## Start here

| Document | Description |
|----------|-------------|
| [USAGE.md](./USAGE.md) | Quick start — install, configure, run tests, troubleshooting |
| [guides/README.md](./guides/README.md) | **Feature guides** — detailed docs for every major capability |
| [FRAMEWORK_GUIDE.md](./FRAMEWORK_GUIDE.md) | End-to-end framework reference (architecture, CLI, CI) |

## Feature guides

| Guide | Topic |
|-------|--------|
| [Execution & Replay](./guides/execution-and-replay.md) | Run modes, knowledge-only, codegen vs replay |
| [Intelligent Runner & Site Knowledge](./guides/intelligent-runner-and-site-knowledge.md) | Learned capabilities, per-step replay, performance |
| [Deterministic Codegen](./guides/deterministic-codegen.md) | Trace → plan → profile-aware test code without LLM |
| [ActHistory & Codegen Reuse](./guides/act-history-and-codegen-reuse.md) | Success-only codegen, history reuse, `history clear` |
| [Selector Intelligence & Healing](./guides/selector-intelligence-and-healing.md) | Registry, confidence, `self-heal` |
| [Test Authoring](./guides/test-authoring.md) | `.txt` format, metadata, templates |
| [Browser Providers](./guides/browser-providers.md) | browser-use, local-playwright, testmu |
| [Assertion Engine](./guides/assertion-engine.md) | Inferred assertions and strength scoring |
| [Flake Analyzer](./guides/flake-analyzer.md) | Failure classification and fixes |
| [Multi-Language Codegen](./guides/multi-language-codegen.md) | TypeScript, Python, Java, Cypress, WebdriverIO, C# profiles |
| [Reports & Evidence](./guides/reports-and-evidence.md) | HTML, video, trace, artifacts |
| [CI & Artifacts](./guides/ci-and-artifacts.md) | GitHub Actions, JUnit, manifest |
| [API Testing](./guides/api-testing.md) | HTTP scenarios, OpenAPI import |
| [Repository Knowledge Graph](./guides/repository-knowledge-graph.md) | `webpilot graph`, POM reuse |
| [CLI Reference](./guides/cli-reference.md) | All commands, flags, env vars |

## Reference

| Document | Description |
|----------|-------------|
| [CONFIGURATION.md](./CONFIGURATION.md) | `webpilot.yaml`, `llm.json`, environments, prompts |
| [REPORTING.md](./REPORTING.md) | Report internals and customization |
| [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) | Repository layout and `runtime/` output |
| [PUBLISHING.md](./PUBLISHING.md) | npm publishing, runtime requirements, security gates |
| [OPEN_SOURCE_ROADMAP.md](./OPEN_SOURCE_ROADMAP.md) | Product positioning and milestones |
| [features/README.md](./features/README.md) | Implementation specs (for contributors) |

Project overview: [../README.md](../README.md).
