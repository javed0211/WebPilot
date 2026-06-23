from __future__ import annotations

import re

from playwright.sync_api import Page, expect

from framework.core.base_page import BasePage


class BookingHomePage(BasePage):
    """Booking.com homepage actions shared by generated scenarios."""

    URL = "https://www.booking.com/"

    def __init__(self, page: Page) -> None:
        super().__init__(page)

    def destination_input(self):
        return self.page.get_by_placeholder("Where are you going?")

    def goto(self) -> None:
        self.navigate(self.URL)
        self.wait_for_load_state("load")

    def wait_for_homepage_loaded(self) -> None:
        self.destination_input().wait_for(state="visible", timeout=15_000)

    def dismiss_sign_in_popup_if_present(self) -> None:
        locator = self.page.get_by_role(
            "button", name=re.compile(r"Dismiss sign.in", re.I)
        )
        if locator.first.is_visible():
            locator.first.click()

    def dismiss_sign_in_modal_if_present(self) -> None:
        self.dismiss_sign_in_popup_if_present()

    def dismiss_cookie_consent_if_present(self) -> None:
        locator = self.page.locator("#onetrust-reject-all-handler")
        if locator.is_visible():
            locator.click()

    def dismiss_cookie_banner_if_present(self) -> None:
        self.dismiss_cookie_consent_if_present()

    def search_destination(self, destination: str) -> None:
        field = self.destination_input()
        field.fill(destination)
        suggestion = self.page.get_by_role("option").filter(
            has_text=re.compile(destination, re.I)
        ).first
        suggestion.wait_for(state="visible", timeout=10_000)
        suggestion.click()

    def click_search(self) -> None:
        self.page.get_by_role(
            "button", name=re.compile("^Search$", re.I)
        ).click()

    def assert_destination_search_field_visible(self) -> None:
        expect(self.destination_input()).to_be_visible()
