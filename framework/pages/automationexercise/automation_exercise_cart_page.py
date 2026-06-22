import re
from typing import TypedDict

from playwright.sync_api import Page, expect

from framework.pages.automationexercise.automation_exercise_base_page import (
    AutomationExerciseBasePage,
)


class CartLineItem(TypedDict, total=False):
    name: str
    price: str
    quantity: str
    total: str
    description: str


class AutomationExerciseCartPage(AutomationExerciseBasePage):
    """@pageIdentity AutomationExerciseCartPage
    @urlPattern https://automationexercise.com/view_cart
    """

    def __init__(self, page: Page) -> None:
        super().__init__(page)

    def assert_on_cart_page(self) -> None:
        self.assert_url(re.compile(r"/view_cart"))
        self.assert_element_visible("#cart_info_table")
        self.assert_count_at_least(self.page.locator("#cart_info_table tbody tr"), 1)

    def assert_cart_products(self, expected: list[CartLineItem]) -> None:
        rows = self.page.locator("#cart_info_table tbody tr")
        self.assert_count_at_least(rows, len(expected))
        for index, item in enumerate(expected):
            row = rows.nth(index)
            expect(row.locator(".cart_description h4 a").first).to_contain_text(item["name"])
            if item.get("description"):
                expect(row.locator(".cart_description p").first).to_contain_text(
                    item["description"]
                )
            expect(row.locator(".cart_price p").first).to_have_text(item["price"])
            expect(row.locator(".cart_quantity button").first).to_have_text(item["quantity"])
            expect(row.locator(".cart_total p").first).to_have_text(item["total"])
