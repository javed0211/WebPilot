from playwright.sync_api import Page

from framework.pages.automationexercise.automation_exercise_cart_page import (
    AutomationExerciseCartPage,
)
from framework.pages.automationexercise.automation_exercise_home_page import (
    AutomationExerciseHomePage,
)
from framework.pages.automationexercise.automation_exercise_products_page import (
    AutomationExerciseProductsPage,
)


def test_add_products_in_cart(page: Page) -> None:
    home = AutomationExerciseHomePage(page)
    home.goto()
    home.assert_featured_items_visible()
    home.go_to_products_page()

    products = AutomationExerciseProductsPage(page)
    products.assert_all_products_visible()
    products.hover_product_at(0)
    products.add_to_cart_product_at(0)
    products.handle_cart_modal("continue")
    products.hover_product_at(1)
    products.add_to_cart_product_at(1)
    products.handle_cart_modal("view")

    cart = AutomationExerciseCartPage(page)
    cart.assert_on_cart_page()
    cart.assert_cart_products(
        [
            {
                "name": "Blue Top",
                "price": "Rs. 500",
                "quantity": "1",
                "total": "Rs. 500",
            },
            {
                "name": "Men Tshirt",
                "price": "Rs. 400",
                "quantity": "1",
                "total": "Rs. 400",
            },
        ]
    )
