from playwright.sync_api import Page

from framework.pages.automationexercise.automation_exercise_contact_us_page import (
    AutomationExerciseContactUsPage,
)
from framework.pages.automationexercise.automation_exercise_home_page import (
    AutomationExerciseHomePage,
)


def test_submit_contact_form(page: Page) -> None:
    home = AutomationExerciseHomePage(page)
    contact = AutomationExerciseContactUsPage(page)
    home.goto()
    home.assert_featured_items_visible()
    contact.open_from_nav()
    contact.assert_contact_page_loaded()
    contact.fill_contact_form(
        {
            "name": "WebPilot Tester",
            "email": "webpilot.test@example.com",
            "subject": "Automation test inquiry",
            "message": "This is an automated test message from WebPilot.",
        }
    )
    contact.upload_file()
    contact.submit_and_accept_alert()
    contact.assert_submission_success()
    contact.click_home()
    home.assert_featured_items_visible()
