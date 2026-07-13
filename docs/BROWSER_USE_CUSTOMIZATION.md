# Browser Use Customization

WebPilot uses a vendored, editable copy of Browser Use rather than relying on an
opaque package installed into `.venv`.

## Source and version

- Engine source: `packages/browser-use`
- WebPilot adapter: `src/integrations/browser_use`
- Upstream: `browser-use/browser-use`
- Version: `0.13.4`
- Runtime entry point: `python -m integrations.browser_use`

The Python Agent API remains the supported surface. Optional Rust
`browser-use-core` extras are **not** required for WebPilot.

## Design rule

**browser-use owns browsing intelligence.** WebPilot wrappers should not change
core click/navigate/consent behavior unless required for product concerns
(credentials, reports, branding, CI). Prefer `engineMode: native` so one Agent
runs the full NL scenario the way raw browser-use would.

## Architecture

```text
WebPilot CLI / Engine
        |
        v
src/integrations/browser_use/runner.py
        |
        +--> packages/browser-use  (Agent, BrowserSession, Tools, DOM)
        |
        +--> WebPilot adapter (LLM config, branding, history, knowledge, codegen)
```

Default path: `run_native_browser_use_scenario` → `AgentHistoryList` /
locator-rich action captures → execution history → codegen / site knowledge.

Opt-in path: `engineMode: scoped` → one Agent per NL step (legacy).

## Supported customization points

- Add deterministic actions with `Tools.action`.
- Remove unsafe or irrelevant default tools with `exclude_actions`.
- Add WebPilot policy through `extend_system_message`.
- Observe or control runs with `on_step_start` and `on_step_end`.
- Configure local, real-profile, or remote browsers through `BrowserSession`.
- Restrict navigation with `allowed_domains` and `prohibited_domains`.
- Pass credentials with `sensitive_data`; prefer storage state for authenticated
  sessions. Do not append plaintext passwords to the agent task.
- Use `AgentHistoryList` and cost tracking for reporting.
- Disable upstream anonymous telemetry with `ANONYMIZED_TELEMETRY=false`.

## Development workflow

1. Run `webpilot setup` after changing Python dependencies.
2. Confirm `npm run doctor` reports a path under `packages/browser-use`.
3. Add focused tests beside the relevant vendored module.
4. Record engine patches in `packages/browser-use/WEBPILOT_CHANGES.md`.
5. Run Python compile/tests and the TypeScript build before committing.

Do not modify files under `.venv/lib/python*/site-packages/browser_use`; they are
generated installation output and will be replaced.
