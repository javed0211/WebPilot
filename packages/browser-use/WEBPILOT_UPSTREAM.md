# WebPilot Browser Use Source

This directory vendors the official Browser Use source so WebPilot can customize
the browser agent without patching a generated virtual environment.

- Upstream repository: https://github.com/browser-use/browser-use
- Upstream tag: `0.13.4`
- Upstream commit: `68afe46456a23009a7d5eec2017ec7ab51b7c027`
- License: MIT (`LICENSE`)
- Install mode: editable through the repository root `requirements.txt`

## Local customization policy

Keep WebPilot-specific changes **minimal**. Prefer orchestration in
`src/integrations/browser_use` over editing engine internals:

1. `Tools` for deterministic WebPilot actions and human approval.
2. Agent lifecycle hooks for reporting and observability.
3. `extend_system_message` for WebPilot execution policy.
4. `BrowserSession` settings and CDP for local/TestMu browsers.
5. `sensitive_data` or persisted browser state for credentials.

WebPilot’s default runner mode is **`engineMode: native`**: one browser-use
Agent executes the full NL scenario, and history/codegen follow
`AgentHistoryList` / live action captures. Scoped per-step agents are opt-in
(`engineMode: scoped`) for knowledge-only / repair flows.

If a core patch is required, document it in `WEBPILOT_CHANGES.md` with the
upstream file, reason, and verification command. Do not edit `.venv/site-packages`.
