# WebPilot Browser Use Changes

Vendored from upstream **0.13.4**. Keep this list short — prefer adapter-layer
behavior in `src/integrations/browser_use`.

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
- Reason: replace Browser-Use splash logo with WebPilot wordmark offline.
- Change: inline SVG data URI + tab title `Starting WebPilot agent ...`.

## WebPilot terminal and log branding

- Upstream file: `browser_use/logging_config.py`
- Reason: user-facing logs showed `browser-use` / `Browser Use`.
- Change: `WebPilotLogFormatter` rebrands logger names and common phrases.
- Runner also sets `ANONYMIZED_TELEMETRY=false`, disables cloud sync / version nags.

## Video recorder robustness (Windows)

- Upstream file: `browser_use/browser/video_recorder.py`
- Reason: missing ffmpeg flooded logs and stressed Windows process handles.
- Change: resolve `IMAGEIO_FFMPEG_EXE` from `imageio_ffmpeg`; disable further
  frame capture after the first encode failure.

## Windows-friendly browser launch defaults (adapter)

- Integration: `integrations/browser_use/runner.py`, `branding.py`
- Disable default extensions; raise BrowserStart/Launch and Navigate timeouts
  via env (`TIMEOUT_*`) so enterprise SSO pages can finish loading.
- Soft navigation tolerate: if EventBus times out but the target host already
  loaded, continue the scenario.

## Engine usage (adapter)

- Default `intelligentRunner.engineMode: native` — full-scenario browser-use
  Agent; history/codegen from native actions.
- `engineMode: scoped` keeps the legacy one-Agent-per-NL-step path.

## Security dependency pins

- `pyproject.toml`: `aiohttp==3.14.1`, `click==8.3.3`, `pypdf==6.13.3`.
- Repo root `requirements-overrides.txt` upgrades `pillow` to `12.3.0` after
  install because `browser-harness==0.1.5` still pins `pillow==12.2.0`.
