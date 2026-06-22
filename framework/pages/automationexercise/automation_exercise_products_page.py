import re

from playwright.sync_api import Page, expect

from framework.pages.automationexercise.automation_exercise_base_page import (
    AutomationExerciseBasePage,
)


class AutomationExerciseProductsPage(AutomationExerciseBasePage):
    """@pageIdentity AutomationExerciseProductsPage
    @urlPattern https://automationexercise.com/products
    """

    def __init__(self, page: Page) -> None:
        super().__init__(page)

    def product_cards(self):
        return self.page.locator(".features_items .product-image-wrapper")

    def assert_all_products_visible(self) -> None:
        self.dismiss_cookie_consent_if_present()
        self.assert_heading_visible(re.compile("All Products", re.I))
        self.assert_count_at_least(self.product_cards(), 3)

    def assert_all_products_page_loaded(self) -> None:
        self.assert_all_products_visible()

    def hover_product_at(self, index: int) -> None:
        self.dismiss_cookie_consent_if_present()
        self.product_cards().nth(index).hover()

    def add_to_cart_product_at(self, index: int) -> None:
        self.dismiss_cookie_consent_if_present()
        add_to_cart = self.product_cards().nth(index).locator("a.add-to-cart").first
        add_to_cart.wait_for(state="visible", timeout=10_000)
        with self.page.expect_response(
            lambda response: "/add_to_cart/" in response.url and response.ok,
            timeout=15_000,
        ):
            add_to_cart.click(force=True)
        expect(self.page.locator("#cartModal")).to_contain_text(
            re.compile("added", re.I), timeout=10_000
        )

    def handle_cart_modal(self, action: str) -> None:
        modal = self.page.locator("#cartModal")
        modal.wait_for(state="attached", timeout=10_000)
        if action == "continue":
            expect(modal).to_contain_text(re.compile("added", re.I))
            modal.locator("button.close-modal").click(force=True)
            try:
                modal.wait_for(state="hidden", timeout=5_000)
            except Exception:
                pass
            return
        view_cart = modal.locator('a[href="/view_cart"]')
        try:
            view_cart.click(force=True, timeout=5_000)
            self.page.wait_for_url(re.compile(r"/view_cart"), timeout=15_000)
        except Exception:
            self.navigate("https://automationexercise.com/view_cart")
