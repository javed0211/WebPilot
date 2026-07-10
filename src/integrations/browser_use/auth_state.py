"""Generic auth/session state machine for IdP + SaaS shells (Microsoft, Salesforce, etc.)."""
from __future__ import annotations

import asyncio
import re
from typing import Any, Literal

from .capability_contract import AUTH_INTERSTITIAL_PHRASES, AUTH_RELAXED_ORIGINS, origin_for_url
from .intent_resolver import APP_SWITCHER_STEP_HINTS, detect_page_type
from .system_recipes import try_app_switcher_recipe

AuthState = Literal[
    "authenticated",
    "unauthenticated",
    "microsoft_username",
    "microsoft_password",
    "microsoft_mfa",
    "microsoft_stay_signed_in",
    "microsoft_tenant_picker",
    "app_picker",
    "auth_interstitial",
]

_MAX_ADVANCE_ATTEMPTS = 6


def detect_auth_state(page_state: dict[str, Any]) -> AuthState:
    """Classify current browser session for auth routing (generic, not CRM-only)."""
    url = (page_state.get("url") or "").lower()
    body = (page_state.get("bodyText") or "").lower()
    title = (page_state.get("title") or "").lower()
    origin = origin_for_url(url)
    page_type = detect_page_type(page_state)

    if origin in AUTH_RELAXED_ORIGINS:
        if "stay signed in" in body:
            return "microsoft_stay_signed_in"
        if "enter code" in body or "verify your identity" in body or "approve sign in" in body:
            return "microsoft_mfa"
        if "enter password" in body or (re.search(r"\bpassword\b", body) and "sign in" in body):
            return "microsoft_password"
        if "pick an account" in body or "use another account" in body:
            return "microsoft_tenant_picker"
        return "microsoft_username"

    if page_type in ("app_shell", "entity_list", "form"):
        if any(hint in body for hint in APP_SWITCHER_STEP_HINTS) and "apps" in body:
            return "app_picker"
        return "authenticated"

    if page_type == "auth_interstitial" or any(phrase in body for phrase in AUTH_INTERSTITIAL_PHRASES):
        if any(hint in body for hint in ("app launcher", "all apps", "waffle", "applications")):
            return "app_picker"
        return "auth_interstitial"

    if "sign in" in title or "login" in title:
        return "unauthenticated"

    return "authenticated"


async def _click_kmsi_yes(page: Any) -> bool:
    return bool(
        await page.evaluate(
            """() => {
              const visible = (el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
              };
              for (const sel of ['#idSIButton9', 'input[type="submit"][value="Yes"]']) {
                const el = document.querySelector(sel);
                if (el && visible(el)) { el.click(); return true; }
              }
              const btn = [...document.querySelectorAll('button, input[type="submit"]')]
                .find(el => visible(el) && /^yes$/i.test((el.value || el.textContent || '').trim()));
              if (btn) { btn.click(); return true; }
              return false;
            }"""
        )
    )


async def advance_auth_state(
    browser_session: Any,
    *,
    compact_page_state: Any,
) -> tuple[bool, str, AuthState]:
    """Advance through auth interstitials until business-ready or blocked."""
    from .knowledge import compact_page_state as _compact_page_state
    from .knowledge import try_microsoft_login_recipe

    get_state = compact_page_state or _compact_page_state
    last_state: AuthState = "authenticated"
    last_reason = ""

    for _ in range(_MAX_ADVANCE_ATTEMPTS):
        state_blob = await get_state(browser_session)
        auth_state = detect_auth_state(state_blob)
        last_state = auth_state

        if auth_state == "authenticated":
            return True, "", auth_state

        if auth_state == "microsoft_stay_signed_in":
            page = await browser_session.must_get_current_page()
            if await _click_kmsi_yes(page):
                await asyncio.sleep(1.2)
                continue
            return False, "auth interstitial: Stay signed in could not be dismissed", auth_state

        if auth_state in ("microsoft_username", "microsoft_password", "microsoft_tenant_picker"):
            handled, ok, reason = await try_microsoft_login_recipe(
                browser_session, "continue sign in", "click"
            )
            if handled and ok:
                await asyncio.sleep(0.8)
                continue
            if handled and not ok:
                last_reason = reason or "Microsoft login interstitial could not be cleared"
                break
            return False, "Microsoft login required — run authenticate step or discovery", auth_state

        if auth_state == "microsoft_mfa":
            return False, "MFA/approval required — complete manually or add discovery step", auth_state

        if auth_state == "app_picker":
            handled, ok, reason = await try_app_switcher_recipe(
                browser_session, "click application app launcher", "click"
            )
            if handled and ok:
                await asyncio.sleep(1.0)
                continue
            if handled and not ok:
                last_reason = reason or "app picker could not be opened"
                break

        if auth_state in ("auth_interstitial", "unauthenticated"):
            handled, ok, reason = await try_microsoft_login_recipe(
                browser_session, "continue sign in", "click"
            )
            if handled and ok:
                await asyncio.sleep(0.8)
                continue
            last_reason = "auth interstitial detected — run login step or discovery"
            break

    return False, last_reason or f"auth state stuck at {last_state}", last_state


async def ensure_session_ready(
    browser_session: Any,
    *,
    compact_page_state: Any = None,
) -> tuple[bool, str]:
    """Runner guard: clear auth blockers before non-login business steps."""
    from .knowledge import compact_page_state as _compact_page_state

    get_state = compact_page_state or _compact_page_state
    state_blob = await get_state(browser_session)
    auth_state = detect_auth_state(state_blob)
    if auth_state == "authenticated":
        return True, ""
    ok, reason, _ = await advance_auth_state(
        browser_session, compact_page_state=get_state
    )
    return ok, reason
