"""
ActHistory — transform browser-use AgentHistoryList into re-execution history.

Design rules (WebPilot consumer architecture):
- browser-use owns live targeting (index / selector_map).
- This module TRANSFORMS history; it does not invent NL-aligned rows.
- Semantic locator candidates are attached for Playwright codegen/replay only.
- Failures, healing, and LLM meta belong in RunLog — not ActHistory.
"""
from __future__ import annotations

import json
import re
from typing import Any

ACT_HISTORY_SCHEMA_VERSION = 1

# Actions that represent real browser work for re-execution / codegen.
_ACT_ACTIONS = frozenset(
    {
        "navigate",
        "search",
        "click",
        "input",
        "fill",
        "type",
        "send_keys",
        "press",
        "go_back",
        "wait",
        "scroll",
        "select_dropdown",
        "upload_file",
        "switch",
        "close",
        "screenshot",
        "extract",
        "find_text",
        "evaluate",
    }
)

_SKIP_ACTIONS = frozenset({"done", "think", "plan"})

_LOCATOR_KIND_PRIORITY = {
    "role": 0,
    "label": 1,
    "placeholder": 2,
    "testid": 3,
    "text": 4,
    "css": 5,
    "xpath": 6,
}

_ABSOLUTE_XPATH_RE = re.compile(
    r"^(?:html|/html|/body|body)(/|$)",
    re.IGNORECASE,
)


def _clean_text(value: str | None, limit: int = 200) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"[\ue000-\uf8ff]", " ", str(value))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:limit]


def _element_to_dict(element: Any) -> dict[str, Any] | None:
    if element is None:
        return None
    if isinstance(element, dict):
        return element
    to_dict = getattr(element, "to_dict", None)
    if callable(to_dict):
        try:
            return to_dict()
        except Exception:
            pass
    return {
        "node_name": getattr(element, "node_name", None),
        "attributes": getattr(element, "attributes", None) or {},
        "x_path": getattr(element, "x_path", None),
        "ax_name": getattr(element, "ax_name", None),
        "element_hash": getattr(element, "element_hash", None),
        "stable_hash": getattr(element, "stable_hash", None),
        "backend_node_id": getattr(element, "backend_node_id", None),
        "node_id": getattr(element, "node_id", None),
        "frame_id": getattr(element, "frame_id", None),
    }


def _escape_xpath_literal(value: str) -> str:
    """Quote a string for use inside an XPath literal."""
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'
    return "concat('" + "', \"'\", '".join(value.split("'")) + "')"


def _is_absolute_xpath(xpath: str | None) -> bool:
    if not xpath:
        return False
    cleaned = xpath.strip().lstrip("/")
    return bool(_ABSOLUTE_XPATH_RE.match(cleaned)) or (
        xpath.startswith("/html") or xpath.startswith("html/")
    )


def _relative_xpath_candidates(
    tag: str,
    attrs: dict[str, Any],
    accessible_name: str,
    absolute_xpath: str | None = None,
) -> list[dict[str, str]]:
    """Build relative/attribute-anchored XPath fallbacks — never raw absolute paths."""
    out: list[dict[str, str]] = []
    tag = tag or "*"

    def add(expr: str, **extra: str) -> None:
        item = {"kind": "xpath", "value": expr}
        item.update({k: v for k, v in extra.items() if v})
        out.append(item)

    testid = attrs.get("data-testid") or attrs.get("data-test") or attrs.get("data-cy")
    if testid:
        add(f"//*[@data-testid={_escape_xpath_literal(str(testid))}]")
    el_id = attrs.get("id")
    if el_id and re.match(r"^[A-Za-z][\w:-]*$", str(el_id)):
        add(f"//{tag}[@id={_escape_xpath_literal(str(el_id))}]")
    name_attr = attrs.get("name")
    if name_attr:
        add(f"//{tag}[@name={_escape_xpath_literal(str(name_attr))}]")
    href = attrs.get("href")
    if tag == "a" and href:
        add(f"//a[@href={_escape_xpath_literal(str(href))}]")
        if accessible_name:
            add(
                f"//a[@href={_escape_xpath_literal(str(href))} and "
                f"normalize-space(.)={_escape_xpath_literal(accessible_name)}]"
            )
    placeholder = attrs.get("placeholder")
    if placeholder:
        add(f"//{tag}[@placeholder={_escape_xpath_literal(_clean_text(placeholder))}]")
    aria = attrs.get("aria-label")
    if aria:
        add(f"//{tag}[@aria-label={_escape_xpath_literal(_clean_text(aria))}]")
    role = attrs.get("role")
    if role and accessible_name:
        add(
            f"//*[@role={_escape_xpath_literal(str(role))} and "
            f"normalize-space(.)={_escape_xpath_literal(accessible_name)}]"
        )
    if accessible_name and tag in ("a", "button", "label", "h1", "h2", "h3", "span", "div", "li"):
        add(
            f"//{tag}[normalize-space(.)={_escape_xpath_literal(accessible_name)}]",
            filterText=accessible_name,
        )
        add(
            f"//{tag}[contains(normalize-space(.), {_escape_xpath_literal(accessible_name)})]",
            filterText=accessible_name,
        )

    # If browser-use gave a relative xpath already, keep it; drop absolute trees.
    if absolute_xpath and not _is_absolute_xpath(absolute_xpath):
        xp = absolute_xpath.strip()
        if not xp.startswith("//") and not xp.startswith("(") and not xp.startswith("./"):
            if xp.startswith("/"):
                xp = "/" + xp  # keep as-is
            else:
                xp = f"//{xp.lstrip('/')}"
        # Normalize html/body/... leftovers that slipped past
        if not _is_absolute_xpath(xp):
            add(xp if xp.startswith("//") or xp.startswith("(") else f"//{xp}")

    return out


def locator_candidates_from_element(element: Any) -> list[dict[str, str]]:
    """Build Playwright-oriented locator candidates from a browser-use interacted element.

    Preference order: role / label / placeholder / testid / text / css / relative xpath.
    Absolute html/body/... xpaths from browser-use are never stored — they are replaced
    with attribute- or text-anchored relative expressions, and semantic candidates carry
    filterText so replay can disambiguate when multiple matches exist.
    """
    data = _element_to_dict(element) or {}
    attrs = dict(data.get("attributes") or {})
    tag = (data.get("node_name") or attrs.get("tag") or "*").lower()
    if ":" in tag:
        tag = tag.split(":")[-1]
    ax_name = _clean_text(data.get("ax_name") or attrs.get("aria-label") or attrs.get("ax_name"))
    text = _clean_text(attrs.get("text") or data.get("node_value") or ax_name)
    accessible_name = ax_name or text or _clean_text(attrs.get("value"))
    input_type = (attrs.get("type") or "").lower()
    candidates: list[dict[str, str]] = []

    if tag == "a" and accessible_name:
        candidates.append(
            {"kind": "role", "value": "link", "name": accessible_name, "filterText": accessible_name}
        )
    if tag == "button" and accessible_name:
        candidates.append(
            {
                "kind": "role",
                "value": "button",
                "name": accessible_name,
                "filterText": accessible_name,
            }
        )
    if tag == "input" and input_type in ("submit", "button") and accessible_name:
        candidates.append(
            {
                "kind": "role",
                "value": "button",
                "name": accessible_name,
                "filterText": accessible_name,
            }
        )
    role = attrs.get("role")
    if role and accessible_name:
        candidates.append(
            {
                "kind": "role",
                "value": str(role),
                "name": accessible_name,
                "filterText": accessible_name,
            }
        )
    placeholder = attrs.get("placeholder")
    if placeholder:
        candidates.append({"kind": "placeholder", "value": _clean_text(placeholder)})
    for test_attr in ("data-testid", "data-test", "data-cy"):
        value = attrs.get(test_attr)
        if value:
            candidates.append({"kind": "testid", "value": str(value)})
    for attr in ("name", "id", "aria-label"):
        value = attrs.get(attr)
        if value:
            candidates.append({"kind": "css", "value": f'{tag}[{attr}="{value}"]'})
    href = attrs.get("href")
    if tag == "a" and href:
        css = {"kind": "css", "value": f'a[href="{href}"]'}
        if accessible_name:
            css["filterText"] = accessible_name
        candidates.append(css)
    if text and len(text) <= 120:
        candidates.append({"kind": "text", "value": text, "tag": tag, "filterText": text})

    candidates.extend(
        _relative_xpath_candidates(
            tag,
            attrs,
            accessible_name,
            absolute_xpath=str(data.get("x_path") or "") or None,
        )
    )

    seen: set[tuple[str, str, str]] = set()
    unique: list[dict[str, str]] = []
    for candidate in sorted(
        candidates,
        key=lambda item: (
            _LOCATOR_KIND_PRIORITY.get(item.get("kind", "css"), 99),
            len(item.get("name", item.get("value", ""))),
        ),
    ):
        key = (
            candidate.get("kind", ""),
            candidate.get("value", candidate.get("name", "")),
            candidate.get("name", ""),
        )
        if key in seen:
            continue
        # Never keep absolute html/body trees even if they sneaked in.
        if candidate.get("kind") == "xpath" and _is_absolute_xpath(candidate.get("value")):
            continue
        seen.add(key)
        unique.append(candidate)
    return unique[:10]


def _action_name_and_params(action_dump: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """browser-use model_actions dumps look like {'click': {'index': 3}, 'interacted_element': ...}."""
    params: dict[str, Any] = {}
    name = "custom"
    for key, value in action_dump.items():
        if key in ("interacted_element", "result"):
            continue
        name = str(key)
        params = value if isinstance(value, dict) else {"value": value}
        break
    return name, params or {}


def _normalize_action(name: str) -> str:
    lowered = name.lower().strip()
    aliases = {
        "fill": "input",
        "type": "input",
        "send_keys": "press",
        "navigate_back": "go_back",
        "back": "go_back",
        "switch_tab": "switch",
        "close_tab": "close",
        "take_screenshot": "screenshot",
    }
    return aliases.get(lowered, lowered)


def _page_meta_from_history_item(item: Any) -> tuple[str | None, str | None]:
    state = getattr(item, "state", None)
    if state is None:
        return None, None
    url = getattr(state, "url", None) or getattr(state, "page_url", None)
    title = getattr(state, "title", None)
    if isinstance(state, dict):
        url = state.get("url") or state.get("page_url") or url
        title = state.get("title") or title
    return (str(url) if url else None, str(title) if title else None)


def build_act_history(history_list: Any) -> list[dict[str, Any]]:
    """
    Build ActHistory steps strictly from browser-use AgentHistoryList.

    Does not zip NL steps. Does not invent verify/assert rows.
    """
    if history_list is None:
        return []

    steps: list[dict[str, Any]] = []
    history_items = getattr(history_list, "history", None) or []

    # Prefer walking history items so we keep page URL/title per agent step.
    if history_items:
        for agent_step_idx, item in enumerate(history_items):
            model_output = getattr(item, "model_output", None)
            if model_output is None:
                continue
            actions = getattr(model_output, "action", None) or []
            interacted = getattr(getattr(item, "state", None), "interacted_element", None) or []
            page_url, page_title = _page_meta_from_history_item(item)
            results = getattr(item, "result", None) or []

            for action_idx, action_model in enumerate(actions):
                try:
                    dumped = action_model.model_dump(exclude_none=True, mode="json")
                except Exception:
                    continue
                # Single-key action payloads: {"click": {...}}
                name, params = _action_name_and_params(dumped)
                action = _normalize_action(name)
                if action in _SKIP_ACTIONS:
                    continue
                if action not in _ACT_ACTIONS and action != "custom":
                    # Keep unknown tools as custom rather than drop them silently.
                    action = "custom"

                element = interacted[action_idx] if action_idx < len(interacted) else None
                element_dict = _element_to_dict(element)
                locators = locator_candidates_from_element(element) if element_dict else []

                value = None
                if action == "input":
                    value = params.get("text") or params.get("value")
                elif action == "press":
                    value = params.get("keys") or params.get("key")
                elif action == "navigate":
                    value = params.get("url")
                    if params.get("url"):
                        page_url = str(params["url"])
                elif action == "wait":
                    value = params.get("seconds")
                elif action == "search":
                    value = params.get("query") or params.get("text")

                element_index = params.get("index")
                result_memory = None
                if action_idx < len(results):
                    result = results[action_idx]
                    result_memory = getattr(result, "long_term_memory", None) or getattr(
                        result, "extracted_content", None
                    )

                description_parts = [action]
                if value is not None and action != "input":
                    description_parts.append(str(value)[:120])
                if element_dict and (element_dict.get("ax_name") or locators):
                    name_hint = (element_dict.get("ax_name") or (locators[0].get("name") if locators else "")) or ""
                    if name_hint:
                        description_parts.append(str(name_hint)[:80])
                if result_memory:
                    description_parts.append(str(result_memory)[:160])

                step: dict[str, Any] = {
                    "index": len(steps) + 1,
                    "action": action if action != "custom" else name,
                    "selector": json.dumps(locators, ensure_ascii=False) if locators else None,
                    "value": None if value is None else str(value),
                    "url": page_url,
                    "description": " | ".join(description_parts)[:2000],
                    # ActHistory extensions (codegen / Playwright replay):
                    "pageTitle": page_title,
                    "elementIndex": element_index,
                    "element": element_dict,
                    "locators": locators,
                    "agentStep": agent_step_idx + 1,
                    "actionParams": params,
                }
                steps.append(step)
        return steps

    # Fallback: model_actions() when history items are unavailable.
    try:
        for action_dump in history_list.model_actions() or []:
            if not isinstance(action_dump, dict):
                continue
            name, params = _action_name_and_params(action_dump)
            action = _normalize_action(name)
            if action in _SKIP_ACTIONS:
                continue
            element = action_dump.get("interacted_element")
            element_dict = _element_to_dict(element)
            locators = locator_candidates_from_element(element) if element_dict else []
            value = params.get("text") or params.get("url") or params.get("keys") or params.get("key")
            steps.append(
                {
                    "index": len(steps) + 1,
                    "action": action if action != "custom" else name,
                    "selector": json.dumps(locators, ensure_ascii=False) if locators else None,
                    "value": None if value is None else str(value),
                    "url": params.get("url"),
                    "description": f"{action}",
                    "pageTitle": None,
                    "elementIndex": params.get("index"),
                    "element": element_dict,
                    "locators": locators,
                    "agentStep": None,
                    "actionParams": params,
                }
            )
    except Exception:
        pass
    return steps


def build_assertion_plan(nl_steps: list[str]) -> list[dict[str, Any]]:
    """
    NL-derived assertion intents for codegen — NOT part of ActHistory.

    Verify/screenshot expectations live here so act history stays faithful to
    browser-use actions only.
    """
    plan: list[dict[str, Any]] = []
    for i, step in enumerate(nl_steps or [], start=1):
        stripped = (step or "").strip()
        if not stripped:
            continue
        if re.match(r"^(verify|assert|check|ensure)\b", stripped, re.I):
            plan.append({"index": i, "kind": "assert", "nlStep": stripped})
        elif re.search(r"\b(capture|take)\s+(a\s+)?screenshot\b|\bscreenshot\b", stripped, re.I):
            plan.append({"index": i, "kind": "screenshot", "nlStep": stripped})
    return plan


def build_run_log(history_list: Any, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Audit / healing / failure metadata — separate from ActHistory."""
    errors: list[Any] = []
    try:
        if history_list is not None and hasattr(history_list, "errors"):
            errors = [e for e in (history_list.errors() or []) if e]
    except Exception:
        pass

    run_log: dict[str, Any] = {
        "schemaVersion": ACT_HISTORY_SCHEMA_VERSION,
        "isSuccessful": bool(getattr(history_list, "is_successful", lambda: False)()) if history_list else False,
        "isDone": bool(getattr(history_list, "is_done", lambda: False)()) if history_list else False,
        "errors": errors,
        "actionNames": list(getattr(history_list, "action_names", lambda: [])() or []) if history_list else [],
        "healing": [],
        "failures": [],
    }
    if extra:
        run_log.update(extra)
    return run_log


def act_history_to_execution_rows(act_steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Narrow ActHistory to the legacy executionHistory row shape used by TraceBuilder.

    Keeps selector JSON + action/value/url/description; drops audit-only fields from the
    narrow view while full act steps remain under context['actHistory'].
    """
    rows: list[dict[str, Any]] = []
    for step in act_steps:
        rows.append(
            {
                "index": step.get("index"),
                "action": step.get("action"),
                "selector": step.get("selector"),
                "value": step.get("value"),
                "url": step.get("url"),
                "description": step.get("description"),
                "locators": step.get("locators") or [],
                "pageTitle": step.get("pageTitle"),
                "elementIndex": step.get("elementIndex"),
            }
        )
    return rows
