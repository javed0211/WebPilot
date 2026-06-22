from playwright.sync_api import Page, expect

from framework.core.base_page import BasePage


class DemoApplitoolsLoginPage(BasePage):
    """@pageIdentity DemoApplitoolsLoginPage
    @urlPattern https://demo.applitools.com/?
    """

    def __init__(self, page: Page) -> None:
        super().__init__(page)

    def login_form(self):
        return self.page.locator("form")

    def username_input(self):
        return self.login_form().get_by_placeholder("Enter your username")

    def password_input(self):
        return self.login_form().get_by_placeholder("Enter your password")

    def sign_in_button(self):
        return self.login_form().locator("#log-in")

    def goto(self) -> None:
        self.navigate("https://demo.applitools.com/")

    def login(self, username: str, password: str) -> None:
        self.username_input().fill(username)
        self.password_input().fill(password)
        self.sign_in_button().click()

    def assert_on_login_page(self) -> None:
        expect(self.login_form()).to_be_visible()
        expect(self.username_input()).to_be_visible()
        expect(self.password_input()).to_be_visible()
        expect(self.sign_in_button()).to_be_visible()
