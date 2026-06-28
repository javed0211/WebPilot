# WebPilot Browser Use Source

This directory vendors the official Browser Use source so WebPilot can customize
the browser agent without patching a generated virtual environment.

- Upstream repository: https://github.com/browser-use/browser-use
- Upstream tag: `0.12.9`
- Upstream commit: `834269609082d187ca0250de2c06d93799dac92d`
- License: MIT (`LICENSE`)
- Install mode: editable through the repository root `requirements.txt`

## Local customization policy

Keep WebPilot-specific changes explicit and covered by focused tests. Prefer the
documented extension points before changing core behavior:

1. `Tools` for deterministic WebPilot actions and human approval.
2. Agent lifecycle hooks for reporting and observability.
3. `extend_system_message` for WebPilot execution policy.
4. `BrowserSession` settings and CDP for local/TestMu browsers.
5. `sensitive_data` or persisted browser state for credentials.

If a core patch is required, document it in `WEBPILOT_CHANGES.md` with the
upstream file, reason, and verification command. Do not edit `.venv/site-packages`.
