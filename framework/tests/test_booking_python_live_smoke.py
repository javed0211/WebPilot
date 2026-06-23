import pytest
from playwright.sync_api import Page
from framework.pages.booking.booking_home_page import BookingHomePage

@pytest.mark.booking
def test_booking_home_smoke(page: Page):
    home = BookingHomePage(page)
    # Step 1: Navigate to Booking.com homepage
    home.goto()
    # Step 2: Wait for page to load fully (3s, as observed in live execution)
    home.wait_for_timeout(3000)
    # Step 3: Dismiss sign-in modal if present
    home.dismiss_sign_in_modal_if_present()
    # Step 4: Dismiss cookie banner if present
    home.dismiss_cookie_banner_if_present()
    # Step 5: Assert destination search field is visible
    home.assert_destination_search_field_visible()
