from playwright.sync_api import Page

from framework.pages.demo_applitools_app_page import DemoApplitoolsAppPage
from framework.pages.demo_applitools_login_page import DemoApplitoolsLoginPage


def test_demo_applitools_login(page: Page) -> None:
    login = DemoApplitoolsLoginPage(page)
    login.goto()
    login.assert_on_login_page()
    login.login("Admin", "Admin123")

    app = DemoApplitoolsAppPage(page)
    app.assert_username_visible("Jack Gomez")
    app.assert_settings_icon_visible()
