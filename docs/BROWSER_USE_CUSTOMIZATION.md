# Browser Use Customization

WebPilot uses a vendored, editable copy of Browser Use rather than relying on an
opaque package installed into `.venv`.

## Source and version

- Engine source: `packages/browser-use`
- WebPilot adapter: `src/integrations/browser_use`
- Upstream: `browser-use/browser-use`
- Version: `0.12.9`
- Runtime entry point: `python -m integrations.browser_use`

The version is intentionally pinned to the API WebPilot currently uses. Browser
Use `0.13.x` also contains an opt-in Rust-powered beta agent. That is a separate
migration because its runtime, event transport, tool behavior, and dependency
requirements differ from the stable Python agent.

## Architecture

```text
WebPilot CLI / Engine
        |
        v
src/integrations/browser_use/runner.py
        |
        +--> packages/browser-use
        |      +--> Agent
        |      +--> BrowserSession / CDP
        |      +--> Tools and DOM engine
        |
        +--> WebPilot adapter services
        |      +--> LLM configuration
        |      +--> TestMu and branding
        |      +--> history export
        |
        +--> Agent
        |      +--> prompt and message manager
        |      +--> Tools registry and ActionResult
        |      +--> lifecycle callbacks and AgentHistoryList
        |
        +--> Browser / BrowserSession
        |      +--> CDP session and browser events
        |      +--> watchdogs (DOM, downloads, popups, security, recording)
        |      +--> DOM serialization and screenshots
        |
        +--> LLM adapters
        |
        +--> WebPilot reporting, branding, TestMu, and code generation
```

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
