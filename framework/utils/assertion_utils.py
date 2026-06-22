from playwright.sync_api import Page, expect

from framework.utils.logger import Logger


class AssertionUtils:
    @staticmethod
    def assert_true(value: bool, message: str) -> None:
        Logger.info(f"Asserting: {message}")
        assert value, message

    @staticmethod
    def assert_equals(actual, expected, message: str) -> None:
        Logger.info(f"Asserting equality: {message}")
        assert actual == expected, message

    @staticmethod
    def assert_element_visible(page: Page, selector: str, message: str) -> None:
        Logger.info(message)
        expect(page.locator(selector)).to_be_visible()

    @staticmethod
    def assert_element_text(
        page: Page, selector: str, expected_text: str, message: str
    ) -> None:
        Logger.info(message)
        expect(page.locator(selector)).to_contain_text(expected_text)
