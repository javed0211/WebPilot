import re
from pathlib import Path

from playwright.sync_api import Page, expect

from framework.config.config_manager import ROOT
from framework.pages.automationexercise.automation_exercise_base_page import (
    AutomationExerciseBasePage,
)


class AutomationExerciseContactUsPage(AutomationExerciseBasePage):
    """@pageIdentity AutomationExerciseContactUsPage
    @urlPattern https://automationexercise.com/contact_us
    """

    def __init__(self, page: Page) -> None:
        super().__init__(page)

    def contact_form(self):
        return self.page.locator(".contact-form")

    def open_from_nav(self) -> None:
        self.dismiss_cookie_consent_if_present()
        self.click_by_role("link", name=re.compile("Contact us", re.I))
        self.page.wait_for_url(re.compile(r"/contact_us"), timeout=15_000)

    def assert_contact_page_loaded(self) -> None:
        self.assert_url(re.compile(r"/contact_us"))
        expect(self.page.get_by_text(re.compile("GET IN TOUCH", re.I))).to_be_visible()

    def fill_contact_form(self, data: dict[str, str]) -> None:
        form = self.contact_form()
        form.locator('input[name="name"]').fill(data["name"])
        form.locator('input[name="email"]').fill(data["email"])
        form.locator('input[name="subject"]').fill(data["subject"])
        form.locator('textarea[name="message"]').fill(data["message"])

    def upload_file(self, file_path: str | Path | None = None) -> None:
        resolved = Path(file_path) if file_path else ROOT / "tests" / "fixtures" / "sample.txt"
        self.contact_form().locator('input[name="upload_file"]').set_input_files(resolved)

    def submit_and_accept_alert(self) -> None:
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.contact_form().locator('input[type="submit"][value="Submit"]').click()

    def assert_submission_success(self) -> None:
        expect(
            self.page.locator("#contact-page .alert-success").filter(
                has_text=re.compile(
                    "Success! Your details have been submitted successfully", re.I
                )
            )
        ).to_be_visible()

    def click_home(self) -> None:
        self.page.locator("#contact-page").get_by_role(
            "link", name=re.compile("Home", re.I)
        ).click()
        try:
            self.page.wait_for_url(re.compile(r"automationexercise\.com/?(?:#.*)?$"), timeout=5_000)
        except Exception:
            self.navigate("https://automationexercise.com/")
