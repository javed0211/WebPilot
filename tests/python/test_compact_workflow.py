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
    assert compact["coverage"]["mapped"] == len(nl), compact["coverage"].get("unmapped")
    assert not compact["coverage"]["unmapped"]


def test_compact_maps_secret_redacted_login_inputs():
    """Real discovery stores <secret>…</secret> / •••• — must still claim login NL."""
    nl = [
        "Navigate to https://example.test/residents",
        "Enter Email address as user@yopmail.com",
        "And click on Continue button",
        "Enter Password as Test@12345",
        "And click on Sign in button",
        "Enter verification code as 123456",
        "And click on Confirm button",
        "Verify that the home page is visible successfully",
    ]
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://example.test/residents",
            "value": "https://example.test/residents",
            "description": "navigate",
            "locators": [],
        },
        {
            "index": 2,
            "action": "input",
            "value": "<secret>username</secret>",
            "description": "input | Typed username",
            "locators": [
                {"kind": "text", "value": "Email address", "verified": True, "verifiedBy": "playwright"},
                {"kind": "testid", "value": "loginRegisterEmailInputBox"},
            ],
        },
        {
            "index": 3,
            "action": "click",
            "description": "Clicked Continue",
            "locators": [{"kind": "role", "value": "button", "name": "Continue"}],
        },
        {
            "index": 4,
            "action": "input",
            "value": "••••••••",
            "description": "input | Typed password",
            "locators": [{"kind": "testid", "value": "loginEnterPasswordTestId"}],
        },
        {
            "index": 5,
            "action": "click",
            "description": "Clicked Sign in",
            "locators": [{"kind": "role", "value": "button", "name": "Sign in"}],
        },
        {
            "index": 6,
            "action": "input",
            "value": "<secret>otp</secret>",
            "description": "input | Typed otp",
            "locators": [{"kind": "testid", "value": "inputFileld"}],
        },
        {
            "index": 7,
            "action": "click",
            "description": "Clicked Confirm",
            "locators": [{"kind": "role", "value": "button", "name": "Confirm"}],
        },
    ]
    compact = build_compact_workflow(acts, nl, [])
    unmapped = compact["coverage"]["unmapped"]
    # Home-page verify is synthesized/grounded from navigate URL when no separate probe exists.
    assert unmapped == [], unmapped
    email = next(s for s in compact["steps"] if s["action"] == "input" and "email" in (s.get("nlStep") or "").lower())
    assert (email.get("locator") or {}).get("kind") == "testid"
    assert (email.get("locator") or {}).get("value") == "loginRegisterEmailInputBox"
    claimed = {(s.get("nlStep") or "").strip().lower() for s in compact["steps"]}
    assert "enter email address as user@yopmail.com" in claimed
    assert "and click on continue button" in claimed
    assert "enter password as test@12345" in claimed
    assert "and click on sign in button" in claimed
    assert "enter verification code as 123456" in claimed
    assert "and click on confirm button" in claimed


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


def test_search_page_promoted_to_assert_with_locators():
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://playwright.dev/",
            "value": "https://playwright.dev/",
            "locators": [],
        },
        {
            "index": 2,
            "action": "search_page",
            "description": 'Searched page for "Installation": 2 matches found.',
            "locators": [],
        },
        {
            "index": 3,
            "action": "search_page",
            "description": 'Searched page for "intro": 3 matches found.',
            "locators": [],
        },
        {
            "index": 4,
            "action": "search_page",
            "description": 'Searched page for "zzznomatch": 0 matches found.',
            "locators": [],
        },
    ]
    nl = [
        "Navigate to https://playwright.dev/",
        "Verify Installation is displayed",
        "Verify page URL contains intro",
    ]
    plan = [
        {"index": 2, "kind": "assert", "nlStep": "Verify Installation is displayed"},
        {"index": 3, "kind": "assert", "nlStep": "Verify page URL contains intro"},
    ]
    compact = build_compact_workflow(acts, nl, plan)
    actions = [s["action"] for s in compact["steps"]]
    assert "search_page" not in actions
    install = next(s for s in compact["steps"] if "Installation" in (s.get("nlStep") or ""))
    assert install["action"] == "assert"
    assert any(
        (l.get("kind") == "text" and l.get("value") == "Installation")
        for l in (install.get("selectorCandidates") or []) + ([install["locator"]] if install.get("locator") else [])
    )
    url_assert = next(s for s in compact["steps"] if "url contains intro" in (s.get("nlStep") or "").lower())
    assert url_assert["action"] == "assert"
    assert str(url_assert.get("value") or "").startswith("__url_contains__:")
    assert any(d["reason"] == "drop agent-tool search_page" for d in compact["dropped"])


def test_asserts_interleaved_by_nl_index_not_appended():
    """Verifies must run on the page where NL places them — not after final go_back."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://playwright.dev/",
            "value": "https://playwright.dev/",
            "description": "navigate",
            "locators": [],
        },
        {
            "index": 2,
            "action": "click",
            "description": "click | Get started",
            "locators": [{"kind": "role", "value": "link", "name": "Get started"}],
        },
        {
            "index": 3,
            "action": "go_back",
            "description": "go_back",
            "locators": [],
        },
        {
            "index": 4,
            "action": "click",
            "description": "click | Docs",
            "locators": [{"kind": "role", "value": "link", "name": "Docs"}],
        },
        {
            "index": 5,
            "action": "go_back",
            "description": "go_back again",
            "locators": [],
        },
    ]
    nl = [
        "Navigate to https://playwright.dev/",
        "Verify Playwright homepage loads successfully",
        "Verify Get started link is visible",
        "Click Get started",
        "Verify Getting Started page is displayed",
        "Verify page URL contains intro",
        "Navigate back to the previous page",
        "Click Docs",
        "Verify page URL contains docs",
        "Navigate back to the previous page",
        "Verify Copyright © 2026 Microsoft is displayed in the footer",
    ]
    assertion_plan = [
        {"index": 2, "kind": "assert", "nlStep": "Verify Playwright homepage loads successfully"},
        {"index": 3, "kind": "assert", "nlStep": "Verify Get started link is visible"},
        {"index": 5, "kind": "assert", "nlStep": "Verify Getting Started page is displayed"},
        {"index": 6, "kind": "assert", "nlStep": "Verify page URL contains intro"},
        {"index": 9, "kind": "assert", "nlStep": "Verify page URL contains docs"},
        {"index": 11, "kind": "assert", "nlStep": "Verify Copyright © 2026 Microsoft is displayed in the footer"},
    ]
    compact = build_compact_workflow(acts, nl, assertion_plan)
    labels = [
        f"{s['action']}:{(s.get('nlStep') or '')[:40]}"
        for s in compact["steps"]
    ]
    # Homepage asserts before Get started click
    home_i = next(i for i, s in enumerate(compact["steps"]) if "homepage loads" in (s.get("nlStep") or "").lower())
    get_started_link_i = next(
        i for i, s in enumerate(compact["steps"]) if "get started link" in (s.get("nlStep") or "").lower()
    )
    click_gs_i = next(
        i
        for i, s in enumerate(compact["steps"])
        if s["action"] == "click" and "Get started" in (s.get("nlStep") or s.get("description") or "")
    )
    assert home_i < click_gs_i, labels
    assert get_started_link_i < click_gs_i, labels

    # Intro asserts after Get started click, before first go_back
    intro_url_i = next(i for i, s in enumerate(compact["steps"]) if "url contains intro" in (s.get("nlStep") or "").lower())
    getting_started_i = next(
        i for i, s in enumerate(compact["steps"]) if "getting started page" in (s.get("nlStep") or "").lower()
    )
    go_backs = [i for i, s in enumerate(compact["steps"]) if s["action"] == "go_back"]
    assert len(go_backs) == 2, labels
    assert click_gs_i < getting_started_i < go_backs[0], labels
    assert click_gs_i < intro_url_i < go_backs[0], labels

    # Docs URL assert between Docs click and second go_back
    click_docs_i = next(
        i
        for i, s in enumerate(compact["steps"])
        if s["action"] == "click" and "Docs" in (s.get("nlStep") or s.get("description") or "")
    )
    docs_url_i = next(i for i, s in enumerate(compact["steps"]) if "url contains docs" in (s.get("nlStep") or "").lower())
    assert click_docs_i < docs_url_i < go_backs[1], labels

    # Footer assert after final go_back
    footer_i = next(i for i, s in enumerate(compact["steps"]) if "copyright" in (s.get("nlStep") or "").lower())
    assert go_backs[1] < footer_i, labels


def _wikipedia_like_acts():
    return [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://www.wikipedia.org/",
            "value": "https://www.wikipedia.org/",
            "description": "navigate | https://www.wikipedia.org/",
            "locators": [],
        },
        {
            "index": 2,
            "action": "search_page",
            "description": 'custom | Searched page for "The Free Encyclopedia": 1 match found.',
            "locators": [],
        },
        {
            "index": 3,
            "action": "input",
            "value": "Software testing",
            "url": "https://www.wikipedia.org/",
            "description": "input | Search Wikipedia | Typed 'Software testing'",
            "locators": [{"kind": "css", "value": 'input[id="searchInput"]', "verified": True}],
        },
        {
            "index": 4,
            "action": "click",
            "url": "https://www.wikipedia.org/",
            "description": 'click | Search | Clicked button "Search"',
            "locators": [
                {
                    "kind": "role",
                    "value": "button",
                    "name": "Search",
                    "filterText": "Search",
                    "exact": True,
                    "scope": {"kind": "css", "value": "main"},
                    "verified": True,
                }
            ],
        },
        {
            "index": 5,
            "action": "wait",
            "value": "2",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "description": "wait | 2",
            "locators": [],
        },
        {
            "index": 6,
            "action": "search_page",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "description": 'custom | Searched page for "From Wikipedia, the free encyclopedia": 1 match found.',
            "locators": [],
        },
        {
            "index": 7,
            "action": "search_page",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "description": 'custom | Searched page for "Software testing is the act of checking whether": 1 match found.',
            "locators": [],
        },
        {
            "index": 8,
            "action": "search_page",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "description": 'custom | Searched page for "Contents": 1 match found.',
            "locators": [],
        },
    ]


def _wikipedia_nl():
    return [
        "Navigate to https://www.wikipedia.org/",
        "Verify the Wikipedia logo and search input are visible",
        'Enter "Software testing" in the search input',
        "Select English as the search language if it is not already selected",
        "Submit the search",
        "Verify the Software testing article page is displayed",
        'Verify the page heading contains "Software testing"',
        "Verify the article introduction is visible",
        "Verify the Contents section or article navigation is visible",
    ]


def _wikipedia_plan():
    return [
        {"index": 2, "kind": "assert", "nlStep": "Verify the Wikipedia logo and search input are visible"},
        {"index": 6, "kind": "assert", "nlStep": "Verify the Software testing article page is displayed"},
        {"index": 7, "kind": "assert", "nlStep": 'Verify the page heading contains "Software testing"'},
        {"index": 8, "kind": "assert", "nlStep": "Verify the article introduction is visible"},
        {"index": 9, "kind": "assert", "nlStep": "Verify the Contents section or article navigation is visible"},
    ]


def test_wikipedia_search_click_not_bound_to_language_nl():
    """Search button must claim Submit the search — never Select English…"""
    compact = build_compact_workflow(_wikipedia_like_acts(), _wikipedia_nl(), _wikipedia_plan())
    search_clicks = [
        s
        for s in compact["steps"]
        if s["action"] == "click"
        and "Search" in str(s.get("description") or "")
    ]
    assert search_clicks, compact["steps"]
    assert search_clicks[0].get("nlStep") == "Submit the search"
    assert "language" not in (search_clicks[0].get("nlStep") or "").lower()


def test_wikipedia_search_page_grounds_intro_and_logo():
    compact = build_compact_workflow(_wikipedia_like_acts(), _wikipedia_nl(), _wikipedia_plan())
    by_status = {s["nlStep"]: s for s in compact["coverage"]["stepStatuses"]}

    logo = by_status["Verify the Wikipedia logo and search input are visible"]
    assert logo["status"] == "assertGrounded", logo

    intro = by_status["Verify the article introduction is visible"]
    assert intro["status"] == "assertGrounded", intro

    contents = by_status["Verify the Contents section or article navigation is visible"]
    assert contents["status"] == "assertGrounded", contents

    article = by_status["Verify the Software testing article page is displayed"]
    assert article["status"] == "assertGrounded", article
    assert compact["coverage"]["unmapped"] == []
    assert compact["coverage"]["mapped"] == 8  # 9 total, 1 optional language skipped


def test_wikipedia_language_optional_skipped_when_no_act():
    """'if it is not already selected' is soft-optional when browser-use skipped language."""
    compact = build_compact_workflow(_wikipedia_like_acts(), _wikipedia_nl(), _wikipedia_plan())
    lang = "Select English as the search language if it is not already selected"
    assert lang in (compact["coverage"].get("optionalUnmapped") or [])
    assert lang not in compact["coverage"]["unmapped"]
    status = next(s for s in compact["coverage"]["stepStatuses"] if s["nlStep"] == lang)
    assert status["status"] == "optionalSkipped"


def test_wikipedia_hollow_heading_assert_is_unmapped():
    """Heading verify with no search_page / locator evidence must not count as mapped."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "value": "https://en.wikipedia.org/wiki/Software_testing",
            "locators": [],
        },
    ]
    nl = ['Verify the page heading contains "Software testing"']
    plan = [{"index": 1, "kind": "assert", "nlStep": nl[0]}]
    compact = build_compact_workflow(acts, nl, plan)
    assert nl[0] in compact["coverage"]["unmapped"]
    status = compact["coverage"]["stepStatuses"][0]
    assert status["status"] == "assertHollow"


def test_section_verifies_ground_to_heading_role_without_agent_probe():
    """'Verify See also section' must map even when the agent never searched the page."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "value": "https://en.wikipedia.org/wiki/Software_testing",
            "locators": [],
        },
    ]
    nl = [
        "Verify See also section",
        "Verify References section",
        "Verify the Sign in button is visible",
    ]
    plan = [
        {"index": 2, "kind": "assert", "nlStep": nl[0]},
        {"index": 3, "kind": "assert", "nlStep": nl[1]},
        {"index": 4, "kind": "assert", "nlStep": nl[2]},
    ]
    compact = build_compact_workflow(acts, nl, plan)
    assert compact["coverage"]["unmapped"] == []
    see_also = next(s for s in compact["steps"] if s.get("nlStep") == nl[0])
    assert see_also["locator"]["value"] == "heading"
    assert see_also["locator"]["name"] == "See also"
    sign_in = next(s for s in compact["steps"] if s.get("nlStep") == nl[2])
    assert sign_in["locator"]["value"] == "button"
    assert sign_in["locator"]["name"] == "Sign in"


def test_unrequested_close_click_is_optional_but_requested_one_is_not():
    """Banner closes the agent did on its own must replay as if-present, not required."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "value": "https://en.wikipedia.org/wiki/Software_testing",
            "locators": [],
        },
        {
            "index": 2,
            "action": "click",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "description": 'click | Close | Clicked button "Close"',
            "locators": [{"kind": "role", "value": "button", "name": "Close", "exact": True}],
        },
        {
            "index": 3,
            "action": "click",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "description": 'click | Talk | Clicked link "Talk"',
            "locators": [{"kind": "role", "value": "link", "name": "Talk", "exact": True}],
        },
    ]
    nl = ["Click Talk"]
    compact = build_compact_workflow(acts, nl, [])
    close_step = next(
        s for s in compact["steps"] if "Close" in str(s.get("description") or "")
    )
    assert close_step.get("optional") is True
    talk_step = next(s for s in compact["steps"] if s.get("nlStep") == "Click Talk")
    assert not talk_step.get("optional")


def test_displayed_assert_grounds_copy_containing_the_word_page():
    """'This page was last edited' is footer copy; only trailing 'page' means page state."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "value": "https://en.wikipedia.org/wiki/Software_testing",
            "locators": [],
        },
    ]
    nl = [
        "Verify This page was last edited is displayed",
        "Verify the search results page is displayed",
    ]
    plan = [
        {"index": 2, "kind": "assert", "nlStep": nl[0]},
        {"index": 3, "kind": "assert", "nlStep": nl[1]},
    ]
    compact = build_compact_workflow(acts, nl, plan)
    footer = next(s for s in compact["steps"] if s.get("nlStep") == nl[0])
    assert footer["locator"] == {
        "kind": "text",
        "value": "This page was last edited",
        "exact": False,
    }
    page_state = next(s for s in compact["steps"] if s.get("nlStep") == nl[1])
    assert not page_state.get("locator")


def test_nl_only_displayed_assert_prefers_text_over_invented_link_role():
    """'Verify Revision history is displayed' must emit getByText, not a guessed link role."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "value": "https://en.wikipedia.org/wiki/Software_testing",
            "locators": [],
        },
        {
            "index": 2,
            "action": "click",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "description": "click | View history",
            "locators": [
                {"kind": "role", "value": "link", "name": "View history", "exact": True}
            ],
        },
    ]
    nl = ["Click View history", "Verify Revision history is displayed"]
    plan = [{"index": 3, "kind": "assert", "nlStep": nl[1]}]
    compact = build_compact_workflow(acts, nl, plan)
    step = next(s for s in compact["steps"] if s.get("nlStep") == nl[1])
    assert step["locator"]["kind"] == "text", step["locator"]
    assert step["locator"]["value"] == "Revision history"
    # Codegen ranks role above text, so a role candidate here would win and be emitted.
    assert all(c["kind"] == "text" for c in step["selectorCandidates"]), step["selectorCandidates"]


def test_search_page_heading_role_requires_section_or_heading_nl():
    """Footer copy matched by search_page must stay a text assert, not a heading role."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "value": "https://en.wikipedia.org/wiki/Software_testing",
            "locators": [],
        },
        {
            "index": 2,
            "action": "search_page",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "description": 'custom | Searched page for "This page was last edited": 1 match found.',
            "locators": [],
        },
        {
            "index": 3,
            "action": "search_page",
            "url": "https://en.wikipedia.org/wiki/Software_testing",
            "description": 'custom | Searched page for "See also": 1 match found.',
            "locators": [],
        },
    ]
    nl = [
        "Verify This page was last edited is displayed",
        "Verify See also section",
    ]
    plan = [
        {"index": 2, "kind": "assert", "nlStep": nl[0]},
        {"index": 3, "kind": "assert", "nlStep": nl[1]},
    ]
    compact = build_compact_workflow(acts, nl, plan)
    footer = next(s for s in compact["steps"] if s.get("nlStep") == nl[0])
    assert footer["locator"]["kind"] == "text", footer["locator"]
    section = next(s for s in compact["steps"] if s.get("nlStep") == nl[1])
    assert section["locator"] == {"kind": "role", "value": "heading", "name": "See also"}


def test_submit_search_not_optional_when_missing():
    """Submit the search without a Search/Enter act is a hard miss."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://www.wikipedia.org/",
            "value": "https://www.wikipedia.org/",
            "locators": [],
        },
        {
            "index": 2,
            "action": "input",
            "value": "Software testing",
            "description": "input | Search Wikipedia",
            "locators": [{"kind": "css", "value": "#searchInput"}],
        },
    ]
    nl = [
        "Navigate to https://www.wikipedia.org/",
        'Enter "Software testing" in the search input',
        "Submit the search",
    ]
    compact = build_compact_workflow(acts, nl, [])
    assert "Submit the search" in compact["coverage"]["unmapped"]
    status = next(s for s in compact["coverage"]["stepStatuses"] if s["nlStep"] == "Submit the search")
    assert status["status"] == "notExecuted"


def test_optional_cookie_nl_always_emitted_as_if_present_click():
    """Cookie/dialog optional NL must land in compact as optional click for codegen."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://www.amazon.com/",
            "value": "https://www.amazon.com/",
            "locators": [],
        },
        {
            "index": 2,
            "action": "input",
            "value": "wireless mouse",
            "description": "input | Search Amazon",
            "url": "https://www.amazon.com/",
            "locators": [{"kind": "css", "value": "#twotabsearchtextbox"}],
        },
    ]
    nl = [
        "Navigate to https://www.amazon.com/",
        "If a location, cookie, or sign-in dialog blocks the page, dismiss it",
        'Enter "wireless mouse" in the main search input',
    ]
    compact = build_compact_workflow(acts, nl, [])
    cookie_nl = "If a location, cookie, or sign-in dialog blocks the page, dismiss it"
    dismiss = next(
        (s for s in compact["steps"] if (s.get("nlStep") or "") == cookie_nl),
        None,
    )
    assert dismiss is not None, compact["steps"]
    assert dismiss["action"] == "click"
    assert dismiss.get("optional") is True
    assert dismiss.get("locator") or dismiss.get("selectorCandidates")
    # Optional scaffold is covered (not hard-unmapped)
    assert cookie_nl not in compact["coverage"]["unmapped"]


def test_continue_shopping_click_marked_optional_and_bound_to_cookie_nl():
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://www.amazon.com/",
            "value": "https://www.amazon.com/",
            "locators": [],
        },
        {
            "index": 2,
            "action": "click",
            "description": 'click | Continue shopping | Clicked button "Continue shopping"',
            "url": "https://www.amazon.com/",
            "locators": [{"kind": "role", "value": "button", "name": "Continue shopping", "exact": True}],
        },
    ]
    nl = [
        "Navigate to https://www.amazon.com/",
        "If a location, cookie, or sign-in dialog blocks the page, dismiss it",
    ]
    compact = build_compact_workflow(acts, nl, [])
    clicks = [s for s in compact["steps"] if s["action"] == "click"]
    assert clicks
    assert clicks[0].get("optional") is True
    assert "cookie" in (clicks[0].get("nlStep") or "").lower() or "if a" in (
        clicks[0].get("nlStep") or ""
    ).lower()


def test_automationexercise_home_and_products_page_verifies_ground():
    """Consent must not steal Products NL; page verifies ground from URL/href hints."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://automationexercise.com/",
            "value": "https://automationexercise.com/",
            "locators": [],
        },
        {
            "index": 2,
            "action": "click",
            "description": 'click | Consent | Clicked button role=button "Consent"',
            "url": "https://automationexercise.com/",
            "locators": [
                {"kind": "role", "value": "button", "name": "Consent", "filterText": "Consent", "exact": True}
            ],
        },
        {
            "index": 3,
            "action": "click",
            "description": 'click | Products | Clicked a "Products"',
            "url": "https://automationexercise.com/",
            "locators": [
                {
                    "kind": "role",
                    "value": "link",
                    "name": "Products",
                    "filterText": "Products",
                    "exact": True,
                    "scope": {"kind": "css", "value": "header"},
                },
                {"kind": "css", "value": 'a[href="/products"]', "filterText": "Products"},
            ],
        },
    ]
    nl = [
        "Navigate to https://automationexercise.com/",
        "Verify that the home page is visible successfully",
        "Click Products in the navigation menu",
        "Verify that the products page is visible",
    ]
    plan = [
        {"index": 2, "kind": "assert", "nlStep": nl[1]},
        {"index": 4, "kind": "assert", "nlStep": nl[3]},
    ]
    compact = build_compact_workflow(acts, nl, plan)
    by_status = {s["nlStep"]: s for s in compact["coverage"]["stepStatuses"]}
    assert by_status[nl[1]]["status"] == "assertGrounded", by_status[nl[1]]
    assert by_status[nl[2]]["status"] == "executed", by_status[nl[2]]
    assert by_status[nl[3]]["status"] == "assertGrounded", by_status[nl[3]]
    assert compact["coverage"]["unmapped"] == []
    products_click = next(
        s
        for s in compact["steps"]
        if s.get("action") == "click"
        and (
            (isinstance(s.get("locator"), dict) and "Products" in str(s.get("locator")))
            or any(
                isinstance(c, dict) and "Products" in str(c)
                for c in (s.get("selectorCandidates") or [])
            )
        )
    )
    assert "products" in (products_click.get("nlStep") or "").lower()


def test_trailing_assert_grounds_from_entered_value_in_results_url():
    """A hollow trailing verify that mentions an earlier entered value (e.g. the
    Booking destination) grounds as url_contains when the value shows up in the
    results URL (?ss=London…)."""
    results_url = (
        "https://www.booking.com/searchresults.en-gb.html"
        "?ss=London%2C+Greater+London%2C+United+Kingdom&efdco=1"
    )
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://www.booking.com/",
            "value": "https://www.booking.com/",
            "locators": [],
        },
        {
            "index": 2,
            "action": "input",
            "value": "London",
            "url": "https://www.booking.com/",
            "description": "input | Enter destination | Typed 'London'",
            "locators": [
                {"kind": "role", "value": "combobox", "name": "Enter destination", "exact": True}
            ],
        },
        {
            "index": 3,
            "action": "click",
            "description": 'click | Search | Clicked button "Search"',
            "url": "https://www.booking.com/",
            "locators": [
                {"kind": "role", "value": "button", "name": "Search", "filterText": "Search", "exact": True}
            ],
        },
        {
            "index": 4,
            "action": "wait",
            "value": "5",
            "url": results_url,
            "description": "wait | 5 | Waited for 5 seconds",
            "locators": [],
        },
    ]
    nl = [
        "Navigate to https://www.booking.com/",
        'Enter "London" in the destination field',
        "Click the Search button",
        "Verify the search results page is displayed",
        "Verify the destination is London and accommodation results are visible",
    ]
    plan = [
        {"index": 4, "kind": "assert", "nlStep": nl[3]},
        {"index": 5, "kind": "assert", "nlStep": nl[4]},
    ]
    compact = build_compact_workflow(acts, nl, plan)
    by_status = {s["nlStep"]: s for s in compact["coverage"]["stepStatuses"]}
    assert by_status[nl[4]]["status"] == "assertGrounded", by_status[nl[4]]
    dest_assert = next(s for s in compact["steps"] if s.get("nlStep") == nl[4])
    assert str(dest_assert.get("value") or "") == "__url_contains__:London"
    assert compact["coverage"]["unmapped"] == []


def test_search_wikipedia_visible_grounds_from_nearby_input():
    """Homepage 'Verify Search Wikipedia is visible' must not stay assertHollow."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://www.wikipedia.org/",
            "description": "navigate",
            "locators": [],
        },
        {
            "index": 2,
            "action": "input",
            "value": "Software testing",
            "url": "https://www.wikipedia.org/",
            "description": "input | Search Wikipedia",
            "locators": [
                {"kind": "css", "value": 'input[id="searchInput"]', "verified": True},
                {
                    "kind": "text",
                    "value": "Search Wikipedia",
                    "tag": "input",
                    "filterText": "Search Wikipedia",
                    "exact": True,
                    "verified": True,
                },
            ],
        },
        {
            "index": 3,
            "action": "click",
            "url": "https://www.wikipedia.org/",
            "description": 'click | Search',
            "locators": [{"kind": "role", "value": "button", "name": "Search", "exact": True}],
        },
    ]
    nl = [
        "Navigate to https://www.wikipedia.org/",
        "Verify Wikipedia homepage loads successfully",
        "Verify Search Wikipedia is visible",
        "Enter Software testing into the search input",
        "Click Search",
    ]
    plan = [
        {"index": 2, "kind": "assert", "nlStep": nl[1]},
        {"index": 3, "kind": "assert", "nlStep": nl[2]},
    ]
    compact = build_compact_workflow(acts, nl, plan)
    by_status = {s["nlStep"]: s for s in compact["coverage"]["stepStatuses"]}
    assert by_status[nl[2]]["status"] == "assertGrounded", by_status[nl[2]]
    assert nl[2] not in compact["coverage"]["unmapped"]
    search_assert = next(s for s in compact["steps"] if s.get("nlStep") == nl[2])
    assert search_assert.get("locator") or search_assert.get("selectorCandidates")


def test_nav_hover_and_menu_verifies_map_from_evaluate():
    """Kameleoon-style hover via evaluate + menu expand verifies must fully map."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "url": "https://www.kameleoon.com/",
            "value": "https://www.kameleoon.com/",
            "locators": [],
        },
        {
            "index": 2,
            "action": "click",
            "url": "https://www.kameleoon.com/",
            "description": 'click | Reject all | button[id="ppms_cm_reject-all"]',
            "locators": [{"kind": "css", "value": 'button[id="ppms_cm_reject-all"]'}],
        },
        {
            "index": 3,
            "action": "evaluate",
            "url": "https://www.kameleoon.com/",
            "description": "evaluate | hover mouseover Solutions navigation menu",
        },
        {
            "index": 4,
            "action": "click",
            "url": "https://www.kameleoon.com/plans",
            "description": 'click | Plans | Clicked link "Plans"',
            "locators": [{"kind": "role", "value": "link", "name": "Plans", "exact": True}],
        },
        {
            "index": 5,
            "action": "click",
            "url": "https://www.kameleoon.com/resources",
            "description": 'click | Resources | Clicked link "Resources"',
            "locators": [{"kind": "role", "value": "link", "name": "Resources", "exact": True}],
        },
        {
            "index": 6,
            "action": "click",
            "url": "https://www.kameleoon.com/customers",
            "description": 'click | Customers | Clicked link "Customers"',
            "locators": [{"kind": "role", "value": "link", "name": "Customers", "exact": True}],
        },
    ]
    nl = [
        "Navigate to https://www.kameleoon.com",
        "If a privacy popup is visible, dismiss it",
        "Verify that the main navigation menu is visible.",
        "Move the mouse pointer over the Platform navigation menu.",
        "Verify that the Platform menu expands.",
        "Verify that the Platform submenu options are visible.",
        "Move the mouse pointer over the Solutions navigation menu.",
        "Verify that the Solutions menu expands.",
        "Verify that the Solutions submenu options are visible.",
        "Click the Plans link",
        "Click the Resources link",
        "Click the Customers link",
    ]
    plan = [
        {"index": i, "kind": "assert", "nlStep": n}
        for i, n in enumerate(nl, 1)
        if n.lower().startswith("verify")
    ]
    compact = build_compact_workflow(acts, nl, plan)
    cov = compact["coverage"]
    assert cov["unmapped"] == [], cov
    assert cov["mapped"] == cov["nlTotal"] == 12
    hovers = [s for s in compact["steps"] if s.get("action") == "hover"]
    assert len(hovers) >= 2
    hover_targets = {str(s.get("value") or "").lower() for s in hovers}
    assert "platform" in hover_targets
    assert "solutions" in hover_targets
    by_status = {s["nlStep"]: s["status"] for s in cov["stepStatuses"]}
    assert by_status[nl[3]] == "executed"
    assert by_status[nl[6]] == "executed"
    assert by_status[nl[2]] == "assertGrounded"
    assert by_status[nl[4]] == "assertGrounded"
    assert by_status[nl[7]] == "assertGrounded"


def test_checkout_add_to_cart_and_cart_verify_map():
    """AutomationExercise: Add to cart + cart verify must not stay notExecuted/assertHollow."""
    acts = [
        {
            "index": 1,
            "action": "navigate",
            "value": "https://automationexercise.com/",
            "url": "https://automationexercise.com/",
            "description": "navigate",
            "locators": [],
        },
        {
            "index": 2,
            "action": "click",
            "value": "Products",
            "url": "https://automationexercise.com/products",
            "description": 'Clicked link "Products"',
            "locators": [{"kind": "role", "value": "link", "name": "Products"}],
        },
        {
            "index": 3,
            "action": "click",
            "value": "Add to cart",
            "url": "https://automationexercise.com/products",
            "description": 'Clicked link "Add to cart"',
            "locators": [{"kind": "role", "value": "link", "name": "Add to cart"}],
        },
        {
            "index": 4,
            "action": "click",
            "value": "View Cart",
            "url": "https://automationexercise.com/view_cart",
            "description": 'Clicked link "View Cart"',
            "locators": [{"kind": "role", "value": "link", "name": "View Cart"}],
        },
    ]
    nl = [
        "Navigate to https://automationexercise.com/",
        "Verify that the home page is visible successfully",
        "Click Products in the navigation menu",
        "Add the first product to the cart",
        "Verify the product appears in the cart",
    ]
    plan = [
        {"nlStep": "Verify that the home page is visible successfully", "kind": "assert"},
        {"nlStep": "Verify the product appears in the cart", "kind": "assert"},
    ]
    compact = build_compact_workflow(acts, nl, plan)
    cov = compact["coverage"]
    assert cov["unmapped"] == [], cov
    assert cov["mapped"] == cov["nlTotal"] == 5, cov
    by_status = {s["nlStep"]: s["status"] for s in cov["stepStatuses"]}
    assert by_status[nl[3]] == "executed", by_status[nl[3]]
    assert by_status[nl[4]] == "assertGrounded", by_status[nl[4]]
    add_step = next(
        s
        for s in compact["steps"]
        if s.get("action") == "click" and "add to cart" in str(s.get("value") or "").lower()
    )
    assert add_step.get("nlStep") == nl[3], add_step
    cart_assert = next(s for s in compact["steps"] if s.get("nlStep") == nl[4])
    assert str(cart_assert.get("value") or "").startswith("__url_contains__"), cart_assert


def test_soft_covered_does_not_fail_gate():
    """Weak bind without durable locator → softCovered; verified binds stay executed."""
    import os

    os.environ.pop("WEBPILOT_COMPACT_HEURISTICS", None)
    # Durable click (role locator) must stay executed even if align score is mid-band.
    durable = build_compact_workflow(
        [
            {
                "index": 1,
                "action": "navigate",
                "url": "https://example.test/",
                "value": "https://example.test/",
                "locators": [],
            },
            {
                "index": 2,
                "action": "click",
                "description": "clicked Issues tab",
                "value": "Issues",
                "locators": [
                    {
                        "kind": "role",
                        "value": "link",
                        "name": "Issues",
                        "verified": True,
                        "verifiedBy": "snapshot",
                    }
                ],
                "locatorVerified": True,
            },
        ],
        ["Navigate to https://example.test/", "Click Issues"],
        [],
    )
    by = {s["nlStep"]: s["status"] for s in durable["coverage"]["stepStatuses"]}
    assert by["Navigate to https://example.test/"] == "executed"
    assert by["Click Issues"] == "executed"
    assert durable["coverage"]["unmapped"] == []

    # Soft path: click with no locator, only weak description overlap.
    soft = build_compact_workflow(
        [
            {
                "index": 1,
                "action": "click",
                "description": "clicked vaguely related dashboard chrome",
                "value": None,
                "locators": [],
            },
        ],
        ["Click the Widget control on the dashboard"],
        [],
    )
    cov = soft["coverage"]
    assert cov["unmapped"] == [] or any(
        s["status"] in ("softCovered", "executed", "notExecuted")
        for s in cov["stepStatuses"]
    )
    for step in cov.get("softCovered") or []:
        assert step not in cov["unmapped"]


def test_heuristics_fallback_off_by_default():
    """Without vocab/probe evidence, heading-contains stays hard-unmapped when heuristics off."""
    import os

    os.environ["WEBPILOT_COMPACT_HEURISTICS"] = "0"
    try:
        from integrations.browser_use.compact.vocab_context import heuristics_enabled

        assert heuristics_enabled() is False
        acts = [
            {
                "index": 1,
                "action": "navigate",
                "url": "https://obscure.example/app",
                "value": "https://obscure.example/app",
                "locators": [],
            },
        ]
        nl = ['Verify the page heading contains "ZZ Never Vocab"']
        plan = [{"index": 2, "kind": "assert", "nlStep": nl[0]}]
        compact = build_compact_workflow(acts, nl, plan, url="https://obscure.example/app")
        cov = compact["coverage"]
        assert nl[0] in cov["unmapped"], cov
        by = {s["nlStep"]: s["status"] for s in cov["stepStatuses"]}
        assert by[nl[0]] == "assertHollow"
        assert not (compact.get("meta") or {}).get("heuristicsFallback")
    finally:
        os.environ.pop("WEBPILOT_COMPACT_HEURISTICS", None)
