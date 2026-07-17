"""Live Playwright verification of ActHistory locator candidates.

Uses chromium.connect_over_cdp against the discovery browser when a CDP URL
is available. Marks unique, visible matches with verified=True / verifiedBy=playwright.

Falls back silently when Playwright or CDP is unavailable — callers keep the
snapshot-based verifier as soft proof.
"""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def _norm_url(url: str | None) -> str:
    if not url:
        return ""
    try:
        parsed = urlparse(str(url).strip())
    except Exception:
        return str(url).strip().rstrip("/")
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{path}".lower()


def _urls_compatible(a: str | None, b: str | None) -> bool:
    na, nb = _norm_url(a), _norm_url(b)
    if not na or not nb:
        return False
    return na == nb or na.startswith(nb) or nb.startswith(na)


def _bind_locator(page: Any, locator: dict[str, Any]) -> Any | None:
    """Mirror TypeScript LocatorResolver.bindLocator for common kinds."""
    kind = str(locator.get("kind") or "").lower()
    value = locator.get("value") or ""
    name = locator.get("name")
    exact = locator.get("exact")
    if exact is None:
        exact = True

    root = page
    scope = locator.get("scope")
    if isinstance(scope, dict) and scope.get("kind"):
        scoped = _bind_leaf(page, scope)
        if scoped is not None:
            root = scoped

    leaf = dict(locator)
    leaf.pop("scope", None)
    return _bind_leaf(root, leaf, exact=bool(exact), name=name, kind=kind, value=value)


def _bind_leaf(
    root: Any,
    locator: dict[str, Any],
    *,
    exact: bool | None = None,
    name: str | None = None,
    kind: str | None = None,
    value: str | None = None,
) -> Any | None:
    kind = (kind if kind is not None else str(locator.get("kind") or "")).lower()
    value = value if value is not None else (locator.get("value") or "")
    name = name if name is not None else locator.get("name")
    if exact is None:
        exact = locator.get("exact")
        if exact is None:
            exact = True
    try:
        if kind == "role" and value:
            if name:
                return root.get_by_role(value, name=name, exact=bool(exact))
            return root.get_by_role(value)
        if kind == "label" and value:
            return root.get_by_label(value)
        if kind == "placeholder" and value:
            return root.get_by_placeholder(value)
        if kind == "testid" and value:
            return root.get_by_test_id(value)
        if kind == "text" and value:
            return root.get_by_text(value, exact=bool(locator.get("exact")))
        if kind == "xpath" and value:
            xp = value if value.startswith("xpath=") else f"xpath={value}"
            return root.locator(xp)
        if kind in ("css", "unknown", "") and value:
            return root.locator(value)
    except Exception:
        return None
    return None


async def verify_candidates_on_page(
    page: Any,
    candidates: list[dict[str, Any]],
    *,
    require_visible: bool = True,
) -> list[dict[str, Any]]:
    """Return candidates that uniquely match (count==1) and optionally are visible."""
    verified: list[dict[str, Any]] = []
    for cand in candidates or []:
        bound = _bind_locator(page, cand)
        if bound is None:
            continue
        try:
            count = await bound.count()
        except Exception:
            continue
        if count != 1:
            continue
        if require_visible:
            try:
                if not await bound.is_visible():
                    continue
            except Exception:
                continue
        out = dict(cand)
        out["verified"] = True
        out["verifiedBy"] = "playwright"
        out["matchCount"] = 1
        verified.append(out)
    return verified


async def _pages_from_cdp(cdp_url: str) -> tuple[Any, Any, list[Any]]:
    """Connect Playwright over CDP; return (playwright, browser, pages)."""
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(cdp_url)
    pages: list[Any] = []
    for ctx in browser.contexts:
        pages.extend(ctx.pages)
    return pw, browser, pages


def _pick_page(pages: list[Any], step_url: str | None) -> Any | None:
    if not pages:
        return None
    if step_url:
        for page in pages:
            try:
                if _urls_compatible(page.url, step_url):
                    return page
            except Exception:
                continue
    return pages[-1]


async def live_verify_act_steps(
    act_steps: list[dict[str, Any]],
    *,
    cdp_url: str | None,
) -> int:
    """Stamp ActHistory steps with live Playwright-verified locators.

    Returns count of steps upgraded. No-op when cdp_url is missing.
    Does not navigate or click — only verifies against currently open pages.
    """
    if not cdp_url or not act_steps:
        return 0

    pw = None
    browser = None
    upgraded = 0
    try:
        pw, browser, pages = await _pages_from_cdp(cdp_url)
        if not pages:
            return 0

        interactive = {"click", "input", "fill", "type", "select_dropdown"}
        for step in act_steps:
            action = str(step.get("action") or "").lower()
            if action not in interactive:
                continue
            locs = list(step.get("locators") or [])
            if not locs:
                continue
            # Skip if already live-verified
            if any(l.get("verifiedBy") == "playwright" for l in locs):
                continue

            page = _pick_page(pages, step.get("url"))
            if page is None:
                continue
            # Only verify when the open page matches the step URL (avoid false uniqueness)
            if step.get("url") and not _urls_compatible(page.url, step.get("url")):
                continue

            live = await verify_candidates_on_page(page, locs, require_visible=True)
            if not live:
                continue

            live_keys = {
                (
                    str(v.get("kind")),
                    str(v.get("value")),
                    str(v.get("name") or ""),
                    str((v.get("scope") or {}).get("value") or ""),
                )
                for v in live
            }
            extras = [
                loc
                for loc in locs
                if (
                    str(loc.get("kind")),
                    str(loc.get("value")),
                    str(loc.get("name") or ""),
                    str((loc.get("scope") or {}).get("value") or ""),
                )
                not in live_keys
            ][:4]
            step["locators"] = live + extras
            step["selector"] = None  # rewritten by caller if needed
            step["locatorVerified"] = True
            step["locatorVerifiedBy"] = "playwright"
            step.pop("locatorUnverified", None)
            upgraded += 1
    except Exception as exc:
        logger.warning("Live Playwright locator verify skipped: %s", exc)
        return 0
    finally:
        # Do not close the shared browser — only stop the Playwright driver.
        if pw is not None:
            try:
                await pw.stop()
            except Exception:
                pass

    return upgraded


def cdp_url_from_browser(browser: Any) -> str | None:
    """Extract CDP websocket URL from a browser-use BrowserSession/Browser."""
    if browser is None:
        return None
    for attr in ("cdp_url", "cdpUrl"):
        try:
            val = getattr(browser, attr, None)
            if callable(val):
                val = val()
            if val and "://" in str(val):
                return str(val)
        except Exception:
            continue
    try:
        profile = getattr(browser, "browser_profile", None)
        val = getattr(profile, "cdp_url", None) if profile else None
        if val and "://" in str(val):
            return str(val)
    except Exception:
        pass
    return None
