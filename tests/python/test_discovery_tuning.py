"""Unit tests for discovery fast-mode + control-loop helpers."""
from __future__ import annotations

from integrations.browser_use.discovery_tuning import (
    ControlLoopBreaker,
    apply_discovery_fast_mode,
    build_lean_native_task,
    discovery_fast_mode_enabled,
    extract_initial_navigate_url,
    fingerprint_from_captured_action,
)


def test_full_agent_defaults_on(monkeypatch):
    monkeypatch.delenv("WEBPILOT_FULL_AGENT_MODE", raising=False)
    monkeypatch.delenv("WEBPILOT_DISCOVERY_FAST_MODE", raising=False)
    assert discovery_fast_mode_enabled({}) is False
    tuned = apply_discovery_fast_mode({})
    assert tuned["_discoveryFastModeActive"] is False


def test_fast_mode_opt_in(monkeypatch):
    monkeypatch.setenv("WEBPILOT_FULL_AGENT_MODE", "0")
    monkeypatch.setenv("WEBPILOT_DISCOVERY_FAST_MODE", "1")
    assert discovery_fast_mode_enabled({}) is True
    tuned = apply_discovery_fast_mode({"discoveryFastMode": True})
    assert tuned["_discoveryFastModeActive"] is True
    assert tuned["judgeMode"] == "off"
    assert tuned["flashMode"] is True
    assert tuned["useThinking"] is False


def test_full_agent_mode_disables_fast(monkeypatch):
    monkeypatch.setenv("WEBPILOT_FULL_AGENT_MODE", "1")
    assert discovery_fast_mode_enabled({"discoveryFastMode": True}) is False


def test_lean_task_and_initial_url():
    steps = [
        "Navigate to https://www.booking.com/",
        'Enter "London" in the destination field',
    ]
    task = build_lean_native_task(steps, "Prefer role=textbox")
    assert "OPTIONAL HINTS" not in task
    assert "LOCATOR HINTS" in task
    assert "1. Navigate to https://www.booking.com/" in task
    assert extract_initial_navigate_url(steps) == "https://www.booking.com/"


def test_control_loop_breaker_triggers():
    breaker = ControlLoopBreaker(max_retries=3, window=6)
    action = {"type": "input", "value": "London", "index": 1}
    assert fingerprint_from_captured_action(action) == "input|1|london"
    for _ in range(3):
        breaker.observe_actions([action])
    assert breaker.triggered is True
