import re

from playwright.sync_api import Page

from framework.core.base_page import BasePage


class AutomationExerciseBasePage(BasePage):
    """@pageIdentity AutomationExerciseBasePage
    Shared Automation Exercise helpers.
    """

    def __init__(self, page: Page) -> None:
        super().__init__(page)

    def dismiss_cookie_consent_if_present(self) -> None:
        consent = self.page.locator(".fc-consent-root")
        if not consent.is_visible():
            return
        candidates = [
            self.page.locator("button.fc-cta-consent"),
            self.page.get_by_role("button", name="Consent", exact=True),
            self.page.get_by_role(
                "button", name=re.compile(r"accept all|accept|agree", re.I)
            ),
        ]
        for candidate in candidates:
            if candidate.first.is_visible():
                candidate.first.click(force=True)
                try:
                    consent.wait_for(state="hidden", timeout=8_000)
                except Exception:
                    pass
                return

    def open_products_from_nav(self) -> None:
        self.dismiss_cookie_consent_if_present()
        self.click_by_role("link", name="Products")
