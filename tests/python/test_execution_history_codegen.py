from integrations.browser_use.execution_history import (
    append_recipe_replay_history,
    append_replay_history_from_capability,
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
