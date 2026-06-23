# WebPilot Python Framework Guide

WebPilot has one runtime: Python 3.11+.

## Execution flow

1. `webpilot run` reads a natural-language scenario.
2. If `framework/tests/test_<slug>.py` exists, pytest runs it directly.
3. Otherwise, UI tests run through `core/browser_use_runner.py`.
4. Live execution history is sent to the configured LLM for Playwright Python generation.
5. `webpilot.codegen` normalizes imports and filenames, writes Page Objects and tests, checks Python syntax, and runs the generated pytest test.
6. API scenarios are parsed and executed directly by `webpilot.api`; successful runs generate Python API clients and pytest tests.

## Core modules

| Module | Responsibility |
|---|---|
| `webpilot.cli` | Console command and command parsing |
| `webpilot.runner` | UI/API routing and deterministic reruns |
| `webpilot.api` | API parsing execution, variables, assertions |
| `webpilot.codegen` | Generated-file normalization and validation |
| `webpilot.reports` | HTML and Markdown reports |
| `core/browser_use_runner.py` | LLM-driven live browser execution |
| `core/llm_config.py` | Provider and credential resolution |
| `framework/core/base_page.py` | Shared synchronous Page Object API |
| `framework/core/base_api.py` | Shared API request/assertion API |

## Commands

```bash
webpilot doctor
webpilot create test example
webpilot create api example_api
webpilot run tests/web/example.txt --env qa
webpilot run tests/api/example_api.txt --env qa
webpilot interactive tests/web/example.txt --env qa
webpilot report
webpilot analyze
```

## Generated layout

```text
framework/pages/<site>/<page>_page.py
framework/tests/test_<scenario>.py
framework/apis/<scenario>_api.py
framework/tests/api/test_<scenario>.py
```

Generated tests use synchronous `playwright.sync_api` and pytest fixtures from `framework/conftest.py`.
