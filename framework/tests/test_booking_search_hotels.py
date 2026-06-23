import pytest
from playwright.sync_api import Page

from framework.pages.booking.booking_home_page import BookingHomePage
from framework.pages.booking.booking_search_results_page import BookingSearchResultsPage


@pytest.mark.parametrize("destination", ["London"])
def test_search_hotels_in_london(page: Page, destination: str):
    home = BookingHomePage(page)
    results = BookingSearchResultsPage(page)

    home.goto()
    home.wait_for_homepage_loaded()
    home.dismiss_sign_in_popup_if_present()
    home.dismiss_cookie_consent_if_present()
    home.search_destination(destination)
    home.click_search()
    results.wait_for_load_state("load")
    results.assert_search_results_visible()
    results.assert_destination_field_visible(destination)
