import re

from playwright.sync_api import Page, expect

from framework.pages.automationexercise.automation_exercise_base_page import (
    AutomationExerciseBasePage,
)


class AutomationExerciseHomePage(AutomationExerciseBasePage):
    """@pageIdentity AutomationExerciseHomePage
    @urlPattern https://automationexercise.com/?
    """

    def __init__(self, page: Page) -> None:
        super().__init__(page)

    def goto(self) -> None:
        self.navigate("https://automationexercise.com/")
        self.dismiss_cookie_consent_if_present()

    def assert_featured_items_visible(self) -> None:
        self.assert_heading_visible(re.compile("FEATURES ITEMS", re.I))
        cards = self.page.locator(".features_items .product-image-wrapper")
        self.assert_count_at_least(cards, 1)
        expect(cards.first).to_be_visible()

    def go_to_products_page(self) -> None:
        self.open_products_from_nav()

    def click_products_nav(self) -> None:
        self.go_to_products_page()
