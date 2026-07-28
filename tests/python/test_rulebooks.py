"""Tests for origin-gated site rulebooks."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from integrations.browser_use import rulebooks as rb


class RulebookTests(unittest.TestCase):
    def test_dynamics_origin_activates_d365_pack(self):
        packs = rb.resolve_active_packs(url="https://contoso.crm.dynamics.com/main.aspx")
        self.assertIn("generic", packs)
        self.assertIn("dynamics365", packs)
        self.assertNotIn("digital", packs)

    def test_powerapps_origin_matches_dynamics_pack(self):
        packs = rb.resolve_active_packs(url="https://apps.powerapps.com/play/e/env")
        self.assertIn("dynamics365", packs)

    def test_booking_origin_activates_digital_not_d365(self):
        packs = rb.resolve_active_packs(url="https://www.booking.com/")
        self.assertIn("generic", packs)
        self.assertIn("digital", packs)
        self.assertNotIn("dynamics365", packs)

    def test_unknown_origin_gets_generic_only(self):
        packs = rb.resolve_active_packs(url="https://obscure-intranet.example/")
        self.assertEqual(packs, ["generic"])

    def test_site_pack_override_forces_d365(self):
        packs = rb.resolve_active_packs(
            url="https://www.booking.com/",
            site_pack="dynamics365",
        )
        self.assertIn("generic", packs)
        self.assertIn("dynamics365", packs)
        self.assertNotIn("digital", packs)

    def test_parse_site_pack_override(self):
        text = "@smoke\nsitePack: dynamics365\nTest: Accounts\n1. Navigate to https://x.com\n"
        self.assertEqual(rb.parse_site_pack_override(text), "dynamics365")

    def test_compose_discovery_rules_includes_d365_vocabulary(self):
        rules, packs = rb.compose_discovery_rules(
            "BASE RULES",
            url="https://org.crm.dynamics.com/",
        )
        self.assertIn("dynamics365", packs)
        self.assertIn("Quick Find", rules)
        self.assertIn("BASE RULES", rules)
        self.assertIn("SITE RULEBOOKS", rules)
        for needle in (
            "OpenSubArea",
            "CommandBar",
            "BusinessProcessFlow",
            "Quick Create",
            "More commands",
            "Global search",
            "Timeline",
        ):
            self.assertIn(needle, rules)

    def test_compose_discovery_rules_excludes_d365_on_digital(self):
        rules, packs = rb.compose_discovery_rules(
            "BASE",
            url="https://www.booking.com/",
        )
        self.assertIn("digital", packs)
        self.assertNotIn("Quick Find", rules)
        self.assertIn("mega-menus", rules.lower() + rules)  # digital seed mentions mega-menus / hover

    def test_learn_writes_learned_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            learned_root = Path(tmp) / "rulebooks"
            with patch.object(rb, "LEARNED_RULEBOOKS_ROOT", learned_root):
                with patch.object(
                    rb,
                    "rulebooks_config",
                    return_value={"enabled": True, "autoLearn": True, "minSuccessCount": 2},
                ):
                    caps = [
                        {
                            "step": "Enter Contoso in Quick Find",
                            "successCount": 3,
                            "actions": [
                                {
                                    "locators": [
                                        {
                                            "kind": "role",
                                            "value": "textbox",
                                            "name": "Quick Find",
                                        },
                                        {
                                            "kind": "css",
                                            "value": 'input[data-id="quickFind_text"]',
                                        },
                                    ]
                                }
                            ],
                        }
                    ]
                    path = rb.update_rulebook_from_capabilities(
                        "https://contoso.crm.dynamics.com/",
                        caps,
                    )
                    self.assertIsNotNone(path)
                    assert path is not None
                    text = path.read_text(encoding="utf-8")
                    self.assertIn("contoso.crm.dynamics.com", text)
                    self.assertIn("Quick Find", text)


if __name__ == "__main__":
    unittest.main()
