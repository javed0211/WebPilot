# Security Policy

WebPilot executes browser automation, may process credentials, and can generate screenshots, traces, videos, logs, and reports. Treat local runtime output as potentially sensitive.

## Supported Versions

Security fixes target the current `main` branch until formal release channels are established.

## Reporting a Vulnerability

If you find a vulnerability, please avoid opening a public issue with exploit details.

Report privately by contacting the maintainers through the repository owner profile or by opening a minimal private advisory if GitHub advisories are enabled for the project.

Please include:

- affected commit or version
- impacted command or subsystem
- reproduction steps
- expected impact
- whether credentials, cookies, traces, or screenshots are exposed
- suggested fix, if known

## Sensitive Data Guidelines

Do not commit or share:

- real LLM/API provider keys
- session cookies
- bearer tokens
- customer URLs or credentials
- private screenshots
- browser traces containing user data
- generated reports from private systems
- `.env` files with secrets

Use `.env` for local secrets and keep committed config files placeholder-only.

## Automation Safety

When running WebPilot against real applications:

- prefer non-production environments
- use least-privilege test accounts
- avoid destructive workflows unless the environment is disposable
- review generated steps before replaying sensitive flows
- sanitize reports before sharing them publicly

## Artifact Handling

Runtime artifacts are written under `runtime/`. Before attaching reports to issues or CI artifacts, review:

- `runtime/reports/html/`
- `runtime/reports/data/`
- `runtime/reports/screenshots/`
- `runtime/reports/videos/`
- `runtime/reports/traces/`
- `runtime/site-knowledge/`

These files can contain page content, selectors, URLs, prompts, model responses, or credentials visible on screen.
