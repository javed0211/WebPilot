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

    cookie_signals = ["consent", "cookie", "fc-consent", "accept all", "agree", "privacy"]
    if any(sig in blob for sig in cookie_signals):
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


def build_full_execution_context(history_list: Any, nl_steps: list[str], test_name: str) -> dict:
    """
    Complete browser-use export — primary input for codegen.
    """
    execution_history = extract_execution_history(history_list)
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
        "executionHistory": execution_history,
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
    """Format full execution context for LLM codegen (browser-use is source of truth)."""
    lines = [
        "=== CODEGEN SOURCE OF TRUTH: BROWSER-USE LIVE EXECUTION ===",
        "Generate Playwright code from the data below. NL steps are reference only.",
        "Every workaround in execution history (cookies, modals, locators) MUST appear in POMs.",
        "",
        f"Test: {context.get('testName', '')}",
        f"Agent success: {context.get('isSuccessful')} | done: {context.get('isDone')}",
        "",
        "=== URL FLOW ===",
    ]
    for u in context.get("urlSequence") or []:
        lines.append(f"  - {u}")

    lines.append("")
    lines.append("=== ACTION NAMES (browser-use) ===")
    for n in context.get("actionNames") or []:
        lines.append(f"  - {n}")

    lines.append("")
    lines.append("=== STRUCTURED EXECUTION HISTORY ===")
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
