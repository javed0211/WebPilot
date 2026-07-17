import re
from playwright.sync_api import Locator, Page, expect


class BasePage:
    """Shared Playwright helpers for WebPilot-generated page objects."""

    def __init__(self, page: Page) -> None:
        self.page = page

    def navigate(self, url: str) -> None:
        self.page.goto(url, wait_until="load")

    def click_by_role(self, role: str, **kwargs) -> None:
        self.page.get_by_role(role, **kwargs).click()

    def fill_by_label(self, label: str, value: str) -> None:
        self.page.get_by_label(label).fill(value)

    def fill_by_placeholder(self, placeholder: str, value: str) -> None:
        self.page.get_by_placeholder(placeholder).fill(value)

    def assert_url(self, pattern: str | re.Pattern[str]) -> None:
        expect(self.page).to_have_url(pattern)

    def assert_element_visible(self, selector: str) -> None:
        expect(self.page.locator(selector)).to_be_visible()

    def assert_heading_visible(self, text: str | re.Pattern[str]) -> None:
        expect(self.page.get_by_role("heading", name=text)).to_be_visible()

    def assert_count_at_least(self, locator: Locator, minimum: int) -> None:
        count = locator.count()
        assert count >= minimum, f"Expected at least {minimum} elements, found {count}"
