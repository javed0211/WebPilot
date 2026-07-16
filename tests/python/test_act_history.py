"""Tests for ActHistory transform from browser-use-shaped history."""
from __future__ import annotations

from types import SimpleNamespace

from integrations.browser_use.act_history import (
    act_history_to_execution_rows,
    build_act_history,
    build_assertion_plan,
    locator_candidates_from_element,
)
from integrations.browser_use.execution_history import build_full_execution_context


class _FakeAction:
    def __init__(self, payload: dict):
        self._payload = payload

    def model_dump(self, exclude_none=True, mode="json"):
        return dict(self._payload)


def _history_list(items: list) -> SimpleNamespace:
    return SimpleNamespace(
        history=items,
        is_successful=lambda: True,
        is_done=lambda: True,
        action_names=lambda: ["navigate", "click", "input"],
        errors=lambda: [],
        model_actions=lambda: [],
        model_dump=lambda: {"history": []},
    )


def test_locator_candidates_prefer_role_for_link():
    element = {
        "node_name": "A",
        "ax_name": "View history",
        "attributes": {"href": "/w/index.php?title=Software_testing&action=history"},
        "x_path": "/html/body/div/a[1]",
    }
    locs = locator_candidates_from_element(element)
    assert locs
    assert locs[0]["kind"] == "role"
    assert locs[0]["value"] == "link"
    assert locs[0]["name"] == "View history"
    # Absolute html/body xpath must not be stored; relative attr xpath is ok.
    xpath_vals = [loc["value"] for loc in locs if loc.get("kind") == "xpath"]
    assert xpath_vals
    assert all(not v.startswith("html/") and "/html/body" not in v for v in xpath_vals)
    assert any('href=' in v for v in xpath_vals)


def test_locator_candidates_drop_absolute_xpath_use_relative():
    element = {
        "node_name": "A",
        "ax_name": "Get started",
        "attributes": {"class": "getStarted_Sjon", "href": "/docs/intro"},
        "x_path": "html/body/div[1]/div[2]/header/div/div/a",
    }
    locs = locator_candidates_from_element(element)
    kinds = [loc["kind"] for loc in locs]
    assert kinds[0] == "role"
    assert any(loc.get("kind") == "css" and 'href="/docs/intro"' in loc.get("value", "") for loc in locs)
    for loc in locs:
        if loc.get("kind") == "xpath":
            assert loc["value"].startswith("//")
            assert "html/body" not in loc["value"]
            assert not loc["value"].startswith("html/")



def test_build_act_history_from_agent_steps_no_invented_asserts():
    click = _FakeAction({"click": {"index": 7}})
    navigate = _FakeAction({"navigate": {"url": "https://www.wikipedia.org/"}})
    fill = _FakeAction({"input": {"index": 3, "text": "Software testing", "clear": True}})

    item0 = SimpleNamespace(
        model_output=SimpleNamespace(action=[navigate]),
        state=SimpleNamespace(
            url="https://www.wikipedia.org/",
            title="Wikipedia",
            interacted_element=[None],
        ),
        result=[SimpleNamespace(long_term_memory="opened wikipedia", extracted_content=None)],
    )
    item1 = SimpleNamespace(
        model_output=SimpleNamespace(action=[fill, click]),
        state=SimpleNamespace(
            url="https://www.wikipedia.org/",
            title="Wikipedia",
            interacted_element=[
                {
                    "node_name": "input",
                    "ax_name": "Search Wikipedia",
                    "attributes": {"placeholder": "Search Wikipedia", "type": "search"},
                    "x_path": "//input[@name='search']",
                },
                {
                    "node_name": "button",
                    "ax_name": "Search",
                    "attributes": {"type": "submit"},
                    "x_path": "//button",
                },
            ],
        ),
        result=[
            SimpleNamespace(long_term_memory=None, extracted_content=None),
            SimpleNamespace(long_term_memory=None, extracted_content=None),
        ],
    )

    steps = build_act_history(_history_list([item0, item1]))
    actions = [s["action"] for s in steps]
    assert actions == ["navigate", "input", "click"]
    assert "assert" not in actions
    assert steps[0]["url"] == "https://www.wikipedia.org/"
    assert steps[1]["value"] == "Software testing"
    assert steps[1]["locators"]
    assert any(loc.get("kind") == "placeholder" for loc in steps[1]["locators"])
    assert steps[2]["elementIndex"] == 7
    assert '"kind": "role"' in (steps[2]["selector"] or "")


def test_assertion_plan_is_separate_from_act_history():
    nl = [
        "Navigate to https://www.wikipedia.org/",
        "Verify Wikipedia homepage loads successfully",
        "Enter Software testing into the search input",
        "Capture screenshot of the heading",
    ]
    plan = build_assertion_plan(nl)
    kinds = [p["kind"] for p in plan]
    assert kinds == ["assert", "screenshot"]
    assert plan[0]["index"] == 2


def test_build_full_execution_context_uses_act_history_not_nl_zipper():
    navigate = _FakeAction({"navigate": {"url": "https://playwright.dev/"}})
    item = SimpleNamespace(
        model_output=SimpleNamespace(action=[navigate]),
        state=SimpleNamespace(url="https://playwright.dev/", title="Playwright", interacted_element=[None]),
        result=[SimpleNamespace(long_term_memory="nav", extracted_content=None)],
    )
    nl = [
        "Navigate to https://playwright.dev/",
        "Verify Playwright homepage loads successfully",
        "Click Get Started button",
    ]
    ctx = build_full_execution_context(_history_list([item]), nl, "demo")
    assert ctx["historySource"] == "browser-use-act-history"
    assert len(ctx["actHistory"]) == 1
    assert ctx["actHistory"][0]["action"] == "navigate"
    # executionHistory mirrors acts — no invented verify/click from NL
    assert [s["action"] for s in ctx["executionHistory"]] == ["navigate"]
    assert len(ctx["assertionPlan"]) == 1
    assert ctx["assertionPlan"][0]["kind"] == "assert"
    rows = act_history_to_execution_rows(ctx["actHistory"])
    assert rows[0]["url"] == "https://playwright.dev/"
