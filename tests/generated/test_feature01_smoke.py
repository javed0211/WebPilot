import re
from playwright.sync_api import Page, expect


def test_feature01_smoke(page: Page):
    page.goto("https://automationexercise.com/")
    # selector: confidence 0.99
    page.get_by_role("link", name="Products").click()
    page.goto("https://automationexercise.com/products")
    # assertion(medium): URL contains "products"
    expect(page).to_have_url(re.compile("products"))
    # assertion(strong): role selector is visible
    expect(page.get_by_role("heading", name="All Products")).to_be_visible()
