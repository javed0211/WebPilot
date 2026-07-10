"""Built-in system recipes (not learned site knowledge)."""
from __future__ import annotations

from typing import Any

from .intent_resolver import APP_SWITCHER_STEP_HINTS


async def try_app_switcher_recipe(
    browser_session: Any,
    step: str,
    action_type: str,
) -> tuple[bool, bool, str]:
    """Generic app launcher / waffle / application picker (Dynamics, M365, Salesforce patterns)."""
    if action_type != "click":
        return False, False, ""
    lowered = step.lower()
    if not any(hint in lowered for hint in APP_SWITCHER_STEP_HINTS):
        return False, False, ""

    page = await browser_session.must_get_current_page()
    try:
        ok = await page.evaluate(
            """() => {
              const visible = (el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
              };
              const normalize = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
              const candidates = [];
              const selectors = [
                'button[aria-label*="App"]',
                'button[title*="App"]',
                '[data-icon-name="WaffleOffice365"]',
                '[id*="O365_MainLink_NavMenu"]',
                '[aria-label*="waffle"]',
                '[aria-label*="application"]',
                'a[aria-label*="App launcher"]',
              ];
              for (const sel of selectors) {
                for (const el of document.querySelectorAll(sel)) {
                  if (visible(el)) candidates.push(el);
                }
              }
              for (const el of document.querySelectorAll('button,[role="button"],a')) {
                if (!visible(el)) continue;
                const label = normalize(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
                if (/app launcher|waffle|all apps|applications|change app/.test(label)) candidates.push(el);
              }
              const unique = [...new Set(candidates)];
              if (unique.length) {
                unique[0].click();
                return true;
              }
              return false;
            }"""
        )
        if ok:
            import asyncio
            await asyncio.sleep(1.0)
            return True, True, ""
        return True, False, "app switcher control not found"
    except Exception as exc:
        return True, False, str(exc)
