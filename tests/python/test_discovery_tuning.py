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


def test_control_loop_breaker_stops_repeated_search():
    """CRM-style loops: search_page was previously ignored and never tripped."""
    breaker = ControlLoopBreaker(max_retries=3, window=8)
    action = {"type": "search_page", "value": "Ignore and save"}
    assert fingerprint_from_captured_action(action) == "search|ignore and save"
    assert breaker.observe_actions([action]) is False
    assert breaker.observe_actions([action]) is False
    assert breaker.observe_actions([action]) is True
    assert "search|ignore and save" in breaker.message


def test_control_loop_breaker_stops_uncertain_eval_streak():
    breaker = ControlLoopBreaker(max_uncertain=3, max_retries=99, window=20)

    class _State:
        def __init__(self, ev: str, goal: str):
            self.evaluation_previous_goal = ev
            self.next_goal = goal

    class _Out:
        def __init__(self, ev: str, goal: str):
            self.current_state = _State(ev, goal)

    for i in range(3):
        tripped = breaker.observe_model_state(
            _Out(
                "Prior check was inconclusive; Problem Details still unverified.",
                f"Search again for Caller is patient attempt {i}",
            )
        )
    assert tripped is True
    assert "uncertain" in breaker.message.lower()


def test_control_loop_breaker_stops_repeated_goal():
    breaker = ControlLoopBreaker(max_retries=3, window=8, max_uncertain=99)

    class _State:
        def __init__(self, goal: str):
            self.evaluation_previous_goal = "Success."
            self.next_goal = goal

    class _Out:
        def __init__(self, goal: str):
            self.current_state = _State(goal)

    goal = "Locate the Ignore and save control in the duplicate dialog"
    for _ in range(3):
        tripped = breaker.observe_model_state(_Out(goal))
    assert tripped is True
    assert "repeated agent goals" in breaker.message.lower()
