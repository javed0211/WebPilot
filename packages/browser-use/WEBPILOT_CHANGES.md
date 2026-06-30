# WebPilot Browser Use Changes

## Headless-safe macOS display detection

- Upstream file: `browser_use/browser/profile.py`
- Reason: `AppKit.NSScreen.mainScreen()` can terminate Python with `SIGABRT`
  when imported without an active macOS WindowServer session.
- Change: run the AppKit display probe in a short-lived child process and fall
  back to Browser Use's default 1920×1080 headless configuration if it fails.
- Verification:
  `BROWSER_USE_SETUP_LOGGING=false .venv/bin/python -c "from browser_use import Agent, Browser"`

## WebPilot startup branding on blank tabs

- Upstream file: `browser_use/browser/watchdogs/aboutblank_watchdog.py`
- Reason: the `about:blank` loading screen showed the Browser-Use logo
  (`https://cf.browser-use.com/logo.svg`) as a bouncing "DVD screensaver",
  which is the first thing a user sees when the browser launches.
- Change: replaced the remote Browser-Use logo with an inline WebPilot wordmark
  (SVG data URI, brand blue `#2563eb`) and updated the tab title to
  `Starting WebPilot agent ...`. No external host dependency.

## WebPilot terminal and log branding

- Upstream files:
  - `browser_use/logging_config.py`
  - `browser_use/agent/service.py`
  - `integrations/browser_use/runner.py`
- Reason: users saw `browser-use` in startup logs, agent banners, captcha nudges,
  telemetry notices, and `[browser_use]` logger prefixes during WebPilot runs.
- Changes:
  - Disable upstream telemetry, cloud sync, and version-upgrade nags by default
    in the WebPilot runner (`ANONYMIZED_TELEMETRY=false`, etc.).
  - Rebrand user-facing log prefixes and messages to `WebPilot`.
  - Remove `cloud.browser-use.com` captcha promo nudges.
  - Downgrade upstream version-upgrade messaging to debug-only.
  - Update WebPilot CLI/doctor/setup copy to say "WebPilot engine" instead of
    "Browser Use".

## Windows-friendly browser launch defaults

- Upstream integration: `integrations/browser_use/runner.py`,
  `integrations/browser_use/branding.py`
- Reason: first browser launch on Windows often exceeded browser-use's 30s
  `BrowserStartEvent` timeout while default extensions (uBlock, cookie
  blockers) were downloaded and extracted.
- Changes:
  - Disable default browser-use extensions for WebPilot runs
    (`BROWSER_USE_DISABLE_EXTENSIONS=true`, `enable_default_extensions=false`).
  - Raise browser launch event timeouts to 120s by default.
  - Users can still override via environment variables when needed.

The initial integration vendors Browser Use `0.12.9` and makes it the editable
runtime dependency. WebPilot continues to provide its existing runner,
TestMu/CDP configuration, branding hooks, execution-history export, and
Playwright code generation from `integrations/browser_use/`.

The repository-level runner uses the upstream `sensitive_data` mechanism and
domain restrictions rather than adding plaintext Azure credentials to tasks.
