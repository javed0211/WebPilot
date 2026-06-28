import unittest

from integrations.browser_use.knowledge import (
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


if __name__ == "__main__":
    unittest.main()
