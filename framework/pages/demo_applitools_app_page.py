import re

from playwright.sync_api import Page, expect

from framework.core.base_page import BasePage


class DemoApplitoolsAppPage(BasePage):
    """@pageIdentity DemoApplitoolsAppPage
    @urlPattern https://demo.applitools.com/app.html
    """

    def __init__(self, page: Page) -> None:
        super().__init__(page)

    def assert_username_visible(self, username: str) -> None:
        expect(self.page.locator(".logged-user-name")).to_have_text(
            re.compile(rf"^\s*{re.escape(username)}\s*$")
        )

    def assert_settings_icon_visible(self) -> None:
        topbar = self.page.locator(".top-bar, .topbar, #topbar")
        candidates = [
            topbar.locator(".top-icon, .os-icon"),
            self.page.locator(".top-menu-controls .os-icon"),
            self.page.locator(".logged-user-w"),
            topbar.locator("i.fa-cog, i.fa-gear, [data-icon='cog']"),
            topbar.locator("i.fa-user, i.fa-user-circle, [data-icon='user']"),
            topbar.locator("i.fa-bell, [data-icon='bell']"),
            topbar.locator("i.fa-search, [data-icon='search']"),
            topbar.get_by_role("link", name=re.compile("settings|profile|user", re.I)),
            topbar.get_by_role("button", name=re.compile("settings|profile|user", re.I)),
        ]
        visible = next((candidate.first for candidate in candidates if candidate.first.is_visible()), None)
        assert visible is not None, "No expected top-bar icon or control was visible"
        expect(visible).to_be_visible()
