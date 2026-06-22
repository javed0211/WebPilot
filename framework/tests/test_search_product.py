import re

from playwright.sync_api import Page, expect

from framework.pages.automationexercise.automation_exercise_home_page import (
    AutomationExerciseHomePage,
)
from framework.pages.automationexercise.automation_exercise_product_detail_page import (
    AutomationExerciseProductDetailPage,
)
from framework.pages.automationexercise.automation_exercise_products_page import (
    AutomationExerciseProductsPage,
)


def test_search_product(page: Page) -> None:
    home = AutomationExerciseHomePage(page)
    home.goto()
    home.assert_featured_items_visible()
    home.go_to_products_page()

    products = AutomationExerciseProductsPage(page)
    products.assert_all_products_visible()
    page.locator("#search_product").fill("Blue Top")
    page.locator("#submit_search").click()
    expect(page.get_by_role("heading", name=re.compile("Searched Products", re.I))).to_be_visible()
    page.locator('a[href="/product_details/1"]').first.click()

    detail = AutomationExerciseProductDetailPage(page)
    detail.assert_product_name_visible("Blue Top")
    detail.assert_category_visible(re.compile(r"Women\s*>\s*Tops", re.I))
    detail.assert_price_visible(re.compile(r"Rs\.\s*500"))
    detail.assert_availability_visible(re.compile("In Stock", re.I))
    detail.assert_condition_visible(re.compile("New", re.I))
    detail.assert_brand_visible(re.compile("Polo", re.I))
