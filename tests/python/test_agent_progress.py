"""Unit tests for agent progress formatting."""

from integrations.browser_use.agent_progress import (
    branding_current_text,
    format_action,
    format_agent_step,
)


class _State:
    def __init__(self, **kwargs):
        self.evaluation_previous_goal = kwargs.get("evaluation_previous_goal")
        self.next_goal = kwargs.get("next_goal")
        self.memory = kwargs.get("memory")
        self.thinking = kwargs.get("thinking")


class _Output:
    def __init__(self, state, actions=None):
        self.current_state = state
        self.action = actions or []


def test_format_click_with_role_locator():
    line = format_action(
        {
            "type": "click",
            "locators": [{"kind": "role", "value": "button", "name": "Search"}],
        }
    )
    assert line == 'click button "Search"'


def test_format_type_into_combobox():
    line = format_action(
        {
            "type": "input",
            "value": "London",
            "locators": [{"kind": "role", "value": "combobox", "name": "Where are you going?"}],
        }
    )
    assert 'type "London"' in line
    assert "Where are you going?" in line


def test_format_navigate_shortens_url():
    line = format_action(
        {"type": "navigate", "url": "https://www.booking.com/index.html?aid=1&long=query"}
    )
    assert line.startswith("navigate www.booking.com")
    assert "aid=" not in line


def test_format_agent_step_includes_goal_and_actions():
    output = _Output(
        _State(
            evaluation_previous_goal="Cookie banner dismissed. Verdict: Success",
            next_goal="Type London into the destination field.",
        )
    )
    text = format_agent_step(
        3,
        output,
        [
            {
                "type": "input",
                "value": "London",
                "locators": [{"kind": "role", "value": "combobox", "name": "Destination"}],
            }
        ],
    )
    assert "[Agent] #3" in text
    assert "eval[ok]:" in text
    assert "goal: Type London into the destination field." in text
    assert '→ type "London"' in text


def test_branding_prefers_next_goal():
    output = _Output(_State(next_goal="Click Search"))
    assert branding_current_text(output, "fallback") == "Click Search"
    assert branding_current_text(_Output(_State()), "fallback") == "fallback"
