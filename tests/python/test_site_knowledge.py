import unittest
from types import SimpleNamespace

from integrations.browser_use.knowledge import (
    _locator_candidates,
    _step_requests_stay_signed_in_choice,
    _url_pattern_matches,
    capability_from_step,
    find_capability,
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


if __name__ == "__main__":
    unittest.main()
