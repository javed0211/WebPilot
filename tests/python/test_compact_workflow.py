"""Tests for compactWorkflow builder — durable codegen/replay source of truth."""
from __future__ import annotations

from integrations.browser_use.compact_workflow import (
    build_compact_workflow,
    compact_steps_to_act_steps,
)


def _loginish_history():
    return [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://example.test/residents",
            "value": "https://example.test/residents",
            "description": "navigate | residents",
            "locators": [],
        },
        {
            "index": 2,
            "action": "search_page",
            "description": "Searched page for Email",
            "locators": [],
        },
        {
            "index": 3,
            "action": "input",
            "value": "user@yopmail.com",
            "description": "input email",
            "locators": [
                {"kind": "text", "value": "Skip to main content"},
                {"kind": "label", "value": "Email address"},
            ],
        },
        {
            "index": 4,
            "action": "click",
            "description": "Continue",
            "locators": [
                {"kind": "text", "value": "Skip to main content"},
                {"kind": "role", "value": "button", "name": "Continue"},
            ],
        },
        {
            "index": 5,
            "action": "find_elements",
            "description": "Found inputs",
            "locators": [],
        },
        {
            "index": 6,
            "action": "input",
            "value": "Test@12345",
            "description": "password",
            "locators": [{"kind": "label", "value": "Password"}],
        },
        {
            "index": 7,
            "action": "click",
            "description": "Sign in",
            "locators": [{"kind": "role", "value": "button", "name": "Sign in"}],
        },
        {
            "index": 8,
            "action": "input",
            "value": "123456",
            "description": "otp",
            "locators": [{"kind": "label", "value": "Verification code"}],
        },
        {
            "index": 9,
            "action": "click",
            "description": "Confirm",
            "locators": [{"kind": "role", "value": "button", "name": "Confirm"}],
        },
        {
            "index": 10,
            "action": "scroll",
            "description": "scroll",
            "locators": [],
        },
        {
            "index": 11,
            "action": "click",
            "description": "Back",
            "locators": [{"kind": "role", "value": "button", "name": "Back"}],
        },
        {
            "index": 12,
            "action": "click",
            "description": "Previous",
            "locators": [{"kind": "role", "value": "button", "name": "Previous"}],
        },
        {
            "index": 13,
            "action": "click",
            "description": "Previous again",
            "locators": [{"kind": "role", "value": "button", "name": "Previous"}],
        },
    ]


def test_compact_drops_agent_tools_and_keeps_login_path():
    nl = [
        "Navigate to https://example.test/residents",
        "Enter Email address as user@yopmail.com",
        "And click on Continue button",
        "Enter Password as Test@12345",
        "And click on Sign in button",
        "Enter verification code as 123456",
        "And click on Confirm button",
        "Verify that the home page is visible successfully",
        "Click on Back arrow button on date picker",
        "Click Backward button till it get disabled and verify button color as grey",
    ]
    assertion_plan = [
        {"index": 8, "kind": "assert", "nlStep": "Verify that the home page is visible successfully"}
    ]
    compact = build_compact_workflow(_loginish_history(), nl, assertion_plan)
    actions = [s["action"] for s in compact["steps"]]
    assert "search_page" not in actions
    assert "find_elements" not in actions
    assert "navigate" in actions
    assert actions.count("input") == 3
    assert any(
        (s.get("locator") or {}).get("name") == "Continue"
        or any(l.get("name") == "Continue" for l in (s.get("selectorCandidates") or []))
        for s in compact["steps"]
        if s["action"] == "click"
    )
    # Loop NL preserves repeated Previous clicks (up to max)
    prev_clicks = [
        s
        for s in compact["steps"]
        if s["action"] == "click"
        and any(
            (l.get("name") == "Previous")
            for l in (s.get("selectorCandidates") or []) + ([s["locator"]] if s.get("locator") else [])
        )
    ]
    assert len(prev_clicks) >= 2
    assert any(d["reason"].startswith("drop agent-tool") for d in compact["dropped"])
    assert compact["coverage"]["nlTotal"] == len(nl)


def test_compact_seeds_native_captured_locators():
    acts = [
        {
            "index": 1,
            "action": "click",
            "elementIndex": 3,
            "description": "thin click",
            "locators": [],
        }
    ]
    captured = [
        {
            "type": "click",
            "index": 3,
            "locators": [{"kind": "role", "value": "button", "name": "Save"}],
        }
    ]
    compact = build_compact_workflow(acts, ["Click Save"], [], native_captured_actions=captured)
    assert compact["steps"]
    step = compact["steps"][0]
    assert step["locator"] and step["locator"].get("name") == "Save"


def test_compact_to_act_steps_orders_primary_first():
    compact = {
        "schemaVersion": 1,
        "source": "test",
        "steps": [
            {
                "index": 1,
                "action": "click",
                "locator": {"kind": "role", "value": "button", "name": "OK", "verified": True},
                "semanticLocators": [{"kind": "role", "value": "button", "name": "OK"}],
                "selectorCandidates": [{"kind": "css", "value": "button.ok"}],
                "verified": True,
            }
        ],
        "dropped": [],
        "coverage": {"nlTotal": 0, "mapped": 0, "unmapped": []},
    }
    rows = compact_steps_to_act_steps(compact)
    assert rows[0]["locators"][0]["name"] == "OK"
    assert rows[0]["locatorVerified"] is True


def test_digital_like_unmapped_coverage_when_back_missing():
    """If Back NL has no matching act, coverage reports unmapped (gate can block codegen)."""
    acts = [
        {"index": 1, "action": "navigate", "url": "https://x", "value": "https://x", "locators": []},
        {
            "index": 2,
            "action": "input",
            "value": "a@b.com",
            "locators": [{"kind": "label", "value": "Email"}],
        },
    ]
    nl = [
        "Navigate to https://x",
        "Enter Email as a@b.com",
        "Click Backward button till it get disabled",
    ]
    compact = build_compact_workflow(acts, nl, [])
    assert "Click Backward button till it get disabled" in compact["coverage"]["unmapped"]
