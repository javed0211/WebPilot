import unittest

from integrations.browser_use.capability_contract import (
    build_postconditions,
    classify_failure,
    infer_intent,
    infer_safety,
    should_quarantine,
)


class CapabilityContractTests(unittest.TestCase):
    def test_infer_intent_navigate(self):
        self.assertEqual(infer_intent('Goto url "https://example.com/app"'), "navigate")

    def test_infer_intent_authenticate(self):
        self.assertEqual(
            infer_intent('login using <username> and password <password>'),
            "authenticate",
        )

    def test_mutate_steps_not_safe_to_replay(self):
        safety = infer_safety("mutate", "Submit the claim form")
        self.assertFalse(safety["safeToReplay"])
        self.assertEqual(safety["sideEffect"], "mutates_state")

    def test_authenticate_postconditions_forbid_auth_origins(self):
        post = build_postconditions(
            "authenticate",
            "login using valid credentials",
            {"urlPattern": "https://app.example.com/login"},
            {"urlPattern": "https://app.example.com/dashboard"},
        )
        self.assertIn("stay signed in", " ".join(post["notAllowedAnchors"]).lower())
        self.assertIn("login.microsoftonline.com", post.get("forbiddenOrigins", []))

    def test_authenticate_postconditions_use_after_app_origin(self):
        post = build_postconditions(
            "authenticate",
            "login using valid credentials",
            {"urlPattern": "https://login.microsoftonline.com/kmsi"},
            {"urlPattern": "https://app.example.com/dashboard", "url": "https://app.example.com/dashboard"},
        )
        self.assertEqual(post.get("urlRegex"), "app\\.example\\.com")
        self.assertIn("login.microsoftonline.com", post.get("forbiddenOrigins", []))

    def test_migrate_legacy_capability_adds_schema_v4(self):
        from integrations.browser_use.capability_contract import (
            SCHEMA_VERSION,
            migrate_legacy_capability,
        )

        legacy = {
            "schemaVersion": 2,
            "step": "Submit the claim form",
            "before": {"urlPattern": "https://app.example.com/form"},
            "after": {"urlPattern": "https://app.example.com/form", "evidence": []},
        }
        migrated = migrate_legacy_capability(legacy)
        self.assertEqual(migrated["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(migrated["intent"], "mutate")
        self.assertFalse(migrated["safety"]["safeToReplay"])

    def test_classify_auth_failure(self):
        self.assertEqual(classify_failure("auth interstitial detected"), "auth_required")

    def test_interact_postconditions_skip_brittle_evidence_text(self):
        post = build_postconditions(
            "interact",
            "Click Get Started",
            {"urlPattern": "https://playwright.dev/"},
            {
                "urlPattern": "https://playwright.dev/docs/intro",
                "evidence": [{"text": "Installation\u200b"}, {"text": "Introduction\u200b"}],
            },
        )
        self.assertEqual(post["requiredText"], [])
        self.assertEqual(post["requiredEvidence"], [])

    def test_preconditions_auth_phrases_only_for_authenticate(self):
        from integrations.browser_use.capability_contract import build_preconditions

        app_pre = build_preconditions(
            {"urlPattern": "https://playwright.dev/"},
            page_type="app",
            intent="interact",
        )
        self.assertEqual(app_pre["forbiddenText"], [])
        auth_pre = build_preconditions(
            {"urlPattern": "https://login.microsoftonline.com/"},
            page_type="auth_interstitial",
            intent="authenticate",
        )
        self.assertIn("sign in", auth_pre["forbiddenText"])

    def test_resolve_validation_contract_strips_zwsp_and_auth_noise(self):
        from integrations.browser_use.capability_contract import resolve_validation_contract

        healed = resolve_validation_contract(
            {
                "schemaVersion": 4,
                "intent": "interact",
                "step": 'Click "Get Started"',
                "pageType": "app",
                "postconditions": {
                    "requiredText": ["Installation\u200b", "Get Started"],
                    "requiredEvidence": [{"text": "Installation\u200b"}],
                },
            },
            "post",
        )
        self.assertEqual(healed["requiredEvidence"], [])
        self.assertEqual(healed["requiredText"], ["Get Started"])

        pre = resolve_validation_contract(
            {
                "schemaVersion": 4,
                "intent": "interact",
                "step": "Click Get Started",
                "pageType": "app",
                "preconditions": {
                    "forbiddenText": ["sign in", "stay signed in"],
                    "notAllowedAnchors": ["sign in"],
                },
            },
            "pre",
        )
        self.assertEqual(pre["forbiddenText"], [])
        self.assertEqual(pre["notAllowedAnchors"], [])


if __name__ == "__main__":
    unittest.main()
