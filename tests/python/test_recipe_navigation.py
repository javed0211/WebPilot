import unittest
from unittest.mock import AsyncMock, patch

from integrations.browser_use.capability_contract import is_navigable_url, resolve_navigate_target
from integrations.browser_use.execution_history import append_recipe_replay_history
from integrations.browser_use.intent_resolver import detect_page_type
from integrations.browser_use.knowledge import try_recipe_step
from integrations.browser_use.system_recipes import try_app_switcher_recipe


class RecipeNavigationTests(unittest.IsolatedAsyncioTestCase):
    def test_is_navigable_url_rejects_nl_targets(self):
        self.assertTrue(is_navigable_url("https://bupaentdev1uat.crm4.dynamics.com/"))
        self.assertFalse(is_navigable_url('"Contacts" subarea in "Customer" Area from dashboard'))
        self.assertFalse(is_navigable_url("Contacts subarea"))

    def test_resolve_navigate_target_ignores_in_app_navigation(self):
        step = 'navigate to "Contacts" subarea in "Customer" Area from dashboard'
        self.assertIsNone(resolve_navigate_target(step))

    def test_resolve_navigate_target_accepts_goto_url(self):
        step = 'goto "https://bupaentdev1uat.crm4.dynamics.com/"'
        self.assertEqual(
            resolve_navigate_target(step),
            "https://bupaentdev1uat.crm4.dynamics.com/",
        )

    async def test_try_recipe_step_skips_nl_navigation(self):
        browser = AsyncMock()
        browser.get_current_page_url = AsyncMock(return_value="https://example.com/")
        handled, ok, reason = await try_recipe_step(
            browser,
            'navigate to "Contacts" subarea in "Customer" Area from dashboard',
        )
        self.assertFalse(handled)
        self.assertFalse(ok)
        browser.navigate_to.assert_not_called()

    async def test_try_recipe_step_navigates_real_urls(self):
        browser = AsyncMock()
        handled, ok, reason = await try_recipe_step(
            browser,
            'goto "https://example.com/home"',
        )
        self.assertTrue(handled)
        self.assertTrue(ok)
        browser.navigate_to.assert_awaited_once_with("https://example.com/home", new_tab=False)

    def test_append_recipe_replay_history_skips_nl_navigation(self):
        history: list[dict] = []
        append_recipe_replay_history(
            history,
            'navigate to "Contacts" subarea in "Customer" Area from dashboard',
            description="navigate contacts",
            url="https://org.crm.dynamics.com/main.aspx",
        )
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["action"], "recipe-replay")

    def test_detect_page_type_treats_dynamics_shell_as_app_not_auth(self):
        page_type = detect_page_type({
            "url": "https://bupaentdev1uat.crm4.dynamics.com/main.aspx?pagetype=apps",
            "bodyText": "Apps dashboard navigation settings sign in help",
            "title": "Dynamics 365",
            "evidence": [],
        })
        self.assertEqual(page_type, "app_shell")

    async def test_open_application_step_does_not_use_switcher_recipe(self):
        browser = AsyncMock()
        handled, ok, reason = await try_app_switcher_recipe(
            browser,
            "open application 'Anytime Healthline'",
            "click",
        )
        self.assertFalse(handled)


if __name__ == "__main__":
    unittest.main()
