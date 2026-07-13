import unittest
from types import SimpleNamespace

from integrations.browser_use.knowledge import (
    CONSENT_TERMS,
    _is_consent_anchor,
    _locator_candidates,
    _step_requests_stay_signed_in_choice,
    _url_pattern_matches,
    capability_from_step,
    find_capability,
    history_indicates_step_action_succeeded,
    progressive_outcome_indicates_success,
    step_signature,
)


class SiteKnowledgeTests(unittest.TestCase):
    def test_step_signature_preserves_parameters(self):
        self.assertNotEqual(
            step_signature("Navigate to https://example.com/a"),
            step_signature("Navigate to https://example.com/b"),
        )

    def test_capability_lookup_requires_current_page_and_exact_step(self):
        data = {
            "schemaVersion": 2,
            "capabilities": [
                {
                    "stepSignature": "click search",
                    "status": "trusted",
                    "successCount": 2,
                    "before": {"urlPattern": "https://example.com/"},
                }
            ],
        }
        self.assertIsNotNone(find_capability(data, "Click search", "https://example.com/?q=1"))
        self.assertIsNone(find_capability(data, "Click search", "https://example.com/results"))
        self.assertIsNone(find_capability(data, "Click checkout", "https://example.com/"))

    def test_visual_assertion_is_not_learned_without_enough_dom_evidence(self):
        before = {
            "url": "https://example.com/",
            "urlPattern": "https://example.com/",
            "anchors": [],
        }
        after = {
            **before,
            "evidence": [{"tag": "input", "text": "Search"}],
        }
        capability = capability_from_step(
            "Verify the company logo and search input are visible",
            before,
            after,
            [],
        )
        self.assertIsNone(capability)


    def test_microsoft_auth_url_patterns_match_across_login_routes(self):
        stored = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        current = "https://login.microsoftonline.com/kmsi"
        self.assertTrue(_url_pattern_matches(stored, current))
        capability = find_capability(
            {
                "schemaVersion": 2,
                "capabilities": [
                    {
                        "stepSignature": "click yes",
                        "status": "trusted",
                        "successCount": 2,
                        "before": {"urlPattern": stored},
                    }
                ],
            },
            "Click Yes",
            current,
        )
        self.assertIsNotNone(capability)

    def test_stay_signed_in_step_detection(self):
        self.assertTrue(_step_requests_stay_signed_in_choice("Click Yes on Stay signed in page", "yes"))
        self.assertTrue(_step_requests_stay_signed_in_choice('Click "Yes" button', "yes"))
        self.assertFalse(_step_requests_stay_signed_in_choice("Click No on Stay signed in page", "yes"))

    def test_locator_candidates_prioritize_role_before_css(self):
        node = SimpleNamespace(
            tag_name="input",
            node_name="input",
            attributes={
                "type": "submit",
                "id": "idSIButton9",
                "value": "Yes",
            },
        )
        node.get_meaningful_text_for_llm = lambda: "Yes"
        candidates = _locator_candidates(node)
        self.assertGreater(len(candidates), 0)
        self.assertEqual(candidates[0]["kind"], "role")
        self.assertEqual(candidates[0]["value"], "button")
        self.assertEqual(candidates[0]["name"], "Yes")

    def test_consent_anchor_detection(self):
        self.assertTrue(_is_consent_anchor({"attrs": {"aria-label": "Accept all cookies"}}))
        self.assertFalse(_is_consent_anchor({"attrs": {"aria-label": "Sign in"}}))
        self.assertIn("onetrust", CONSENT_TERMS)

    def test_progressive_outcome_recovers_continue_to_password(self):
        before = {
            "url": "https://example.com/login",
            "anchors": [{"tag": "input", "attrs": {"aria-label": "Email address", "name": "email"}}],
            "evidence": [{"tag": "label", "text": "Email address"}],
            "bodyText": "Email address Continue",
        }
        after = {
            "url": "https://example.com/login",
            "anchors": [{"tag": "input", "attrs": {"aria-label": "Password", "type": "password", "name": "password"}}],
            "evidence": [{"tag": "label", "text": "Password"}],
            "bodyText": "Password Sign in",
        }
        actions = [{"type": "click", "locators": [{"kind": "role", "value": "button", "name": "Continue"}]}]
        self.assertTrue(
            progressive_outcome_indicates_success(
                "And click on Continue button",
                before,
                after,
                actions,
            )
        )
        self.assertFalse(
            progressive_outcome_indicates_success(
                "And click on Continue button",
                before,
                before,
                actions,
            )
        )

    def test_history_recovers_when_continue_click_logged_even_if_dom_unchanged(self):
        """Shadow-DOM auth pages often look identical to compact_page_state light DOM."""
        before = {
            "url": "https://example.com/login",
            "anchors": [],
            "evidence": [],
            "bodyText": "Enter Password as ... Continue",  # branding also mentions password
        }
        after = dict(before)
        history = SimpleNamespace(
            action_results=lambda: [
                SimpleNamespace(
                    error=None,
                    extracted_content='Clicked button "Continue"',
                    long_term_memory='Clicked button "Continue"',
                ),
                SimpleNamespace(
                    error=None,
                    extracted_content="Unable to find Continue",
                    long_term_memory="done",
                    is_done=True,
                    success=False,
                ),
            ]
        )
        self.assertTrue(
            history_indicates_step_action_succeeded(history, "And click on Continue button")
        )
        self.assertTrue(
            progressive_outcome_indicates_success(
                "And click on Continue button",
                before,
                after,
                actions=[],
                history=history,
            )
        )
        # Without history / DOM progress, do not invent success.
        self.assertFalse(
            progressive_outcome_indicates_success(
                "And click on Continue button",
                before,
                after,
                actions=[],
            )
        )


if __name__ == "__main__":
    unittest.main()
