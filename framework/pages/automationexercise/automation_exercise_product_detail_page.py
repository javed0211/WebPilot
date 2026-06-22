import re

from playwright.sync_api import Page, expect

from framework.pages.automationexercise.automation_exercise_base_page import (
    AutomationExerciseBasePage,
)


class AutomationExerciseProductDetailPage(AutomationExerciseBasePage):
    """@pageIdentity AutomationExerciseProductDetailPage
    @urlPattern https://automationexercise.com/product_details/
    """

    def __init__(self, page: Page) -> None:
        super().__init__(page)

    def assert_product_name_visible(self, name) -> None:
        expect(self.page.locator(".product-information h2")).to_have_text(name)

    def assert_category_visible(self, category) -> None:
        expect(
            self.page.locator(".product-information p").filter(has_text=category)
        ).to_be_visible()

    def assert_price_visible(self, price) -> None:
        expect(
            self.page.locator(".product-information span").filter(has_text=price).first
        ).to_be_visible()

    def assert_availability_visible(self, status) -> None:
        expect(
            self.page.locator(".product-information p").filter(
                has_text=re.compile("Availability:", re.I)
            )
        ).to_contain_text(status)

    def assert_condition_visible(self, condition) -> None:
        expect(
            self.page.locator(".product-information p").filter(
                has_text=re.compile("Condition:", re.I)
            )
        ).to_contain_text(condition)

    def assert_brand_visible(self, brand) -> None:
        expect(
            self.page.locator(".product-information p")
            .filter(has_text=re.compile("Brand:", re.I))
            .filter(has_text=brand)
        ).to_be_visible()
