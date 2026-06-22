from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable, Pattern

from playwright.sync_api import Dialog, Download, Locator, Page, expect


BASE_PAGE_DEFAULT_TIMEOUT = 10_000
Target = str | Locator
TextPattern = str | Pattern[str]


class BasePage:
    """Reusable synchronous Playwright Page Object base class."""

    def __init__(self, page: Page) -> None:
        self.page = page

    def _locator(self, target: Target) -> Locator:
        return self.page.locator(target) if isinstance(target, str) else target

    def _wait_visible(
        self, target: Target, timeout: float = BASE_PAGE_DEFAULT_TIMEOUT
    ) -> Locator:
        locator = self._locator(target)
        locator.wait_for(state="visible", timeout=timeout)
        return locator

    def get_page(self) -> Page:
        return self.page

    def get_context(self):
        return self.page.context

    def url(self) -> str:
        return self.page.url

    def title(self) -> str:
        return self.page.title()

    def navigate(self, url: str, **options: Any) -> None:
        self.page.goto(url, wait_until=options.pop("wait_until", "load"), **options)

    def reload(self, **options: Any) -> None:
        self.page.reload(**options)

    def go_back(self, **options: Any) -> None:
        self.page.go_back(**options)

    def go_forward(self, **options: Any) -> None:
        self.page.go_forward(**options)

    def open_new_tab(self, url: str, **options: Any) -> Page:
        new_page = self.page.context.new_page()
        new_page.goto(url, wait_until=options.pop("wait_until", "load"), **options)
        return new_page

    def open_in_new_tab(self, target: Target, **options: Any) -> Page:
        modifiers = options.pop("modifiers", [])
        with self.page.context.expect_page() as page_info:
            self._locator(target).click(modifiers=["ControlOrMeta", *modifiers], **options)
        new_page = page_info.value
        new_page.wait_for_load_state("domcontentloaded")
        return new_page

    def get_open_tabs(self) -> list[Page]:
        return self.page.context.pages

    def switch_to_tab(self, index: int) -> Page:
        pages = self.get_open_tabs()
        if index < 0 or index >= len(pages):
            raise IndexError(f"Tab index {index} is out of range")
        self.page = pages[index]
        self.page.bring_to_front()
        return self.page

    def switch_to_tab_by_url(self, value: TextPattern) -> Page:
        for candidate in self.get_open_tabs():
            if (
                value in candidate.url
                if isinstance(value, str)
                else value.search(candidate.url)
            ):
                self.page = candidate
                self.page.bring_to_front()
                return candidate
        raise LookupError(f"No open tab matches URL {value!r}")

    def locator(self, selector: str) -> Locator:
        return self.page.locator(selector)

    def get_by_role(self, role: str, **options: Any) -> Locator:
        return self.page.get_by_role(role, **options)

    def get_by_label(self, text: TextPattern, **options: Any) -> Locator:
        return self.page.get_by_label(text, **options)

    def get_by_placeholder(self, text: TextPattern, **options: Any) -> Locator:
        return self.page.get_by_placeholder(text, **options)

    def get_by_text(self, text: TextPattern, **options: Any) -> Locator:
        return self.page.get_by_text(text, **options)

    def get_by_test_id(self, test_id: TextPattern) -> Locator:
        return self.page.get_by_test_id(test_id)

    def click(self, target: Target, **options: Any) -> None:
        self._wait_visible(target).click(**options)

    def click_by_role(self, role: str, **options: Any) -> None:
        self.get_by_role(role, **options).click()

    def fill(self, target: Target, value: str, **options: Any) -> None:
        self._wait_visible(target).fill(value, **options)

    def fill_by_label(self, label: TextPattern, value: str) -> None:
        self.get_by_label(label).fill(value)

    def fill_by_placeholder(self, placeholder: TextPattern, value: str) -> None:
        self.get_by_placeholder(placeholder).fill(value)

    def clear(self, target: Target, **options: Any) -> None:
        self._locator(target).clear(**options)

    def press(self, target: Target, key: str, **options: Any) -> None:
        self._wait_visible(target).press(key, **options)

    def check(self, target: Target, **options: Any) -> None:
        self._locator(target).check(**options)

    def uncheck(self, target: Target, **options: Any) -> None:
        self._locator(target).uncheck(**options)

    def select_option(self, target: Target, value: Any, **options: Any) -> None:
        self._wait_visible(target).select_option(value, **options)

    def set_input_files(self, target: Target, files: str | Path | list[str | Path]) -> None:
        self._locator(target).set_input_files(files)

    def hover(self, target: Target, **options: Any) -> None:
        self._wait_visible(target).hover(**options)

    def scroll_into_view(self, target: Target) -> None:
        self._locator(target).scroll_into_view_if_needed()

    def get_text(self, target: Target) -> str:
        return self._wait_visible(target).inner_text().strip()

    def count(self, target: Target) -> int:
        return self._locator(target).count()

    def is_visible(self, target: Target, timeout: float = 5_000) -> bool:
        try:
            self._locator(target).wait_for(state="visible", timeout=timeout)
            return True
        except Exception:
            return False

    def wait_for_url(self, url: TextPattern, **options: Any) -> None:
        self.page.wait_for_url(url, **options)

    def wait_for_load_state(self, state: str = "load", **options: Any) -> None:
        self.page.wait_for_load_state(state, **options)

    def wait_for_timeout(self, milliseconds: float) -> None:
        self.page.wait_for_timeout(milliseconds)

    def on_dialog(self, handler: Callable[[Dialog], None]) -> None:
        self.page.on("dialog", handler)

    def accept_next_dialog(self, prompt_text: str | None = None) -> None:
        self.page.once("dialog", lambda dialog: dialog.accept(prompt_text))

    def dismiss_next_dialog(self) -> None:
        self.page.once("dialog", lambda dialog: dialog.dismiss())

    def wait_for_download(self, action: Callable[[], None]) -> Download:
        with self.page.expect_download() as download_info:
            action()
        return download_info.value

    def screenshot(self, path: str | Path, **options: Any) -> bytes:
        return self.page.screenshot(path=str(path), **options)

    def assert_element_visible(self, target: Target, timeout: float = 10_000) -> None:
        expect(self._locator(target)).to_be_visible(timeout=timeout)

    def assert_element_hidden(self, target: Target, timeout: float = 10_000) -> None:
        expect(self._locator(target)).to_be_hidden(timeout=timeout)

    def assert_text_present(self, target: Target, text: TextPattern) -> None:
        expect(self._locator(target)).to_contain_text(text)

    def assert_heading_visible(self, name: TextPattern) -> None:
        expect(self.page.get_by_role("heading", name=name)).to_be_visible()

    def assert_url(self, value: TextPattern) -> None:
        expect(self.page).to_have_url(value)

    def assert_title(self, value: TextPattern) -> None:
        expect(self.page).to_have_title(value)

    def assert_count(self, target: Target, expected: int) -> None:
        expect(self._locator(target)).to_have_count(expected)

    def assert_count_at_least(self, target: Target, minimum: int) -> None:
        actual = self._locator(target).count()
        assert actual >= minimum, f"Expected at least {minimum} elements, found {actual}"

    def assert_value(self, target: Target, value: TextPattern) -> None:
        expect(self._locator(target)).to_have_value(value)

    def assert_checked(self, target: Target) -> None:
        expect(self._locator(target)).to_be_checked()

    def assert_enabled(self, target: Target) -> None:
        expect(self._locator(target)).to_be_enabled()

    @staticmethod
    def regex(pattern: str, flags: int = re.IGNORECASE) -> Pattern[str]:
        return re.compile(pattern, flags)
