"""
Extract ALL available browser-use AgentHistoryList data for Playwright codegen.
Codegen must use this package as the primary source of truth (NL steps are secondary).
"""
from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

MAX_PROMPT_CHARS = 120_000


def _is_verification_step(step: str) -> bool:
    return bool(re.match(r"^(verify|assert|check|ensure)\b", step.strip(), re.IGNORECASE))


def _is_navigate_back_step(step: str) -> bool:
    lowered = step.strip().lower()
    return bool(
        re.match(
            r"^(navigate|go)\s+back\b|^(navigate|go)\s+to\s+(the\s+)?previous\s+page\b",
            lowered,
        )
    )


def _is_screenshot_step(step: str) -> bool:
    return bool(re.search(r"\b(capture|take)\s+(a\s+)?screenshot\b|\bscreenshot\b", step, re.I))


def _is_url_contains_step(step: str) -> bool:
    return bool(
        re.search(
            r"\b(?:page\s+)?url\s+contains\b|\bcontains\s+(?:in\s+)?(?:the\s+)?url\b",
            step,
            re.I,
        )
    )


def _extract_url_contains_fragment(step: str) -> str | None:
    match = re.search(r"url\s+contains\s+(.+)$", step.strip(), re.I)
    if not match:
        match = re.search(r"contains\s+(.+?)\s+in\s+(?:the\s+)?url", step.strip(), re.I)
    if not match:
        return None
    fragment = match.group(1).strip().strip("\"'").rstrip(".")
    # "Software_testing or search" -> first alternative only
    fragment = re.split(r"\s+or\s+", fragment, maxsplit=1)[0].strip()
    return fragment or None


def _extract_assert_text(step: str) -> str | None:
    """Pull a stable visible string from a verify/assert NL step."""
    stripped = step.strip()
    quoted = re.search(r'[\"“](.+?)[\"”]', stripped)
    if quoted:
        return quoted.group(1).strip()

    link_visible = re.match(
        r"^(?:verify|assert|check|ensure)\s+(.+?)\s+link\s+is\s+visible\s*$",
        stripped,
        re.I,
    )
    if link_visible:
        return link_visible.group(1).strip()

    copyright_match = re.search(
        r"(Copyright\s+.+?)(?:\s+is\s+displayed|\s+in\s+the\s+footer|\s*$)",
        stripped,
        re.I,
    )
    if copyright_match:
        return copyright_match.group(1).strip()

    section_match = re.match(
        r"^(?:verify|assert|check|ensure)\s+(.+?)\s+section\s*$",
        stripped,
        re.I,
    )
    if section_match:
        return section_match.group(1).strip()

    displayed_match = re.match(
        r"^(?:verify|assert|check|ensure)\s+(.+?)(?:\s+page)?\s+"
        r"(?:is\s+)?(?:displayed|visible|shown|loaded|loads)(?:\s+successfully)?\s*$",
        stripped,
        re.I,
    )
    if displayed_match:
        text = displayed_match.group(1).strip()
        text = re.sub(r"^(the\s+)?", "", text, flags=re.I)
        text = re.sub(r"\s+(homepage|home\s+page)$", "", text, flags=re.I).strip()
        text = re.sub(r"\s+link$", "", text, flags=re.I).strip()
        text = re.sub(r"\s+heading$", "", text, flags=re.I).strip()
        # Prefer left side of "A or B" phrasing.
        text = re.split(r"\s+or\s+", text, maxsplit=1)[0].strip()
        return text or None

    generic = re.match(r"^(?:verify|assert|check|ensure)\s+(.+)$", stripped, re.I)
    if generic:
        text = generic.group(1).strip().rstrip(".")
        text = re.sub(
            r"\s+(is\s+displayed|is\s+visible|successfully|in\s+the\s+footer)$",
            "",
            text,
            flags=re.I,
        ).strip()
        if text and not _is_url_contains_step(stripped):
            return text
    return None


def _is_link_visibility_step(step: str) -> bool:
    return bool(re.search(r"\blink\s+is\s+visible\b", step, re.I))


def _link_or_text_locator_json(text: str, step: str) -> str:
    if _is_link_visibility_step(step) or re.search(r"\blink\b", step, re.I):
        return json.dumps(
            [
                {"kind": "role", "value": "link", "name": text},
                {"kind": "text", "value": text},
            ],
            ensure_ascii=False,
        )
    return _section_or_text_locator_json(text, step)


def _text_locator_json(text: str) -> str:
    return json.dumps([{"kind": "text", "value": text}], ensure_ascii=False)


def _is_page_load_verification(step: str) -> bool:
    return bool(
        re.search(
            r"(homepage|home\s+page).{0,40}(loads?|loaded|success)|loads?\s+successfully",
            step,
            re.I,
        )
    )


def _section_or_text_locator_json(text: str, step: str) -> str:
    # Text locators + .first() avoid heading false-negatives on footer columns / stylized labels.
    return _text_locator_json(text)


def build_nl_aligned_codegen_history(
    nl_steps: list[str],
    captured_actions: list[dict] | None = None,
    url_sequence: list[str] | None = None,
) -> list[dict]:
    """
    Build codegen executionHistory aligned to NL steps.

    Native browser-use often records only click/go_back captures; verify/screenshot
    NL steps must still become assert/screenshot history rows for deterministic codegen.
    """
    from .capability_contract import resolve_navigate_target

    actions = list(captured_actions or [])
    urls = list(url_sequence or [])
    history: list[dict] = []
    action_idx = 0
    current_url = urls[0] if urls else None

    def next_action(*types: str) -> dict | None:
        nonlocal action_idx
        while action_idx < len(actions):
            action = actions[action_idx]
            action_idx += 1
            if not types or action.get("type") in types:
                return action
        return None

    def append_step(
        action: str,
        *,
        description: str,
        selector: str | None = None,
        value: str | None = None,
        url: str | None = None,
    ) -> None:
        history.append(
            {
                "index": len(history) + 1,
                "action": action,
                "selector": selector,
                "value": value,
                "url": url,
                "description": description[:2000],
            }
        )

    for step in nl_steps:
        stripped = step.strip()
        if not stripped:
            continue

        nav = resolve_navigate_target(stripped)
        if nav:
            current_url = nav
            append_step("navigate", description=stripped, url=nav)
            continue

        if _is_navigate_back_step(stripped):
            next_action("go_back")
            # Never attach a pre-back URL — AssertionRanker would emit toHaveURL for the
            # old page and fail after goBack() lands on the prior location.
            append_step("go_back", description=stripped, url=None)
            if urls:
                for candidate in reversed(urls):
                    if candidate != current_url:
                        current_url = candidate
                        break
            continue

        if _is_screenshot_step(stripped):
            text = _extract_assert_text(stripped) or stripped
            selector = _text_locator_json(text) if text and text != stripped else None
            append_step(
                "screenshot",
                description=stripped,
                selector=selector,
                value=text if text != stripped else None,
                url=None,
            )
            continue

        if _is_url_contains_step(stripped):
            fragment = _extract_url_contains_fragment(stripped) or "intro"
            matching = next((u for u in urls if fragment.lower() in u.lower()), None)
            if matching:
                current_url = matching
            append_step(
                "assert",
                description=stripped,
                value=f"__url_contains__:{fragment}",
                url=matching,
            )
            continue

        if re.match(r"^click\b", stripped, re.I):
            captured = next_action("click")
            locators: list[dict] | None = None
            if captured and captured.get("locators"):
                locators = list(captured["locators"])
            click_label = re.sub(
                r"^click\s+",
                "",
                stripped,
                count=1,
                flags=re.I,
            ).strip()
            click_label = re.sub(
                r"\s+if\b.+$",
                "",
                click_label,
                flags=re.I,
            ).strip().rstrip(".")
            if click_label:
                buttonish = bool(
                    re.search(
                        r"\b(search|submit|sign[\s-]?in|log[\s-]?in|save|send|ok|accept|next|apply)\b",
                        click_label,
                        re.I,
                    )
                )
                preferred = (
                    [
                        {"kind": "role", "value": "button", "name": click_label},
                        {"kind": "role", "value": "link", "name": click_label},
                        {"kind": "text", "value": click_label},
                    ]
                    if buttonish
                    else [
                        {"kind": "role", "value": "link", "name": click_label},
                        {"kind": "role", "value": "button", "name": click_label},
                        {"kind": "text", "value": click_label},
                    ]
                )
                observed = list(locators or [])
                # Drop observed tooltip/shortcut names so they cannot outrank clean NL labels.
                cleaned_observed = [
                    loc
                    for loc in observed
                    if not (
                        isinstance(loc.get("name"), str)
                        and (
                            len(loc["name"]) > 40
                            or re.search(r"\[ctrl|\[alt|\[shift|\[cmd", loc["name"], re.I)
                        )
                    )
                ]
                merged: list[dict] = []
                for item in preferred + cleaned_observed:
                    if item not in merged:
                        merged.append(item)
                locators = merged
            selector = json.dumps(locators, ensure_ascii=False) if locators else None
            append_step(
                "click",
                description=stripped,
                selector=selector,
                url=current_url,
            )
            if urls and current_url:
                for candidate in urls:
                    if candidate != current_url:
                        idx = urls.index(current_url) if current_url in urls else -1
                        if idx >= 0 and idx + 1 < len(urls):
                            current_url = urls[idx + 1]
                        break
            continue

        if re.match(r"^(input|type|fill|enter)\b", stripped, re.I):
            captured = next_action("input", "fill", "type")
            selector = (
                json.dumps(captured["locators"], ensure_ascii=False)
                if captured and captured.get("locators")
                else None
            )
            value = str((captured or {}).get("value") or "") or None
            append_step(
                "fill" if (captured or {}).get("type") in ("input", "fill", "type") else "input",
                description=stripped,
                selector=selector,
                value=value,
                url=current_url,
            )
            continue

        if _is_verification_step(stripped):
            if _is_page_load_verification(stripped) and current_url:
                append_step(
                    "assert",
                    description=stripped,
                    value=f"__url_equals__:{current_url}",
                    url=current_url,
                )
                continue
            text = _extract_assert_text(stripped)
            if text:
                append_step(
                    "assert",
                    description=stripped,
                    selector=_link_or_text_locator_json(text, stripped),
                    value=text,
                    url=None,
                )
            else:
                append_step(
                    "assert",
                    description=stripped,
                    url=current_url,
                )
            continue

        # Fallback: preserve any leftover interact capture if NL did not match.
        captured = next_action("click", "input", "press", "wait", "navigate", "go_back")
        if captured:
            append_step(
                str(captured.get("type") or "custom"),
                description=stripped,
                selector=(
                    json.dumps(captured["locators"], ensure_ascii=False)
                    if captured.get("locators")
                    else None
                ),
                value=str(captured.get("value") or "") or None,
                url=captured.get("url") or current_url,
            )
        else:
            append_step("custom", description=stripped, url=current_url)

    # Append any unused locator-rich captures so codegen does not lose observed clicks.
    while action_idx < len(actions):
        leftover = actions[action_idx]
        action_idx += 1
        if leftover.get("type") not in ("click", "input", "go_back", "navigate"):
            continue
        append_step(
            str(leftover.get("type") or "custom"),
            description=f"native:{leftover.get('type')}",
            selector=(
                json.dumps(leftover["locators"], ensure_ascii=False)
                if leftover.get("locators")
                else None
            ),
            value=str(leftover.get("value") or "") or None,
            url=leftover.get("url") or current_url,
        )

    return history


def append_replay_history_from_capability(
    execution_history: list[dict],
    capability: dict[str, Any] | None,
    *,
    description: str,
    url: str | None,
    redact_value: Callable[[str], str] | None = None,
    fallback_action: str = "knowledge-replay",
) -> None:
    """Expand stored capability actions into codegen-friendly execution history."""
    redact = redact_value or (lambda value: value)
    actions = (capability or {}).get("actions") or []
    if not actions:
        execution_history.append(
            {
                "index": len(execution_history) + 1,
                "action": fallback_action,
                "description": description,
                "url": url,
            }
        )
        return

    for action in actions:
        raw_value = str(action.get("value") or "")
        redacted_value = redact(raw_value) if raw_value else ""
        execution_history.append(
            {
                "index": len(execution_history) + 1,
                "action": action.get("type", fallback_action),
                "selector": json.dumps(action.get("locators")) if action.get("locators") else None,
                "value": redacted_value or None,
                "url": action.get("url") or url,
                "description": description,
            }
        )


def append_recipe_replay_history(
    execution_history: list[dict],
    step: str,
    *,
    description: str,
    url: str | None,
) -> None:
    """Record recipe replay steps with concrete actions for deterministic codegen."""
    from .capability_contract import resolve_navigate_target

    stripped = step.strip()
    nav_url = resolve_navigate_target(stripped)
    if nav_url:
        execution_history.append(
            {
                "index": len(execution_history) + 1,
                "action": "navigate",
                "url": nav_url or url,
                "description": description,
            }
        )
        return

    if _is_verification_step(stripped):
        execution_history.append(
            {
                "index": len(execution_history) + 1,
                "action": "assert_visible_page",
                "url": url,
                "description": description,
            }
        )
        return

    execution_history.append(
        {
            "index": len(execution_history) + 1,
            "action": "recipe-replay",
            "description": description,
            "url": url,
        }
    )


def _safe_str(value: Any, limit: int = 4000) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value[:limit]
    try:
        return json.dumps(value, default=str)[:limit]
    except Exception:
        return str(value)[:limit]


def extract_execution_history(history_list: Any) -> list[dict]:
    """Structured steps for Engine-compatible execution history."""
    steps: list[dict] = []
    if history_list is None:
        return steps

    seen: set[str] = set()

    def add_step(index: int, action: str, selector: str | None, value: str | None, url: str | None, description: str):
        key = f"{action}|{selector}|{value}|{url}|{description[:200]}"
        if key in seen:
            return
        seen.add(key)
        steps.append(
            {
                "index": len(steps) + 1,
                "action": action,
                "selector": selector,
                "value": value,
                "url": url,
                "description": description[:2000],
            }
        )

    try:
        for action in history_list.model_actions() or []:
            if not isinstance(action, dict):
                action = {"raw": _safe_str(action)}
            add_step(
                len(steps) + 1,
                str(
                    action.get("action_name")
                    or action.get("name")
                    or action.get("action")
                    or action.get("type")
                    or "custom"
                ).lower(),
                _safe_str(action.get("selector") or action.get("css_selector") or action.get("element_index"))
                or None,
                _safe_str(action.get("value") or action.get("text") or action.get("input")) or None,
                action.get("url"),
                _safe_str(action),
            )
    except Exception:
        pass

    try:
        for name in getattr(history_list, "action_names", lambda: [])() or []:
            add_step(len(steps) + 1, str(name).lower(), None, None, None, f"action_name: {name}")
    except Exception:
        pass

    try:
        dump = history_list.model_dump()
        histories = dump.get("history") or []
        if isinstance(histories, list):
            for item in histories:
                if not isinstance(item, dict):
                    continue
                state = item.get("state") or {}
                if isinstance(state, dict):
                    url = state.get("url") or state.get("page_url")
                    title = state.get("title")
                    if url:
                        add_step(
                            len(steps) + 1,
                            "navigate",
                            None,
                            None,
                            url,
                            f"page state: {title or ''}",
                        )
                results = item.get("result") or []
                if isinstance(results, list):
                    for r in results:
                        if isinstance(r, dict):
                            mem = r.get("long_term_memory") or r.get("extracted_content")
                            if mem:
                                add_step(len(steps) + 1, "custom", None, None, None, _safe_str(mem))
                mo = item.get("model_output")
                if mo:
                    add_step(len(steps) + 1, "plan", None, None, None, _safe_str(mo, 1500))
    except Exception:
        pass

    return steps


def _collect_url_sequence(history_list: Any) -> list[str]:
    urls: list[str] = []
    if history_list is None:
        return urls
    try:
        dump = history_list.model_dump()
        for item in dump.get("history") or []:
            if isinstance(item, dict):
                state = item.get("state") or {}
                if isinstance(state, dict) and state.get("url"):
                    u = str(state["url"])
                    if not urls or urls[-1] != u:
                        urls.append(u)
    except Exception:
        pass
    return urls


def _collect_memories_and_extractions(history_list: Any) -> dict:
    out = {
        "longTermMemories": [],
        "extractedContents": [],
        "actionResults": [],
        "finalResult": None,
        "errors": [],
    }
    if history_list is None:
        return out

    try:
        if hasattr(history_list, "extracted_content"):
            ec = history_list.extracted_content()
            if ec:
                out["extractedContents"].append(_safe_str(ec, 8000))
    except Exception:
        pass

    try:
        if hasattr(history_list, "final_result"):
            fr = history_list.final_result()
            if fr is not None:
                out["finalResult"] = _safe_str(fr, 8000)
    except Exception:
        pass

    try:
        for err in getattr(history_list, "errors", lambda: [])() or []:
            out["errors"].append(_safe_str(err, 1000))
    except Exception:
        pass

    try:
        for ar in getattr(history_list, "action_results", lambda: [])() or []:
            out["actionResults"].append(_safe_str(ar, 2000))
    except Exception:
        pass

    try:
        dump = history_list.model_dump()
        for item in dump.get("history") or []:
            if not isinstance(item, dict):
                continue
            for r in item.get("result") or []:
                if isinstance(r, dict):
                    if r.get("long_term_memory"):
                        out["longTermMemories"].append(_safe_str(r["long_term_memory"], 2000))
                    if r.get("extracted_content"):
                        out["extractedContents"].append(_safe_str(r["extracted_content"], 2000))
    except Exception:
        pass

    return out


def build_runtime_insights(history_list: Any, nl_steps: list[str]) -> dict:
    insights: list[dict] = []
    blob = ""

    if history_list is not None:
        try:
            blob = json.dumps(history_list.model_dump(), default=str).lower()
        except Exception:
            blob = _safe_str(history_list).lower()

    # Avoid false positives from footer "Privacy" links / prompt boilerplate
    # (discovery rules mention OneTrust / cookie consent even when unused).
    cookie_signals = [
        "fc-consent-root",
        "fc-cta-consent",
        "accept all cookies",
        "#onetrust-banner-sdk",
        "#onetrust-accept-btn-handler",
        "dismisscookieconsentifpresent",
    ]
    cookie_hit = any(sig in blob for sig in cookie_signals)
    ae_hit = "automationexercise.com" in blob or any(
        "automationexercise" in s.lower() for s in nl_steps
    )
    if cookie_hit and ae_hit:
        insights.append(
            {
                "type": "cookie_consent",
                "required": True,
                "message": (
                    "Live execution interacted with a cookie/consent overlay. "
                    "Generated code MUST include AutomationExerciseBasePage.dismissCookieConsentIfPresent() "
                    "and call it after open/navigate and before clicking nav links."
                ),
                "suggestedMethod": "dismissCookieConsentIfPresent",
                "suggestedSelectors": [
                    ".fc-consent-root",
                    "button.fc-cta-consent",
                    "getByRole('button', { name: 'Consent', exact: true })",
                ],
            }
        )
    elif cookie_hit:
        insights.append(
            {
                "type": "cookie_consent",
                "required": True,
                "message": (
                    "Live execution interacted with a cookie/consent overlay. "
                    "Dismiss the banner (Accept / Accept all / Consent) after navigate before primary clicks."
                ),
                "suggestedMethod": "dismissCookieConsentIfPresent",
            }
        )
    if any(sig in blob for sig in ["add to cart", "add-to-cart"]):
        insights.append(
            {
                "type": "add_to_cart_locator",
                "required": True,
                "message": (
                    "Add to cart uses <a class='add-to-cart'>, not role=button. "
                    "Use card.locator('a.add-to-cart').first()."
                ),
            }
        )

    if any(sig in blob for sig in ["continue shopping", "view cart", "cartmodal", "#cartmodal"]):
        insights.append(
            {
                "type": "cart_modal",
                "required": True,
                "message": (
                    "Cart confirmation uses #cartModal. Continue: #cartModal button.close-modal (evaluate click if hidden). "
                    "View Cart: #cartModal a[href='/view_cart'] with waitForURL(/view_cart/)."
                ),
            }
        )

    if any(sig in blob for sig in ["view_cart", "/view_cart", "cart_info_table"]):
        insights.append(
            {
                "type": "cart_page_assert",
                "required": True,
                "message": (
                    "Cart page: assert URL /view_cart and #cart_info_table tbody rows — "
                    "NEVER assert getByRole('heading', Shopping Cart). Use .cart_description/.cart_price/.cart_quantity/.cart_total with .first()."
                ),
            }
        )

    if "automationexercise.com" in blob or any("automationexercise" in s.lower() for s in nl_steps):
        insights.append(
            {
                "type": "canonical_pom",
                "required": True,
                "message": (
                    "WebPilot injects canonical AutomationExercise POMs post-codegen. "
                    "Spec MUST import @pages/automationexercise/* and call: goto, assertFeaturedItemsVisible, "
                    "goToProductsPage, assertAllProductsVisible, hoverProductAt, addToCartProductAt, handleCartModal, "
                    "assertOnCartPage, assertCartProducts."
                ),
            }
        )

    urls = _collect_url_sequence(history_list)
    if urls:
        insights.append({"type": "url_flow", "required": True, "urls": urls, "message": f"Pages visited: {' -> '.join(urls)}"})

    return {"nlStepCount": len(nl_steps), "insights": insights}


def build_full_execution_context(
    history_list: Any,
    nl_steps: list[str],
    test_name: str,
    page_snapshots: dict[str, dict] | None = None,
) -> dict:
    """
    Complete browser-use export — primary input for codegen / Playwright replay.

    Source of truth is ActHistory transformed from AgentHistoryList.
    NL steps are reference + assertionPlan only — they do not overwrite acts.
    page_snapshots: optional selector_map inventories keyed by pageKey for DOM verify.
    """
    from .act_history import (
        ACT_HISTORY_SCHEMA_VERSION,
        act_history_to_execution_rows,
        build_act_history,
        build_assertion_plan,
        build_run_log,
    )
    from .page_inventory import upsert_inventory

    act_steps = build_act_history(history_list, page_snapshots=page_snapshots)
    # Persist page inventories + verified locators from ActHistory
    if page_snapshots:
        for _key, snap in page_snapshots.items():
            try:
                upsert_inventory(snap)
            except Exception:
                pass
    for step in act_steps:
        locs = step.get("locators") or []
        verified = next((l for l in locs if l.get("verified")), None)
        if verified and step.get("url"):
            try:
                upsert_inventory(
                    {
                        "url": step.get("url"),
                        "pageKey": None,
                        "title": step.get("pageTitle"),
                        "elements": [],
                        "elementCount": 0,
                        "capturedAt": None,
                        "fingerprint": None,
                        "schemaVersion": 1,
                        "verifiedLocators": [],
                    },
                    verified_locator=verified,
                    ax_name=(step.get("element") or {}).get("ax_name"),
                )
            except Exception:
                pass

    # executionHistory = ActHistory rows (legacy TraceBuilder-compatible shape).
    execution_history = act_history_to_execution_rows(act_steps)
    # Legacy extract kept for debug only (element_index dumps, memories noise).
    legacy_raw = extract_execution_history(history_list)
    runtime_insights = build_runtime_insights(history_list, nl_steps)
    memories = _collect_memories_and_extractions(history_list)

    full_dump = None
    if history_list is not None:
        try:
            full_dump = history_list.model_dump()
        except Exception:
            full_dump = {"error": "model_dump unavailable"}

    agent_steps = None
    try:
        if history_list is not None and hasattr(history_list, "agent_steps"):
            agent_steps = history_list.agent_steps()
    except Exception:
        pass

    return {
        "testName": test_name,
        "nlSteps": nl_steps,
        "schemaVersion": ACT_HISTORY_SCHEMA_VERSION,
        "historySource": "browser-use-act-history",
        "actHistory": act_steps,
        "executionHistory": execution_history,
        "assertionPlan": build_assertion_plan(nl_steps),
        "runLog": build_run_log(history_list),
        "legacyRawHistory": legacy_raw,
        "runtimeInsights": runtime_insights,
        "urlSequence": _collect_url_sequence(history_list),
        "actionNames": list(getattr(history_list, "action_names", lambda: [])() or []) if history_list else [],
        "memoriesAndExtractions": memories,
        "agentSteps": agent_steps,
        "isSuccessful": bool(getattr(history_list, "is_successful", lambda: False)()) if history_list else False,
        "isDone": bool(getattr(history_list, "is_done", lambda: False)()) if history_list else False,
        "fullHistoryDump": full_dump,
    }


def format_history_for_prompt(context: dict) -> str:
    """Format full execution context for LLM codegen (ActHistory is source of truth)."""
    lines = [
        "=== CODEGEN SOURCE OF TRUTH: BROWSER-USE ACT HISTORY ===",
        "Generate Playwright code from ActHistory / executionHistory below.",
        "NL steps and assertionPlan are secondary (expects/screenshots only).",
        "Do not invent clicks that are not present in ActHistory.",
        "",
        f"Test: {context.get('testName', '')}",
        f"Agent success: {context.get('isSuccessful')} | done: {context.get('isDone')}",
        f"History source: {context.get('historySource', 'unknown')}",
        "",
        "=== URL FLOW ===",
    ]
    for u in context.get("urlSequence") or []:
        lines.append(f"  - {u}")

    lines.append("")
    lines.append("=== ACTION NAMES (WebPilot agent) ===")
    for n in context.get("actionNames") or []:
        lines.append(f"  - {n}")

    lines.append("")
    lines.append("=== STRUCTURED ACT / EXECUTION HISTORY ===")
    for step in context.get("executionHistory") or []:
        lines.append(
            f"{step.get('index')}. [{step.get('action')}] "
            f"selector={step.get('selector') or 'none'} "
            f"value={step.get('value') or 'none'} "
            f"url={step.get('url') or 'none'}"
        )
        desc = step.get("description", "")
        if desc:
            lines.append(f"    {desc[:800]}")

    assertion_plan = context.get("assertionPlan") or []
    if assertion_plan:
        lines.append("")
        lines.append("=== ASSERTION PLAN (codegen expects only — not live acts) ===")
        for item in assertion_plan:
            lines.append(f"- [{item.get('kind')}] NL#{item.get('index')}: {item.get('nlStep')}")

    mem = context.get("memoriesAndExtractions") or {}
    if mem.get("finalResult"):
        lines.extend(["", "=== FINAL AGENT RESULT ===", mem["finalResult"][:6000]])
    for m in mem.get("longTermMemories") or []:
        lines.extend(["", "=== AGENT MEMORY ===", m[:2000]])
    for e in mem.get("extractedContents") or []:
        lines.extend(["", "=== EXTRACTED CONTENT ===", e[:3000]])

    lines.append("")
    lines.append("=== RUNTIME INSIGHTS (mandatory in generated code) ===")
    for insight in (context.get("runtimeInsights") or {}).get("insights", []):
        lines.append(f"- [{insight.get('type')}] {insight.get('message')}")

    lines.append("")
    lines.append("=== NL STEPS (secondary reference) ===")
    for s in context.get("nlSteps") or []:
        lines.append(f"- {s}")

    if context.get("agentSteps"):
        lines.extend(["", "=== AGENT STEPS (raw) ===", _safe_str(context["agentSteps"], 15000)])

    full = context.get("fullHistoryDump")
    if full:
        dump_str = json.dumps(full, default=str, indent=2)
        if len(dump_str) > 40000:
            dump_str = dump_str[:40000] + "\n... [truncated]"
        lines.extend(["", "=== FULL BROWSER-USE HISTORY DUMP ===", dump_str])

    text = "\n".join(lines)
    if len(text) > MAX_PROMPT_CHARS:
        text = text[:MAX_PROMPT_CHARS] + "\n... [truncated for token limit]"
    return text


# Back-compat wrappers
def format_history_for_prompt_legacy(execution_history: list[dict], runtime_insights: dict) -> str:
    return format_history_for_prompt(
        {
            "testName": "",
            "nlSteps": [],
            "executionHistory": execution_history,
            "runtimeInsights": runtime_insights,
            "urlSequence": [],
            "actionNames": [],
            "memoriesAndExtractions": {},
            "isSuccessful": True,
            "isDone": True,
        }
    )
