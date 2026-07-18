"""
TestMu AI (LambdaTest) remote browser via CDP WebSocket.

browser-use speaks raw CDP, so use the /puppeteer endpoint (not /playwright).
Docs: https://www.testmuai.com/support/docs/puppeteer-testing/
"""
from __future__ import annotations

import json
import os
import subprocess
import urllib.parse
from typing import Any


def _yaml_credential(value: Any) -> str:
    if value is None:
        return ''
    text = str(value).strip()
    if text.startswith('${') and text.endswith('}'):
        return os.environ.get(text[2:-1], '')
    return text


def resolve_playwright_client_version() -> str:
    """Playwright version required by TestMu LT:Options.playwrightClientVersion."""
    try:
        out = subprocess.check_output(
            ['playwright', '--version'],
            text=True,
            stderr=subprocess.STDOUT,
            timeout=15,
        ).strip()
        parts = out.split()
        return parts[-1] if parts else ''
    except Exception:
        try:
            from importlib.metadata import version

            return version('playwright')
        except Exception:
            return ''


def load_testmu_config(browser_section: dict[str, Any] | None) -> dict[str, Any]:
    """Load browser.testmu from config/webpilot.yaml."""
    raw = (browser_section or {}).get('testmu') or {}
    enabled = bool(raw.get('enabled', False))

    username = _yaml_credential(raw.get('username'))
    access_key = _yaml_credential(raw.get('accessKey'))
    adapter = _yaml_credential(raw.get('adapter')) or 'puppeteer'

    return {
        'enabled': enabled,
        'username': username,
        'accessKey': access_key,
        'adapter': adapter,
        'browserName': raw.get('browserName', 'Chrome'),
        'browserVersion': raw.get('browserVersion', 'latest'),
        'platform': raw.get('platform', 'Windows 10'),
        'build': raw.get('build', 'WebPilot'),
        'name': raw.get('name', 'WebPilot Test'),
        'network': raw.get('network', True),
        'video': raw.get('video', True),
        'console': raw.get('console', True),
        'tunnel': raw.get('tunnel', False),
        'tunnelName': raw.get('tunnelName', ''),
        'geoLocation': raw.get('geoLocation', ''),
    }


def build_testmu_cdp_url(
    testmu_cfg: dict[str, Any],
    test_name: str,
    *,
    viewport: dict[str, Any] | None = None,
) -> str:
    """Build TestMu CDP WebSocket URL for browser-use (puppeteer adapter by default)."""
    username = (testmu_cfg.get('username') or '').strip()
    access_key = (testmu_cfg.get('accessKey') or '').strip()
    if not username or not access_key:
        raise ValueError(
            'TestMu remote browser requires credentials. Set browser.testmu.username and '
            'browser.testmu.accessKey in config/webpilot.yaml.'
        )

    adapter = (testmu_cfg.get('adapter') or 'puppeteer').strip().lower()
    if adapter not in ('puppeteer', 'playwright'):
        raise ValueError(
            'browser.testmu.adapter must be "puppeteer" (recommended for the WebPilot agent) or "playwright".'
        )

    lt_options: dict[str, Any] = {
        'platform': testmu_cfg.get('platform', 'Windows 10'),
        'build': testmu_cfg.get('build', 'WebPilot'),
        'name': test_name or testmu_cfg.get('name', 'WebPilot Test'),
        'user': username,
        'accessKey': access_key,
        'network': bool(testmu_cfg.get('network', True)),
        'video': bool(testmu_cfg.get('video', True)),
        'console': bool(testmu_cfg.get('console', True)),
        'tunnel': bool(testmu_cfg.get('tunnel', False)),
    }

    resolution = (testmu_cfg.get('resolution') or '').strip()
    if not resolution and viewport:
        width = viewport.get('width')
        height = viewport.get('height')
        if width and height:
            resolution = f'{int(width)}x{int(height)}'
    if resolution:
        lt_options['resolution'] = resolution

    tunnel_name = (testmu_cfg.get('tunnelName') or '').strip()
    if tunnel_name:
        lt_options['tunnelName'] = tunnel_name
    geo = (testmu_cfg.get('geoLocation') or '').strip()
    if geo:
        lt_options['geoLocation'] = geo

    if adapter == 'playwright':
        pw_version = resolve_playwright_client_version()
        if pw_version:
            lt_options['playwrightClientVersion'] = pw_version

    capabilities = {
        'browserName': testmu_cfg.get('browserName', 'Chrome'),
        'browserVersion': testmu_cfg.get('browserVersion', 'latest'),
        'LT:Options': lt_options,
    }

    encoded = urllib.parse.quote(json.dumps(capabilities))
    return f'wss://cdp.lambdatest.com/{adapter}?capabilities={encoded}'
