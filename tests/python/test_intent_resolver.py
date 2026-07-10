import unittest

from integrations.browser_use.intent_resolver import (
    capability_match_score,
    detect_page_type,
    resolve_step_intent,
)


class IntentResolverTests(unittest.TestCase):
    def test_resolve_app_switcher_action(self):
        resolved = resolve_step_intent('Click the "application" link to change app')
        self.assertEqual(resolved["action"], "switch_application")
        self.assertEqual(resolved["pageTypeHint"], "app_switcher")

    def test_resolve_authenticate_action(self):
        resolved = resolve_step_intent("Enter password and sign in")
        self.assertEqual(resolved["intent"], "authenticate")
        self.assertEqual(resolved["action"], "authenticate")

    def test_detect_auth_interstitial_from_body(self):
        page_type = detect_page_type({
            "url": "https://login.microsoftonline.com/common/oauth2/authorize",
            "bodyText": "Stay signed in?",
            "title": "",
            "evidence": [],
        })
        self.assertEqual(page_type, "auth_interstitial")

    def test_detect_entity_list_in_crm_shell(self):
        page_type = detect_page_type({
            "url": "https://org.crm.dynamics.com/main.aspx",
            "bodyText": "Active accounts export filter account name",
            "title": "Accounts",
            "evidence": [],
        })
        self.assertEqual(page_type, "entity_list")

    def test_capability_match_prefers_matching_page_type(self):
        step = "Click search"
        page_state = {"url": "https://example.com/", "bodyText": "search box", "evidence": []}
        good = {
            "intentDescriptor": {"action": "click", "intent": "mutate", "targetLabel": ""},
            "pageType": "generic",
            "quality": {"confidence": 0.8},
            "successCount": 3,
        }
        bad = {
            "intentDescriptor": {"action": "click", "intent": "mutate", "targetLabel": ""},
            "pageType": "auth_interstitial",
            "quality": {"confidence": 0.9},
            "successCount": 5,
        }
        self.assertGreater(
            capability_match_score(good, step, page_state),
            capability_match_score(bad, step, page_state),
        )


if __name__ == "__main__":
    unittest.main()
