from __future__ import annotations

import time
from collections.abc import Callable

from playwright.sync_api import Page


class WaitUtils:
    @staticmethod
    def sleep(milliseconds: float) -> None:
        time.sleep(milliseconds / 1000)

    @staticmethod
    def wait_for_condition(
        condition: Callable[[], bool],
        timeout: float = 10_000,
        poll_interval: float = 500,
    ) -> bool:
        deadline = time.monotonic() + timeout / 1000
        while time.monotonic() < deadline:
            if condition():
                return True
            WaitUtils.sleep(poll_interval)
        raise TimeoutError(f"Condition was not met within {timeout}ms")

    @staticmethod
    def wait_for_network_idle(page: Page, timeout: float = 10_000) -> None:
        page.wait_for_load_state("networkidle", timeout=timeout)

    @staticmethod
    def wait_for_element_count(
        page: Page, selector: str, expected_count: int, timeout: float = 10_000
    ) -> None:
        WaitUtils.wait_for_condition(
            lambda: page.locator(selector).count() == expected_count,
            timeout,
        )
