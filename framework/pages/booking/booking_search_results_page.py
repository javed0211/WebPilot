from __future__ import annotations

import re
from playwright.sync_api import Page, Locator, expect
from framework.core.base_page import BasePage

class BookingSearchResultsPage(BasePage):
    """
    Page Object for Booking.com search results page.
    Verifies search results and destination field.
    """
    _destination_field = (
        lambda self: self.page.get_by_placeholder("Where are you going?")
    )
    _property_listings = (
        lambda self: self.page.locator("[data-testid='property-card']")
    )
    _filters_panel = (
        lambda self: self.page.locator("[data-testid='filters-panel']")
    )

    def assert_search_results_visible(self):
        self.assert_url(re.compile(r"/(?:searchresults|city/)"))
        expect(
            self.page.get_by_role("heading", name=re.compile("London", re.I)).first
        ).to_be_visible()

    def assert_destination_field_visible(self, expected_value: str):
        self.assert_element_visible(self._destination_field())
        self.assert_value(self._destination_field(), expected_value)
