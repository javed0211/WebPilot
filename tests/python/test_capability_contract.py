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

    def test_quarantine_only_for_locator_failures(self):
        self.assertFalse(should_quarantine("auth_required", 5))
        self.assertTrue(should_quarantine("locator_not_found", 2))


if __name__ == "__main__":
    unittest.main()
