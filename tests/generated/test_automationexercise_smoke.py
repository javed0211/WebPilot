import re

from playwright.sync_api import Page, expect

from tests.generated.pages.base_page import BasePage


def test_automationexercise_smoke(page: Page) -> None:
    home = BasePage(page)
    home.navigate("https://automationexercise.com/")
    expect(page).to_have_title(re.compile(r"Automation Exercise", re.I))
