"""Unit tests for live Playwright locator verifier helpers (no browser)."""
from __future__ import annotations

from integrations.browser_use.live_locator_verifier import (
    _norm_url,
    _urls_compatible,
    cdp_url_from_browser,
)


def test_norm_url_strips_trailing_slash():
    assert _norm_url("https://github.com/microsoft/playwright/") == (
        "https://github.com/microsoft/playwright"
    )


def test_urls_compatible():
    assert _urls_compatible(
        "https://github.com/microsoft/playwright/actions",
        "https://github.com/microsoft/playwright/actions/",
    )
    assert not _urls_compatible(
        "https://github.com/microsoft/playwright/actions",
        "https://github.com/microsoft/playwright/issues",
    )


def test_cdp_url_from_browser_attr():
    class B:
        cdp_url = "ws://127.0.0.1:9222/devtools/browser/abc"

    assert cdp_url_from_browser(B()) == "ws://127.0.0.1:9222/devtools/browser/abc"
    assert cdp_url_from_browser(None) is None
