from integrations.browser_use.execution_history import (
    append_recipe_replay_history,
    append_replay_history_from_capability,
    build_nl_aligned_codegen_history,
)


def test_append_replay_history_from_capability_expands_actions():
    history: list[dict] = []
    capability = {
        "actions": [
            {
                "type": "click",
                "locators": [{"kind": "role", "value": "link", "name": "Get started"}],
            }
        ]
    }
    append_replay_history_from_capability(
        history,
        capability,
        description="Click Get Started button",
        url="https://playwright.dev/",
    )
    assert len(history) == 1
    assert history[0]["action"] == "click"
    assert '"kind": "role"' in history[0]["selector"]


def test_append_replay_history_from_capability_falls_back_without_actions():
    history: list[dict] = []
    append_replay_history_from_capability(
        history,
        {"actions": []},
        description="Verify homepage",
        url="https://playwright.dev/",
    )
    assert history[0]["action"] == "knowledge-replay"


def test_append_recipe_replay_history_navigate():
    history: list[dict] = []
    append_recipe_replay_history(
        history,
        "Navigate to https://playwright.dev/",
        description="Navigate to https://playwright.dev/",
        url="https://playwright.dev/",
    )
    assert history[0]["action"] == "navigate"
    assert history[0]["url"] == "https://playwright.dev/"


def test_append_recipe_replay_history_verify():
    history: list[dict] = []
    append_recipe_replay_history(
        history,
        "Verify Getting Started page is displayed",
        description="Verify Getting Started page is displayed",
        url="https://playwright.dev/docs/intro",
    )
    assert history[0]["action"] == "assert_visible_page"


def test_build_nl_aligned_codegen_history_covers_verifies_and_back():
    history = build_nl_aligned_codegen_history(
        [
            "Navigate to https://playwright.dev/",
            "Verify Playwright homepage loads successfully",
            "Click Get Started button",
            "Verify Getting Started page is displayed",
            "Verify page URL contains intro",
            "Navigate back to the previous page",
            "Verify Playwright Test section",
            'Capture screenshot of the "Chosen by companies" section',
            "Verify Copyright © 2026 Microsoft is displayed in the footer",
        ],
        captured_actions=[
            {
                "type": "click",
                "locators": [{"kind": "role", "value": "link", "name": "Get started"}],
            },
            {"type": "go_back"},
        ],
        url_sequence=[
            "https://playwright.dev/",
            "https://playwright.dev/docs/intro",
        ],
    )
    actions = [step["action"] for step in history]
    assert actions[0] == "navigate"
    assert actions[1] == "assert"
    assert history[1]["value"] == "__url_equals__:https://playwright.dev/"
    assert actions[2] == "click"
    assert '"name": "Get started"' in (history[2]["selector"] or "")
    assert actions[4] == "assert"
    assert history[4]["value"] == "__url_contains__:intro"
    assert actions[5] == "go_back"
    assert history[5].get("url") in (None, "")
    assert history[6]["value"] == "Playwright Test"
    assert '"kind": "text"' in (history[6]["selector"] or "")
    assert actions[7] == "screenshot"
    assert history[8]["value"] == "Copyright © 2026 Microsoft"


def test_link_visibility_uses_role_locator():
    history = build_nl_aligned_codegen_history(
        [
            "Navigate to https://playwright.dev/",
            "Verify Get started link is visible",
        ],
        url_sequence=["https://playwright.dev/"],
    )
    assert history[1]["action"] == "assert"
    assert history[1]["value"] == "Get started"
    assert '"value": "link"' in (history[1]["selector"] or "")
    assert '"name": "Get started"' in (history[1]["selector"] or "")
