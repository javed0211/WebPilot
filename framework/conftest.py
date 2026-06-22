from __future__ import annotations

import os

import pytest
from playwright.sync_api import Playwright

from framework.config.config_manager import config
from framework.core.base_api import BaseAPI


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {
        **browser_context_args,
        "base_url": config.get("baseUrl"),
        "ignore_https_errors": True,
        "viewport": {"width": 1280, "height": 720},
        "record_video_dir": "reports/videos",
    }


@pytest.fixture
def api_client(playwright: Playwright):
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if os.getenv("AUTH_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['AUTH_TOKEN']}"
    context = playwright.request.new_context(
        base_url=config.get("apiBaseUrl") or config.get("baseUrl"),
        extra_http_headers=headers,
        ignore_https_errors=True,
    )
    try:
        yield BaseAPI(context)
    finally:
        context.dispose()
