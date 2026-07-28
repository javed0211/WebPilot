"""Headed browser should maximize and avoid viewport > window mismatches."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from integrations.browser_use.branding import (
    build_browser_kwargs,
    prefer_maximized_window,
)


class BrowserWindowTests(unittest.TestCase):
    def test_headful_kwargs_use_no_viewport_and_start_maximized(self):
        kwargs = build_browser_kwargs(
            {
                'headless': False,
                'target': 'chrome',
                'viewport': {'width': 1280, 'height': 720},
            }
        )
        self.assertFalse(kwargs['headless'])
        self.assertTrue(kwargs.get('no_viewport'))
        self.assertNotIn('viewport', kwargs)
        self.assertIn('--start-maximized', kwargs.get('args') or [])

    def test_headless_kwargs_keep_fixed_viewport(self):
        kwargs = build_browser_kwargs(
            {
                'headless': True,
                'target': 'chrome',
                'viewport': {'width': 1280, 'height': 720},
            }
        )
        self.assertTrue(kwargs['headless'])
        self.assertEqual(kwargs['viewport'], {'width': 1280, 'height': 720})
        self.assertNotIn('args', kwargs)

    def test_prefer_maximized_window_clears_screen_window_size(self):
        profile = SimpleNamespace(
            headless=False,
            window_size={'width': 1920, 'height': 1080},
            no_viewport=False,
            viewport={'width': 1280, 'height': 720},
        )
        browser = SimpleNamespace(browser_profile=profile)
        prefer_maximized_window(browser)
        self.assertIsNone(profile.window_size)
        self.assertTrue(profile.no_viewport)
        self.assertIsNone(profile.viewport)

    def test_prefer_maximized_window_skips_headless(self):
        profile = SimpleNamespace(
            headless=True,
            window_size={'width': 1280, 'height': 720},
            no_viewport=False,
            viewport={'width': 1280, 'height': 720},
        )
        browser = SimpleNamespace(browser_profile=profile)
        prefer_maximized_window(browser)
        self.assertEqual(profile.window_size, {'width': 1280, 'height': 720})


if __name__ == '__main__':
    unittest.main()
