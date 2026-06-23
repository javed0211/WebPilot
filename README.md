# WebPilot

WebPilot is an AI-native quality engineering platform implemented entirely in Python. Natural-language web scenarios are executed by `browser-use`, converted into synchronous Playwright Page Objects and pytest suites, and rerun without an LLM. API scenarios use Playwright `APIRequestContext` with variable extraction and token chaining.

## Requirements

- Python 3.11+
- Google Chrome or Playwright Chromium
- Azure OpenAI or OpenAI credentials for new UI scenarios

## Setup

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m playwright install chromium
cp .env.example .env
```

Validate the installation:

```bash
.venv/bin/webpilot doctor
```

## Run tests

```bash
# Natural-language UI scenario
.venv/bin/webpilot run tests/web/booking_search_hotels.txt --env qa

# API scenario
.venv/bin/webpilot run tests/api/login_api.txt --env qa

# Visible browser
.venv/bin/webpilot run tests/web/login.txt --env qa --headed

# Generated pytest suites
.venv/bin/python -m pytest framework/tests
```

After a successful first UI run, WebPilot writes:

- Page Objects under `framework/pages/`
- pytest tests under `framework/tests/test_<scenario>.py`
- screenshots, video, history, usage, and reports under `reports/`

Subsequent `webpilot run` calls execute the generated pytest test first and only invoke the LLM when deterministic execution fails.

## CLI

```bash
webpilot doctor
webpilot init
webpilot create test checkout_flow
webpilot create api user_profile
webpilot run tests/web/checkout_flow.txt --env qa
webpilot interactive tests/web/checkout_flow.txt --env qa
webpilot report
webpilot analyze
webpilot self-heal
webpilot self-heal --clean
```

## Structure

```text
webpilot/                     Python CLI and orchestration
core/                         browser-use integration and LLM helpers
framework/core/               reusable Playwright Python helpers
framework/pages/              generated/canonical Page Objects
framework/tests/              generated pytest-playwright suites
framework/apis/               generated API clients
tests/web/                    natural-language UI scenarios
tests/api/                    natural-language API scenarios
config/                       framework, environment, and LLM configuration
prompts/                      editable LLM prompts
reports/                      execution artifacts
```

See [docs/USAGE.md](docs/USAGE.md), [docs/CONFIGURATION.md](docs/CONFIGURATION.md), and [docs/REPORTING.md](docs/REPORTING.md).
