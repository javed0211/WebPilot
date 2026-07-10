import unittest

from integrations.browser_use.auth_state import detect_auth_state
from integrations.browser_use.capability_contract import build_postconditions, route_failure
from integrations.browser_use.knowledge_merge import find_cross_scenario_capability, merge_capability_into_page_store
from integrations.browser_use.repair_prompt import build_scoped_task, failure_repair_hints
from integrations.browser_use.trust_scoring import promotion_context, record_promotion_trust, resolve_trust_status


class PhaseThreeTests(unittest.TestCase):
    def test_detect_microsoft_kmsi_state(self):
        state = detect_auth_state({
            "url": "https://login.microsoftonline.com/kmsi",
            "bodyText": "Stay signed in?",
            "title": "",
            "evidence": [],
        })
        self.assertEqual(state, "microsoft_stay_signed_in")

    def test_detect_authenticated_crm_shell(self):
        state = detect_auth_state({
            "url": "https://org.crm.dynamics.com/main.aspx",
            "bodyText": "Active accounts export filter account name",
            "title": "Accounts",
            "evidence": [],
        })
        self.assertEqual(state, "authenticated")

    def test_postconditions_include_required_text_and_url_fragments(self):
        post = build_postconditions(
            "interact",
            'Click "Accounts"',
            {"urlPattern": "https://org.crm.dynamics.com/"},
            {
                "url": "https://org.crm.dynamics.com/main.aspx?etn=account",
                "urlPattern": "https://org.crm.dynamics.com/main.aspx",
                "evidence": [{"text": "Account Name"}],
            },
        )
        self.assertIn("Accounts", post["requiredText"])
        self.assertTrue(post["urlContains"])

    def test_route_auth_failure_to_advance(self):
        self.assertEqual(route_failure("auth_required"), "auth_advance")

    def test_repair_hints_for_locator_failure(self):
        hints = failure_repair_hints("locator_not_found", "deterministic action failed")
        self.assertTrue(any("role" in hint.lower() for hint in hints))

    def test_build_scoped_task_includes_repair_block(self):
        task = build_scoped_task(
            "Click Save",
            "Click Save",
            page_state={"url": "https://example.com", "bodyText": ""},
            credential_suffix="",
            discovery_rules="use roles",
            repair_mode=True,
            failure_class="postcondition_failed",
            failure_reason="missing_text:Save",
        )
        self.assertIn("REPAIR MODE", task)
        self.assertIn("missing_text", task)

    def test_trust_requires_fresh_context_or_high_confidence(self):
        capability = {"successCount": 2, "failureCount": 0, "quality": {"confidence": 0.55}}
        record_promotion_trust(capability, context={**promotion_context(), "freshContext": False})
        self.assertEqual(resolve_trust_status(capability), "candidate")
        record_promotion_trust(capability, context={**promotion_context(), "freshContext": True})
        self.assertEqual(resolve_trust_status(capability), "trusted")

    def test_cross_scenario_merge_upsert(self):
        store = {"capabilities": [{"id": "a", "successCount": 1}]}
        merge_capability_into_page_store(store, {"id": "a", "successCount": 3})
        self.assertEqual(store["capabilities"][0]["successCount"], 3)
        merge_capability_into_page_store(store, {"id": "b", "successCount": 1})
        self.assertEqual(len(store["capabilities"]), 2)

    def test_find_cross_scenario_returns_none_without_stores(self):
        self.assertIsNone(
            find_cross_scenario_capability(
                "Click search",
                "https://example.com/",
                {"url": "https://example.com/", "bodyText": ""},
            )
        )


if __name__ == "__main__":
    unittest.main()
