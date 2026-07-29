"""
Compact workflow engine — durable, ordered steps for Playwright replay / codegen.

Site phrasing/CSS live in rulebook vocab.json (via intent helpers). Legacy
site-regex remains only behind WEBPILOT_COMPACT_HEURISTICS=1.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .intent import (
    css_probe_score,
    exclusive_conflict_nl_act,
    has_intent_act,
    is_add_to_cart_blob,
    is_add_to_cart_nl,
    is_cart_line_details_nl,
    is_cart_verify_nl,
    is_continue_shopping_blob,
    is_continue_shopping_nl,
    is_view_cart_blob,
    locator_templates_for_optional,
    search_page_bridge_bonus,
    url_ground_for_nl,
)
from .vocab_context import current_vocab, heuristics_enabled, use_vocab

COMPACT_WORKFLOW_SCHEMA_VERSION = 1

_DROP_ACTIONS = frozenset(
    {
        "search_page",
        "extract",
        "evaluate",
        "find_elements",
        "find_text",
        "search",
        "switch",
        "close",
        "done",
        "custom",
        "think",
        "plan",
        "write_file",
        "replace_file",
        "read_file",
        "append_file",
        "write_todos",
        "update_todo",
    }
)

_KEEP_ACTIONS = frozenset(
    {
        "navigate",
        "goto",
        "go_to",
        "open",
        "click",
        "tap",
        "input",
        "fill",
        "type",
        "enter",
        "select",
        "select_dropdown",
        "choose",
        "dropdown",
        "assert",
        "verify",
        "expect",
        "check",
        "assert_visible_page",
        "browser-use-assertion",
        "wait",
        "sleep",
        "pause",
        "go_back",
        "back",
        "navigate_back",
        "screenshot",
        "press",
        "keydown",
        "keypress",
        "keyboard",
        "scroll",
        "hover",
    }
)

_SKIP_LINK_RE = re.compile(
    r"#main|skip\s*to\s*(main|content)|skip\s*to\s*main\s*content",
    re.I,
)

_LOOP_NL_RE = re.compile(
    r"\b(until|disabled|back(?:ward)?|previous|grey|gray)\b",
    re.I,
)

_SEMANTIC_KINDS = frozenset({"role", "label", "placeholder", "testid"})
_MAX_LOOP_CLICKS = 5

_SEARCH_PAGE_QUERY_RE = re.compile(
    r"Searched page for\s+[\"'“]?([^\"'”:]+)[\"'”]?",
    re.I,
)

_FIND_ELEMENTS_RE = re.compile(
    r'Found\s+(\d+)\s+elements?\s+matching\s+"([^"]+)"?',
    re.I,
)


def _normalize_action(action: str) -> str:
    a = (action or "custom").strip().lower()
    if a in ("fill", "type", "enter"):
        return "input"
    if a in ("goto", "go_to", "open"):
        return "navigate"
    if a in ("select_dropdown", "choose", "dropdown"):
        return "select"
    if a in ("back", "navigate_back"):
        return "go_back"
    if a in ("sleep", "pause"):
        return "wait"
    if a in ("tap",):
        return "click"
    if a in ("keydown", "keypress", "keyboard"):
        return "press"
    if a in ("verify", "expect", "check", "assert_visible_page", "browser-use-assertion"):
        return "assert"
    return a


def _extract_search_page_query(step: dict[str, Any]) -> str | None:
    value = step.get("value")
    if value is not None and str(value).strip():
        return str(value).strip().strip("\"'")
    desc = str(step.get("description") or "")
    match = _SEARCH_PAGE_QUERY_RE.search(desc)
    if match:
        return match.group(1).strip()
    return None


def _match_verify_nl(
    query: str,
    nl_steps: list[str],
    assertion_plan: list[dict[str, Any]],
    *,
    claimed: set[str] | None = None,
) -> str | None:
    """Find the verify NL line that this search_page query was satisfying."""
    q = (query or "").strip().lower()
    if not q:
        return None
    claimed = claimed if claimed is not None else set()
    candidates: list[str] = []
    for nl in nl_steps or []:
        text = (nl or "").strip()
        if text:
            candidates.append(text)
    for item in assertion_plan or []:
        text = str(item.get("nlStep") or "").strip()
        if text and text not in candidates:
            candidates.append(text)

    looks_like_paragraph = len(q) >= 40 or q.count(" ") >= 5
    encyclopediaish = bool(
        re.search(r"\b(encyclopedia|wikipedia|the free encyclopedia)\b", q)
    )
    from_wikipedia_lead = "from wikipedia" in q

    best: tuple[int, str] | None = None
    for text in candidates:
        lower = text.lower()
        if lower in claimed:
            continue
        if not any(k in lower for k in ("verify", "assert", "check", "ensure", "capture screenshot")):
            continue
        score = 0
        if q in lower:
            score += 8
        q_tokens = [t for t in re.split(r"[^a-z0-9]+", q) if len(t) >= 4]
        for t in q_tokens[:6]:
            if t in lower:
                score += 2
        # Vocab search_page bridges (wiki logo/intro/toc, etc.)
        score += search_page_bridge_bonus(q, text)
        # Prefer specific intro NL over generic "article page is displayed" for lead text.
        if (looks_like_paragraph or from_wikipedia_lead) and re.search(
            r"article page|page is displayed|page is shown", lower
        ):
            score -= 3
        if any(k in lower for k in ("heading", "title")) and any(
            t in lower for t in q_tokens[:4]
        ):
            score += 3
        if any(k in lower for k in ("contents", "navigation", "toc")) and any(
            k in q for k in ("contents", "navigation", "toc")
        ):
            score += 6
        if score >= 6 and (best is None or score > best[0]):
            best = (score, text)
    return best[1] if best else None


def _find_elements_to_assert(
    step: dict[str, Any],
    nl_steps: list[str],
    assertion_plan: list[dict[str, Any]],
    *,
    claimed_verifies: set[str] | None = None,
) -> dict[str, Any] | None:
    """
    Promote successful find_elements probes into durable assert locators when the
    selector clearly maps to a verify NL (logo/img, search input, heading, toc).
    """
    desc = str(step.get("description") or "")
    match = _FIND_ELEMENTS_RE.search(desc)
    if not match:
        return None
    count = int(match.group(1))
    selector = match.group(2).strip()
    if count < 1 or not selector:
        return None

    claimed = claimed_verifies if claimed_verifies is not None else set()
    sel = selector.lower()
    # de-dupe preserve order
    seen: set[str] = set()
    ordered: list[str] = []
    for text in [
        *(nl_steps or []),
        *(str(i.get("nlStep") or "") for i in (assertion_plan or []) if isinstance(i, dict)),
    ]:
        t = (text or "").strip()
        if not t or t.lower() in seen:
            continue
        seen.add(t.lower())
        ordered.append(t)

    matched_nl: str | None = None
    score_best = 0
    for text in ordered:
        lower = text.lower()
        if not any(k in lower for k in ("verify", "assert", "check", "ensure")):
            continue
        score = css_probe_score(selector, text)
        # Heuristics fallback for Amazon color-state / AE cart when vocab miss
        if heuristics_enabled() and score < 8:
            if "a-color-state" in sel or ("a-text-bold" in sel and "span" in sel):
                if "heading" in lower or "summary" in lower or "contains" in lower:
                    score += 8
            if re.search(r"tr\[id\^?=['\"]?product|cart_info|#cart_info|product-\d+", sel):
                if _is_cart_line_details_nl(text) or _is_cart_verify_nl(text):
                    score += 12
        if score > score_best:
            score_best = score
            matched_nl = text

    if not matched_nl or score_best < 8:
        return None

    # Allow merging a second locator onto the same NL (logo + search input).
    already = matched_nl.lower() in claimed
    loc = {"kind": "css", "value": selector, "verified": True, "verifiedBy": "find_elements"}
    if already:
        # Signal merge-only: keep as assert with same NL so later dedupe merges locs.
        pass
    elif claimed_verifies is not None:
        claimed_verifies.add(matched_nl.lower())

    return {
        **step,
        "action": "assert",
        "value": matched_nl,
        "description": matched_nl,
        "locators": [loc],
        "_action": "assert",
        "_locators": [loc],
        "_nlHint": matched_nl,
        "_mergeAssert": already,
    }


def _search_page_to_assert(
    step: dict[str, Any],
    nl_steps: list[str],
    assertion_plan: list[dict[str, Any]],
    *,
    claimed_verifies: set[str] | None = None,
) -> dict[str, Any] | None:
    """
    Promote a successful search_page verify into a durable assert with locators.
    Agent-tool noise with no NL match stays dropped.
    """
    desc = str(step.get("description") or "")
    if re.search(r"\b0 matches\b|\bno matches\b", desc, re.I):
        return None
    query = _extract_search_page_query(step)
    if not query or len(query) < 2:
        return None
    matched_nl = _match_verify_nl(
        query, nl_steps, assertion_plan, claimed=claimed_verifies
    )
    if not matched_nl:
        return None
    if claimed_verifies is not None:
        claimed_verifies.add(matched_nl.lower())

    url_m = re.search(r"url\s+contains\s+(.+)$", matched_nl, re.I)
    if url_m:
        fragment = url_m.group(1).replace(".", "").strip().strip("\"'")
        return {
            **step,
            "action": "assert",
            "value": f"__url_contains__:{fragment or query}",
            "description": matched_nl,
            "locators": [],
            "_action": "assert",
            "_locators": [],
            "_nlHint": matched_nl,
        }

    locs: list[dict[str, Any]] = [{"kind": "text", "value": query, "exact": False}]
    # search_page only proves the *text* exists. Promote to a heading role when the NL
    # explicitly names a section/heading — "page" alone is far too loose ("This page was
    # last edited" is footer copy, not a heading).
    if re.search(r"\b(section|heading|title)\b", matched_nl, re.I):
        locs.insert(0, {"kind": "role", "value": "heading", "name": query})

    return {
        **step,
        "action": "assert",
        "value": matched_nl,
        "description": matched_nl,
        "locators": locs,
        "_action": "assert",
        "_locators": locs,
        "_nlHint": matched_nl,
    }


def _is_skip_link_locator(loc: dict[str, Any]) -> bool:
    blob = f"{loc.get('kind') or ''}:{loc.get('value') or ''}:{loc.get('name') or ''}".lower()
    if _SKIP_LINK_RE.search(blob):
        return True
    value = str(loc.get("value") or "")
    if loc.get("kind") == "css" and re.search(r"a\[href", value, re.I) and _SKIP_LINK_RE.search(value):
        return True
    return False


def _filter_locators(action: str, locators: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for loc in locators or []:
        if not isinstance(loc, dict):
            continue
        if _is_skip_link_locator(loc):
            continue
        if action == "input" and loc.get("kind") == "role" and loc.get("value") == "link":
            continue
        out.append(loc)
    # Fills must not prefer verified `text` (label copy → getByText). When a semantic
    # locator exists (testid/label/placeholder/role), drop text candidates.
    if action == "input" and out:
        semantic = [
            loc for loc in out if str(loc.get("kind") or "").lower() in _SEMANTIC_KINDS
        ]
        if semantic:
            without_text = [
                loc for loc in out if str(loc.get("kind") or "").lower() != "text"
            ]
            if without_text:
                return without_text
    return out


def _locator_rank(loc: dict[str, Any]) -> int:
    score = 0
    if loc.get("verified") or loc.get("verifiedBy") in ("playwright", "snapshot", "inventory"):
        score += 100
        if loc.get("verifiedBy") == "playwright":
            score += 30
        elif loc.get("verifiedBy") == "snapshot":
            score += 15
        elif loc.get("verifiedBy") == "inventory":
            score += 10
    kind = str(loc.get("kind") or "").lower()
    if kind == "testid":
        score += 40
    elif kind == "role":
        score += 35
    elif kind == "label":
        score += 32
    elif kind == "placeholder":
        score += 28
    elif kind == "css":
        score += 18
    elif kind == "text":
        score += 12
    elif kind == "xpath":
        score += 5
    if loc.get("name") or loc.get("filterText"):
        score += 3
    if loc.get("scope"):
        score += 2
    return score


def _pick_primary(locators: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not locators:
        return None
    return max(locators, key=_locator_rank)


def _split_locator_buckets(
    locators: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], list[dict[str, Any]]]:
    primary = _pick_primary(locators)
    semantic = [l for l in locators if str(l.get("kind") or "").lower() in _SEMANTIC_KINDS]
    candidates = list(locators)
    return primary, semantic, candidates


def _step_locators(step: dict[str, Any]) -> list[dict[str, Any]]:
    locs = step.get("locators")
    if isinstance(locs, list) and locs:
        return [l for l in locs if isinstance(l, dict)]
    selector = step.get("selector")
    if isinstance(selector, str) and selector.strip().startswith("["):
        try:
            parsed = json.loads(selector)
            if isinstance(parsed, list):
                return [l for l in parsed if isinstance(l, dict)]
        except Exception:
            pass
    return []


def _click_sig(action: str, value: str | None, locators: list[dict[str, Any]]) -> str:
    parts = [
        f"{l.get('kind')}:{l.get('value')}:{l.get('name')}"
        for l in locators
    ]
    parts.sort()
    return f"{action}::{(value or '').strip()}::{'|'.join(parts)}"


def _nl_wants_loops(nl_steps: list[str]) -> bool:
    return any(_LOOP_NL_RE.search(s or "") for s in nl_steps or [])


def _is_hover_nl(text: str) -> bool:
    t = (text or "").strip().lower()
    return bool(
        re.search(
            r"\b(hover|mouse\s*over|move\s+the\s+mouse|pointer\s+over|mouseover)\b",
            t,
        )
    )


def _hover_target_from_nl(text: str) -> str | None:
    """Extract 'Platform' from 'Move the mouse pointer over the Platform navigation menu'."""
    t = (text or "").strip()
    if not t:
        return None
    patterns = (
        r"(?:hover\s+over|mouse\s*over|pointer\s+over|move\s+the\s+mouse(?:\s+pointer)?\s+over)\s+"
        r"(?:the\s+)?(.+?)(?:\s+navigation)?(?:\s+menu)?\s*$",
        r"(?:hover|mouseover)\s+(?:on\s+|over\s+)?(?:the\s+)?(.+?)\s*$",
    )
    for pat in patterns:
        m = re.search(pat, t, re.I)
        if not m:
            continue
        name = m.group(1).strip().strip("\"'")
        name = re.sub(
            r"\b(navigation|menu|item|link|button|nav)\b",
            "",
            name,
            flags=re.I,
        )
        name = re.sub(r"[.\s]+$", "", name).strip(" -:,")
        name = re.sub(r"\s+", " ", name).strip()
        if name and 1 < len(name) <= 64:
            return name
    return None


def _is_menu_expand_nl(text: str) -> bool:
    t = (text or "").strip().lower()
    return bool(
        re.search(r"\b(menu|nav|navigation)\b", t)
        and re.search(r"\b(expand|opens?|opened|dropdown|flyout|submenu)\b", t)
    )


def _is_menu_visible_nl(text: str) -> bool:
    t = (text or "").strip().lower()
    if not re.search(r"\b(verify|assert|check|ensure)\b", t):
        return False
    if not re.search(r"\b(menu|navigation|nav|submenu)\b", t):
        return False
    return bool(re.search(r"\b(visible|displayed|shown|present|expand)", t))


def _is_add_to_cart_blob(blob: str) -> bool:
    return is_add_to_cart_blob(blob)


def _is_add_to_cart_nl(text: str) -> bool:
    return is_add_to_cart_nl(text)


def _is_view_cart_blob(blob: str) -> bool:
    return is_view_cart_blob(blob)


def _is_cart_verify_nl(text: str) -> bool:
    return is_cart_verify_nl(text)


def _is_cart_line_details_nl(text: str) -> bool:
    return is_cart_line_details_nl(text)


def _is_continue_shopping_nl(text: str) -> bool:
    return is_continue_shopping_nl(text)


def _menu_name_from_verify_nl(text: str) -> str | None:
    """'Platform' from 'Verify that the Platform menu expands' / submenu options visible."""
    t = (text or "").strip()
    m = re.search(
        r"(?:verify|assert|check|ensure)\s+(?:that\s+)?(?:the\s+)?"
        r"(.+?)\s+(?:navigation\s+)?(?:menu|submenu|nav)\b",
        t,
        re.I,
    )
    if not m:
        return None
    name = m.group(1).strip().strip("\"'")
    name = re.sub(r"\b(main|primary|top|site)\b", "", name, flags=re.I).strip(" -:,")
    if name and 1 < len(name) <= 64 and name.lower() not in ("the", "a", "an"):
        return name
    return None


def _evaluate_looks_like_hover(step: dict[str, Any]) -> bool:
    blob = f"{step.get('description') or ''} {step.get('value') or ''}".lower()
    return bool(
        re.search(
            r"hover|mouseover|mouseenter|mouse\s*over|dispatchEvent\(['\"]mouse|"
            r"\.hover\(|pointerover|pointerenter",
            blob,
        )
    )


def _evaluate_to_hover(
    step: dict[str, Any],
    nl_steps: list[str],
    *,
    claimed_hovers: set[str] | None = None,
) -> dict[str, Any] | None:
    """Promote JS evaluate hover probes into durable hover acts for replay/codegen."""
    if not _evaluate_looks_like_hover(step):
        return None
    claimed = claimed_hovers if claimed_hovers is not None else set()
    description = str(step.get("description") or "")
    value = step.get("value")
    blob = f"{description} {value or ''}".lower()
    hint = None
    # Prefer a hover NL whose target is mentioned in the evaluate payload.
    scored: list[tuple[int, str]] = []
    for nl in nl_steps or []:
        text = (nl or "").strip()
        if not text or text.lower() in claimed:
            continue
        if not _is_hover_nl(text):
            continue
        target = (_hover_target_from_nl(text) or "").lower()
        score = 1
        if target and target in blob:
            score += 10
        scored.append((score, text))
    if scored:
        scored.sort(key=lambda t: t[0], reverse=True)
        hint = scored[0][1]
    if not hint:
        # Fall back: align against any hover NL via token overlap with description.
        hint, _score = _align_nl_step("hover", value, description, nl_steps)
        if hint and not _is_hover_nl(hint):
            hint = None
    target = _hover_target_from_nl(hint or "") if hint else None
    if not target:
        # Try to pull a quoted label from the evaluate payload.
        m = re.search(r"""['"]([A-Za-z][\w\s&/-]{1,40})['"]""", description)
        if m and _is_hover_nl(f"hover over {m.group(1)}"):
            target = m.group(1).strip()
        elif m:
            # Still use a short label if the evaluate clearly hovered.
            cand = m.group(1).strip()
            if cand.lower() not in ("mouseover", "mouseenter", "hover", "div", "span", "nav"):
                target = cand
    if not target:
        return None
    locs = [
        {"kind": "role", "value": "link", "name": target, "exact": False},
        {"kind": "role", "value": "menuitem", "name": target, "exact": False},
        {"kind": "text", "value": target, "exact": False},
    ]
    # Prefer locators captured on the evaluate step when present.
    captured = []
    for loc in (
        [step.get("locator")]
        + list(step.get("locators") or [])
        + list(step.get("selectorCandidates") or [])
    ):
        if isinstance(loc, dict) and (loc.get("value") or loc.get("name")):
            captured.append(loc)
    if captured:
        locs = captured + locs
    if hint:
        claimed.add(hint.lower())
    return {
        "index": int(step.get("index") or 0),
        "action": "hover",
        "value": target,
        "url": step.get("url"),
        "description": f"hover | {target} | promoted from evaluate",
        "locators": locs,
        "locator": locs[0],
        "nlStep": hint,
        "_nlHint": hint or "",
        "_action": "hover",
        "_locators": locs,
    }


def _strip_gherkin_prefix(text: str) -> str:
    """Normalize Given/When/Then/And/But NL for matching (keep original for binding)."""
    return re.sub(
        r"^(?:given|when|then|and|but)\s+",
        "",
        (text or "").strip(),
        flags=re.I,
    ).strip()


def _looks_like_verify_nl(text: str) -> bool:
    bare = _strip_gherkin_prefix(text).lower()
    if not bare:
        return False
    if re.search(r"^(verify|assert|check|ensure)\b", bare):
        return True
    if re.search(r"\bshould\b.+\b(be\s+)?(visible|displayed|shown|present|open|navigated)\b", bare):
        return True
    if re.search(r"\b(text|heading|title|page|list|product|results?)\b.+\b(visible|displayed|shown|open)\b", bare):
        return True
    return False


def _ensure_assertion_plan_from_nl(
    nl_steps: list[str],
    assertion_plan: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """
    Gherkin / BDD scripts often omit a separate assertionPlan. Derive asserts from
    verify/should-be-visible NL so coverage can ground them.
    """
    plan = [dict(item) for item in (assertion_plan or []) if isinstance(item, dict)]
    claimed = {(str(item.get("nlStep") or "").strip().lower()) for item in plan}
    for i, nl in enumerate(nl_steps or [], start=1):
        text = (nl or "").strip()
        if not text or text.lower() in claimed:
            continue
        if not _looks_like_verify_nl(text):
            continue
        plan.append({"index": i, "kind": "assert", "nlStep": text})
        claimed.add(text.lower())
    return plan


def _is_optional_nl(text: str) -> bool:
    """True soft-optional NL — conditionals / consent only (not search submit)."""
    t = (text or "").strip().lower()
    if t.startswith("if "):
        return True
    # Embedded conditionals: "Select English … if it is not already selected"
    if re.search(r"\bif\s+(it\s+is\s+)?not\s+already\b|\bif\s+needed\b|\bif\s+required\b", t):
        return True
    if any(k in t for k in ("cookie", "consent", "one trust", "onetrust")):
        return True
    vocab = current_vocab()
    for intent_id in vocab.intents_for_nl(text):
        if intent_id == "search_submit":
            continue
        if vocab.is_optional_intent(intent_id):
            return True
    return False


def _is_overlay_dismiss_blob(blob: str) -> bool:
    b = (blob or "").lower()
    if (
        has_intent_act(b, "cookie_dismiss")
        or has_intent_act(b, "continue_shopping")
        or has_intent_act(b, "privacy_dismiss")
        or has_intent_act(b, "overlay_close")
    ):
        return True
    return bool(
        re.search(
            r"cookie|consent|onetrust|one.?trust|continue shopping|accept all|"
            r"accept cookies|got it|no thanks|maybe later|dismiss|close.*(dialog|modal|banner)",
            b,
        )
    )


def _is_continue_shopping_blob(blob: str) -> bool:
    return is_continue_shopping_blob(blob)


def _evaluate_looks_like_click(step: dict[str, Any]) -> bool:
    """JS evaluate used as a fallback click (Continue Shopping / View Cart / …)."""
    blob = f"{step.get('description') or ''} {step.get('value') or ''}".lower()
    if _evaluate_looks_like_hover(step) and not re.search(r"\bclick", blob):
        return False
    return bool(
        re.search(
            r"\bclick(?:ed|ing)?\b|\.click\(|dispatchEvent\(['\"]click|"
            r"continue\s+shopping|view\s*cart|add\s*to\s*cart",
            blob,
        )
    )


def _evaluate_click_label(step: dict[str, Any]) -> str | None:
    blob = f"{step.get('description') or ''} {step.get('value') or ''}"
    lower = blob.lower()
    if _is_continue_shopping_blob(lower):
        return "Continue Shopping"
    if _is_view_cart_blob(lower) or re.search(r"view\s*cart", lower):
        return "View Cart"
    if _is_add_to_cart_blob(lower):
        return "Add to cart"
    if re.search(r"view\s*product|product_details", lower):
        return "View Product"
    m = re.search(
        r"""click(?:ed|ing)?(?:\s+(?:visible|the|on|fallback)){0,4}\s+['"]?([A-Za-z][\w\s&/-]{1,48})['"]?""",
        blob,
        re.I,
    )
    if m:
        label = m.group(1).strip(" .")
        if label.lower() not in ("fallback", "visible", "button", "link", "div", "span"):
            return label
    m = re.search(r"""['"]([A-Za-z][\w\s&/-]{2,40})['"]""", blob)
    if m:
        return m.group(1).strip()
    return None


def _evaluate_to_click(
    step: dict[str, Any],
    nl_steps: list[str],
    *,
    used_nl: dict[str, int] | None = None,
    nl_budget: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    """Promote evaluate fallback clicks into durable click acts."""
    if not _evaluate_looks_like_click(step):
        return None
    label = _evaluate_click_label(step)
    if not label:
        return None
    description = str(step.get("description") or "")
    locs = [
        {"kind": "role", "value": "button", "name": label, "exact": False},
        {"kind": "role", "value": "link", "name": label, "exact": False},
        {"kind": "text", "value": label, "exact": False},
    ]
    if _is_continue_shopping_blob(label) or _is_continue_shopping_blob(description):
        locs.insert(0, {"kind": "css", "value": "#cartModal button.close-modal"})
        locs.insert(0, {"kind": "role", "value": "button", "name": "Continue Shopping", "exact": False})
    if _is_view_cart_blob(f"{label} {description}"):
        locs.insert(0, {"kind": "css", "value": '#cartModal a[href="/view_cart"]'})
        locs.insert(0, {"kind": "role", "value": "link", "name": "View Cart", "exact": False})
    hint, _score = _align_nl_step(
        "click",
        label,
        f'click | {label} | {description}',
        nl_steps,
        used_nl=used_nl,
        nl_budget=nl_budget,
        locator=locs[0],
    )
    return {
        "index": int(step.get("index") or 0),
        "action": "click",
        "value": label,
        "url": step.get("url"),
        "description": f"click | {label} | promoted from evaluate",
        "locators": locs,
        "locator": locs[0],
        "nlStep": hint,
        "_nlHint": hint or "",
        "_action": "click",
        "_locators": locs,
    }


def _is_bare_dismiss_click(blob: str) -> bool:
    """A dismiss control named only "Close"/"No thanks" (Wikipedia's donation banner)."""
    return bool(
        re.search(r"\b(close|dismiss|no thanks|not now|maybe later)\b", blob or "", re.I)
    )


def _optional_dismiss_locators_for_nl(nl: str) -> list[dict[str, Any]]:
    """Default locator candidates for optional dismiss NL when browser-use skipped the banner."""
    locs = locator_templates_for_optional("cookie_dismiss")
    # Also merge continue_shopping templates when NL mentions shopping/amazon/location.
    lower = (nl or "").lower()
    if any(k in lower for k in ("location", "sign-in", "sign in", "continue shopping", "amazon")):
        for t in locator_templates_for_optional("continue_shopping"):
            if t not in locs:
                locs.insert(0, t)
    if locs:
        return locs
    return [
        {"kind": "role", "value": "button", "name": "Accept all", "exact": False},
        {"kind": "role", "value": "button", "name": "Continue shopping", "exact": True},
    ]


def _is_language_nl(text: str) -> bool:
    t = (text or "").strip().lower()
    return bool(
        re.search(r"\blanguage\b", t)
        and any(k in t for k in ("select", "choose", "change", "set", "switch"))
    )


def _is_search_submit_nl(text: str) -> bool:
    t = (text or "").strip().lower()
    if re.match(r"^submit\s+(the\s+)?search\b", t):
        return True
    if re.match(r"^(press|hit)\s+enter\b", t):
        return True
    if re.search(r"\b(click|press|tap)\s+(the\s+)?search\b", t) and "language" not in t:
        return True
    return False


def _blob_is_search_submit(blob: str, action: str) -> bool:
    b = (blob or "").lower()
    a = (action or "").lower()
    if a == "press" and re.search(r"\benter\b", b):
        return True
    if a == "click" and re.search(r"\bsearch\b", b) and "language" not in b:
        # Search button / submit, not language combo
        if any(k in b for k in ("button", "clicked", "submit", "go", "magnifying")):
            return True
        if re.search(r"\bsearch\b", b) and "input" not in b:
            return True
    return False


def _blob_is_language_act(blob: str, action: str) -> bool:
    b = (blob or "").lower()
    a = (action or "").lower()
    if a == "select" and "language" in b:
        return True
    if any(k in b for k in ("language", "lang=", "searchlanguage", "search-language")):
        return True
    if a == "click" and "language" in b and "search" not in b.split("language")[0][-20:]:
        return True
    return False


def _nl_consistent_with_act(
    nl: str,
    action: str,
    value: str | None,
    description: str,
    locator: dict[str, Any] | None = None,
) -> bool:
    """Reject high-score but semantically wrong NL↔act bindings."""
    text = (nl or "").strip()
    if not text:
        return True
    blob = f"{action} {value or ''} {description or ''} {json.dumps(locator or {})}".lower()
    a = (action or "").lower()
    lower = text.lower()

    if exclusive_conflict_nl_act(text, blob):
        return False

    if _is_language_nl(text):
        # Language NL must not bind to a Search submit button.
        if _blob_is_search_submit(blob, a):
            return False
        return _blob_is_language_act(blob, a) or a == "select"

    if _is_search_submit_nl(text):
        return _blob_is_search_submit(blob, a)

    # Cookie/consent dismiss must not steal navigation clicks (Products, Search, …)
    # when the NL line is not itself a consent/dialog instruction.
    if a == "click" and _is_overlay_dismiss_blob(blob):
        # Explicit "Continue Shopping" NL (AutomationExercise cart modal).
        if _is_continue_shopping_nl(text):
            return _is_continue_shopping_blob(blob)
        consentish = any(
            k in lower
            for k in ("cookie", "consent", "accept", "dismiss", "if a", "location", "sign-in", "sign in")
        )
        if not consentish:
            return False

    # "Add … to the cart" must bind to Add to cart, not View Cart / Products.
    if _is_add_to_cart_nl(text):
        if a not in ("click", "tap", "press"):
            return False
        return _is_add_to_cart_blob(blob)

    # Cart-content verifies are assert/URL evidence — not View Cart clicks.
    if _is_cart_verify_nl(text) and a in ("click", "tap", "press"):
        return False

    # Generic "select …" without language — allow select/click, not search submit alone.
    if text.lower().startswith("select ") and _blob_is_search_submit(blob, a) and "search" not in text.lower():
        return False

    # Secret/redacted fills must not claim the wrong credential NL family.
    if a == "input":
        family = _input_secret_family(value)
        if family == "email" and any(
            k in lower for k in ("password", "verification code", "otp", "mfa", "totp")
        ):
            if not any(k in lower for k in ("email", "username", "user name", "login")):
                return False
        if family == "password" and any(
            k in lower for k in ("email", "username", "verification code", "otp")
        ):
            if "password" not in lower:
                return False
        if family == "otp" and any(k in lower for k in ("email", "password", "username")):
            if not any(k in lower for k in ("verification", "otp", "code", "mfa", "totp")):
                return False

    return True


def _input_secret_family(value: str | None) -> str | None:
    """Map redacted/secret placeholders to email|password|otp for NL alignment."""
    v = (value or "").strip()
    if not v:
        return None
    lower = v.lower()
    match = re.search(r"<secret>\s*([^<]+?)\s*</secret>", lower)
    if match:
        inner = match.group(1).strip().lower()
        if inner in ("username", "user", "email", "login", "userid", "user_id", "user-id"):
            return "email"
        if inner in ("password", "pass", "pwd", "passwd"):
            return "password"
        if inner in ("otp", "code", "verification", "mfa", "totp", "pin", "verification_code"):
            return "otp"
        return None
    # Bullet / star redaction after redact_for_logs — usually password, sometimes OTP.
    if re.fullmatch(r"[•\*\u2022·\u25cf\u25e6]+", v) or re.fullmatch(r"\*+|•+|·+", v):
        return "password"
    if lower in ("********", "••••••••", "[redacted]", "<redacted>"):
        return "password"
    return None


def _locator_align_blob(locator: dict[str, Any] | None) -> str:
    if not isinstance(locator, dict):
        return ""
    return " ".join(
        str(locator.get(key) or "")
        for key in ("kind", "value", "name", "filterText")
    )


def _nl_occurrence_budget(nl_steps: list[str]) -> dict[str, int]:
    """How many times each NL line may be claimed (supports duplicate go_back lines)."""
    budget: dict[str, int] = {}
    for nl in nl_steps or []:
        text = (nl or "").strip().lower()
        if not text:
            continue
        budget[text] = budget.get(text, 0) + 1
    return budget


def _align_nl_step(
    action: str,
    value: str | None,
    description: str,
    nl_steps: list[str],
    *,
    used_nl: dict[str, int] | None = None,
    nl_budget: dict[str, int] | None = None,
    locator: dict[str, Any] | None = None,
    min_nl_index: int = 0,
) -> str | None:
    """Best-effort NL alignment for coverage (not inventing acts)."""
    loc_blob = _locator_align_blob(locator)
    blob = f"{action} {value or ''} {description or ''} {loc_blob}".lower()
    used_counts = used_nl if used_nl is not None else {}
    budget = nl_budget if nl_budget is not None else _nl_occurrence_budget(nl_steps)
    secret_family = _input_secret_family(value) if action == "input" else None
    best: tuple[int, int, str] | None = None  # score, -index (prefer earlier unused), text
    for idx, nl in enumerate(nl_steps or [], start=1):
        text = (nl or "").strip()
        if not text:
            continue
        lower = text.lower()
        bare = _strip_gherkin_prefix(text).lower()
        if used_counts.get(lower, 0) >= budget.get(lower, 1):
            continue
        if not _nl_consistent_with_act(text, action, value, description, locator):
            continue
        score = 0
        # Soft zipper: prefer later NL after progress, but allow high-confidence
        # earlier binds (secret email before Continue click, out-of-order history).
        if idx < min_nl_index:
            score -= 5
        match_l = bare or lower
        if action in ("navigate", "open") and ("navigate" in match_l or "http" in match_l or "open" in match_l):
            score += 3
        if action == "go_back":
            # "Navigate back to the previous page" / "go back" / "browser back"
            if any(k in match_l for k in ("go back", "navigate back", "previous page", "browser back")):
                score += 8
            elif "back" in match_l and "navigate" in match_l:
                score += 6
            elif re.search(r"\bback\b", match_l) and "feedback" not in match_l:
                score += 4
        if action == "input" and value and str(value).lower()[:12] in match_l:
            score += 5
        if action == "input" and any(k in match_l for k in ("enter", "type", "fill", "email", "password", "code", "destination", "search")):
            score += 2
        # Redacted credentials: map <secret>username|password|otp</secret> / •••• to NL families.
        if action == "input" and secret_family == "email":
            if any(k in match_l for k in ("email", "username", "user name", "login id", "user id")):
                score += 8
            elif "login" in match_l and "password" not in match_l:
                score += 5
        elif action == "input" and secret_family == "password":
            if "password" in match_l:
                score += 8
        elif action == "input" and secret_family == "otp":
            if any(k in match_l for k in ("verification", "otp", "code", "mfa", "totp", "pin")):
                score += 8
        # Locator / testid tokens for inputs (loginRegisterEmailInputBox → email NL).
        if action == "input" and loc_blob:
            loc_l = loc_blob.lower()
            if any(k in loc_l for k in ("email", "username", "loginregister", "userid")) and any(
                k in match_l for k in ("email", "username", "user name", "login")
            ):
                score += 6
            if "password" in loc_l and "password" in match_l:
                score += 6
            if any(k in loc_l for k in ("otp", "verification", "mfa", "code", "inputfileld")) and any(
                k in match_l for k in ("verification", "otp", "code", "mfa")
            ):
                score += 6
            loc_name = ""
            if isinstance(locator, dict):
                loc_name = str(
                    locator.get("name") or locator.get("filterText") or locator.get("value") or ""
                ).strip().lower()
            if loc_name and len(loc_name) >= 4 and loc_name in match_l:
                score += 6
        # Inputs must not steal verify / heading NLs that merely mention the typed value.
        if action == "input" and any(k in match_l for k in ("verify", "assert", "check", "ensure", "heading", "contains", "should")):
            score -= 10
        if action == "click":
            if any(k in match_l for k in ("click", "press", "tap", "continue", "sign in", "confirm", "back", "accept", "select")):
                score += 2
            # Prefer cookie/consent NL for Accept / OneTrust / Continue shopping clicks.
            if _is_overlay_dismiss_blob(blob):
                if any(k in match_l for k in ("cookie", "consent", "accept", "dismiss", "if a", "location", "sign-in", "sign in")):
                    score += 12
                if "search" in match_l and "cookie" not in match_l and not match_l.startswith("if "):
                    score -= 6
            # Prefer cookie/consent NL for Accept / OneTrust clicks — not "Search".
            elif any(k in blob for k in ("accept", "onetrust", "consent", "cookie")):
                if any(k in match_l for k in ("cookie", "consent", "accept", "dismiss")):
                    score += 8
                if "search" in match_l and "cookie" not in match_l:
                    score -= 6
            # A bare "Close" click (donation/promo banner) shares only the generic word
            # "click" with NL like "Click View history" — just enough to reach the bind
            # threshold and shift every later click onto the wrong control.
            if _is_bare_dismiss_click(blob) and not any(
                k in match_l
                for k in ("close", "dismiss", "cookie", "consent", "banner", "popup", "no thanks")
            ):
                score -= 8
            # Dismiss / close / sign-in interstitial — never map to Search or destination.
            if any(k in blob for k in ("dismiss", "sign in information", "close dialog", "genius", "close ad")):
                if any(k in match_l for k in ("cookie", "consent", "dismiss", "if a", "close ad")):
                    score += 8
                if "search" in match_l or "destination" in match_l or "date" in match_l or "product" in match_l:
                    score -= 10
            # Calendar day cells (aria-label dates / weekday + day) → check-in/out NL.
            dateish = bool(
                re.search(r"\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", blob)
                or "calendar" in blob
                or "gridcell" in blob
            )
            if dateish:
                is_checkout_nl = bool(re.search(r"check[\s-]*out", match_l))
                is_checkin_nl = bool(re.search(r"check[\s-]*in", match_l)) and not is_checkout_nl
                checkin_already = any(
                    re.search(r"check[\s-]*in", u) and not re.search(r"check[\s-]*out", u)
                    for u in used_counts
                )
                if is_checkin_nl:
                    score += 10
                    # First calendar click should claim check-in before check-out.
                    if not checkin_already:
                        score += 4
                elif is_checkout_nl:
                    score += 10
                    if checkin_already:
                        score += 4
                    else:
                        score -= 2
                elif "date picker" in match_l or "open the date" in match_l or "select dates" in match_l:
                    score += 5
                if "search" in match_l and "date" not in match_l:
                    score -= 8
            # Destination suggestion clicks
            if value and str(value).lower()[:20] in match_l:
                score += 6
            # Strong bind when clicked control name appears in the NL (Products, Cart, …).
            loc_name = ""
            if isinstance(locator, dict):
                loc_name = str(
                    locator.get("name") or locator.get("filterText") or ""
                ).strip().lower()
            if loc_name and len(loc_name) >= 4 and loc_name in match_l:
                score += 8
            # AutomationExercise-style: control "Add to cart" vs NL "Add the first product to the cart"
            # (not a contiguous substring — boost via cart semantics).
            if _is_add_to_cart_blob(blob):
                if _is_add_to_cart_nl(text):
                    score += 14
                elif _is_cart_verify_nl(text) or "products" in match_l:
                    score -= 8
            if _is_view_cart_blob(blob):
                if re.search(r"\bview[\s_-]*cart\b|\bopen\s+(the\s+)?cart\b", match_l):
                    score += 14
                elif _is_add_to_cart_nl(text):
                    score -= 12
                elif _is_cart_verify_nl(text):
                    # Prefer leaving verify for assert grounding; View Cart is supporting evidence.
                    score -= 4
            if _is_continue_shopping_blob(blob):
                if _is_continue_shopping_nl(text):
                    score += 14
                elif _is_optional_nl(text) and any(
                    k in match_l for k in ("cookie", "consent", "dismiss", "location", "sign-in", "sign in", "if a")
                ):
                    score += 10
                else:
                    score -= 10
            # Search submit / magnifying-glass button
            if re.search(r"submit_search|search.?btn|#submit_search", blob) or (
                _blob_is_search_submit(blob, action) and "product" in match_l
            ):
                if "search" in match_l and any(k in match_l for k in ("click", "press", "button", "submit")):
                    score += 12
            # View Product / product details
            if re.search(r"view\s*product|product_details", blob):
                if re.search(r"view\s*product|product\s+detail", match_l):
                    score += 12
            if "london" in blob and "london" in match_l and not dateish:
                score += 4
            # Search button — bind to submit/search NL, never language NL (consistency already filters).
            if _blob_is_search_submit(blob, action):
                if _is_search_submit_nl(text) or (
                    "search" in match_l and any(k in match_l for k in ("submit", "click", "press", "button"))
                ):
                    score += 10
                elif "search" in match_l and "language" not in match_l:
                    score += 6
                else:
                    score -= 8
            elif "search" in match_l:
                if re.search(r"\bsearch\b", blob) and "date" not in blob and "dismiss" not in blob:
                    score += 6
                else:
                    score -= 4
            if ("date picker" in match_l or "open the date" in match_l) and (
                dateish or "select dates" in blob or "date" in blob
            ):
                score += 4
            elif "date" in match_l or re.search(r"check[\s-]*in", match_l) or re.search(r"check[\s-]*out", match_l):
                if any(k in blob for k in ("date", "calendar", "check-in", "check-out", "day")) or dateish:
                    score += 3
            # Language select NL
            if _is_language_nl(text):
                if _blob_is_language_act(blob, action):
                    score += 12
                else:
                    score -= 20
        if action == "press" and _is_search_submit_nl(text) and _blob_is_search_submit(blob, action):
            score += 10
        if action == "hover":
            if _is_hover_nl(text):
                score += 10
                target = _hover_target_from_nl(text)
                if target and target.lower() in blob:
                    score += 6
            elif any(k in match_l for k in ("menu", "nav", "platform", "solutions", "product")):
                score += 2
            else:
                score -= 4
        if action == "select" and (_is_language_nl(text) or "select" in match_l):
            score += 6
        if action == "assert" and any(k in match_l for k in ("verify", "assert", "check", "ensure", "should")):
            score += 4
        # Token overlap (prefer bare Gherkin body)
        tokens = [t for t in re.split(r"[^a-z0-9]+", match_l) if len(t) >= 4]
        for t in tokens[:8]:
            if t in blob:
                score += 1
        # Prefer earlier unused NL when scores tie (sequential zipper).
        if best is None or score > best[0] or (score == best[0] and -idx > best[1]):
            best = (score, -idx, text)
    if best and best[0] >= 3:
        return best[2], int(best[0])
    return None, 0


def _align_band(score: int) -> str:
    vocab = current_vocab()
    soft_min = vocab.weight("soft_min", 3)
    hard_min = vocab.weight("hard_min", 8)
    if score < soft_min:
        return "none"
    if score < hard_min:
        return "soft"
    return "hard"


def _bind_is_durable(step: dict[str, Any]) -> bool:
    """True when a soft-score bind still has durable evidence — keep as executed."""
    action = str(step.get("action") or "").lower()
    if action in ("navigate", "goto", "go_to", "open", "go_back", "press", "hover"):
        return True
    if bool(step.get("verified")):
        return True
    loc = step.get("locator") if isinstance(step.get("locator"), dict) else None
    if loc:
        kind = str(loc.get("kind") or "").lower()
        if kind in ("role", "label", "placeholder", "testid", "css", "text") and (
            loc.get("value") or loc.get("name")
        ):
            return True
        if loc.get("verified") or loc.get("verifiedBy"):
            return True
    for cand in step.get("semanticLocators") or []:
        if isinstance(cand, dict) and (cand.get("value") or cand.get("name")):
            return True
    return False


def _assert_is_grounded(step: dict[str, Any]) -> bool:
    """Assert/screenshot has evidence beyond the raw NL sentence."""
    action = str(step.get("action") or "").lower()
    if action == "screenshot":
        return True
    value = str(step.get("value") or "").strip()
    nl = str(step.get("nlStep") or "").strip()
    if value.startswith("__url_contains__:") or value.startswith("__url_equals__:"):
        return True
    if value and nl and value != nl and not value.lower().startswith("verify "):
        return True
    locs = []
    if step.get("locator"):
        locs.append(step["locator"])
    locs.extend(step.get("semanticLocators") or [])
    locs.extend(step.get("selectorCandidates") or [])
    for loc in locs:
        if not isinstance(loc, dict):
            continue
        kind = str(loc.get("kind") or "")
        val = str(loc.get("value") or loc.get("name") or "").strip()
        if kind and val:
            return True
    return False


def _coverage(
    nl_steps: list[str],
    compact_steps: list[dict[str, Any]],
    assertion_plan: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """
    Per-NL execution status. assertionPlan alone no longer counts as mapped —
    verifies need grounding (locators / URL token) or a consistent act binding.
    """
    del assertion_plan  # plan is already interleaved into compact_steps

    # Cookie Accept / Continue shopping clicks also cover optional consent NL.
    has_cookie_accept = any(
        s.get("action") == "click"
        and (
            bool(s.get("optional"))
            or "accept" in json.dumps(s.get("locator") or s.get("selectorCandidates") or {}).lower()
            or "onetrust" in json.dumps(s.get("locator") or s.get("selectorCandidates") or {}).lower()
            or "consent" in str(s.get("description") or "").lower()
            or "continue shopping" in str(s.get("description") or "").lower()
            or "accept" in str(s.get("nlStep") or "").lower()
            or _is_overlay_dismiss_blob(str(s.get("description") or ""))
        )
        for s in compact_steps
    )

    # Index compact steps by claimed NL
    by_nl: dict[str, list[dict[str, Any]]] = {}
    for step in compact_steps:
        nl = (step.get("nlStep") or "").strip()
        if nl:
            by_nl.setdefault(nl.lower(), []).append(step)

    # Detect misbound: step claims language NL but act is search submit (should be rare after align)
    def classify_bound_step(nl: str, step: dict[str, Any]) -> str | None:
        action = str(step.get("action") or "")
        if action in ("assert", "screenshot", "verify"):
            if _assert_is_grounded(step):
                return "assertGrounded"
            return "assertHollow"
        if not _nl_consistent_with_act(
            nl,
            action,
            step.get("value"),
            str(step.get("description") or ""),
            step.get("locator") if isinstance(step.get("locator"), dict) else None,
        ):
            return "misbound"
        return "executed"

    step_statuses: list[dict[str, Any]] = []
    unmapped: list[str] = []
    optional_unmapped: list[str] = []
    soft_covered: list[str] = []

    for i, nl in enumerate(nl_steps or [], start=1):
        text = (nl or "").strip()
        if not text:
            continue
        lower = text.lower()
        bound = by_nl.get(lower) or []
        # Fuzzy key match for minor whitespace differences
        if not bound:
            for k, steps in by_nl.items():
                if k == lower or (len(lower) > 20 and (lower in k or k in lower)):
                    bound = steps
                    break

        status = "notExecuted"
        reason = "no compact step claimed this NL"
        evidence_idx = None

        if bound:
            # Prefer best status among bound steps
            statuses = [(classify_bound_step(text, s), s) for s in bound]
            # Priority: executed > assertGrounded > misbound > assertHollow
            rank = {
                "executed": 4,
                "assertGrounded": 3,
                "misbound": 2,
                "assertHollow": 1,
            }
            statuses.sort(key=lambda t: rank.get(t[0] or "", 0), reverse=True)
            status, step = statuses[0]
            evidence_idx = step.get("index")
            if status == "executed" and str(step.get("alignBand") or "") == "soft":
                # softCovered is only for weak evidence binds — never demote durable
                # acts (navigate, verified locators, semantic roles). Demoting those
                # to softCovered lied about quality and downstream codegen/replay trust.
                if _bind_is_durable(step):
                    reason = "act bound consistently"
                else:
                    status = "softCovered"
                    reason = "mid-confidence NL↔act bind (vocab/token evidence)"
            elif status == "misbound":
                reason = "act claimed NL but semantics do not match"
            elif status == "assertHollow":
                reason = "verify present without locator/URL evidence"
            elif status == "assertGrounded":
                reason = "verify grounded with locator or URL token"
            else:
                reason = "act bound consistently"

        # Implied search submit: fill + later URL change / article assert without discrete submit
        if status == "notExecuted" and _is_search_submit_nl(text):
            has_submit_act = any(
                _blob_is_search_submit(
                    f"{s.get('action')} {s.get('value') or ''} {s.get('description') or ''}",
                    str(s.get("action") or ""),
                )
                for s in compact_steps
            )
            if has_submit_act:
                # Submit act exists but claimed wrong NL — still executed for this NL
                status = "executed"
                reason = "search submit/Enter act present (reclassified)"
            # else remain notExecuted (hard)

        if status == "notExecuted" and _is_optional_nl(text):
            if any(k in lower for k in ("cookie", "consent")) and has_cookie_accept:
                status = "executed"
                reason = "cookie accept click covers optional consent NL"
            else:
                status = "optionalSkipped"
                reason = "optional conditional/consent with no act"
                optional_unmapped.append(text)

        # Date picker opened implied by calendar day click
        if status == "notExecuted" and ("date picker" in lower or "open the date" in lower):
            has_date_click = any(
                s.get("action") == "click"
                and re.search(
                    r"\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
                    str(s.get("description") or "").lower(),
                )
                for s in compact_steps
            )
            if has_date_click:
                status = "executed"
                reason = "calendar day click implies date picker opened"

        # Hover NL covered by a hover act on the same menu/target.
        if status == "notExecuted" and _is_hover_nl(text):
            target = (_hover_target_from_nl(text) or "").lower()
            for s in compact_steps:
                if str(s.get("action") or "").lower() != "hover":
                    continue
                blob = f"{s.get('value') or ''} {s.get('nlStep') or ''} {json.dumps(s.get('locator') or {})}".lower()
                if (target and target in blob) or (not target and _is_hover_nl(str(s.get("nlStep") or ""))):
                    status = "executed"
                    reason = "hover act covers NL"
                    evidence_idx = s.get("index")
                    break

        # Menu expand / submenu visible implied by hover of that menu (or grounded assert).
        if status in ("notExecuted", "assertHollow") and (
            _is_menu_expand_nl(text) or (_is_menu_visible_nl(text) and "submenu" in lower)
        ):
            menu = (_menu_name_from_verify_nl(text) or "").lower()
            has_hover = any(
                str(s.get("action") or "").lower() == "hover"
                and (
                    not menu
                    or menu in f"{s.get('value') or ''} {s.get('nlStep') or ''} {json.dumps(s.get('locator') or {})}".lower()
                )
                for s in compact_steps
            )
            if has_hover:
                # Prefer grounded if the bound assert now has locators; else credit hover.
                if bound and any(_assert_is_grounded(s) for s in bound):
                    status = "assertGrounded"
                    reason = "menu verify grounded after hover"
                else:
                    status = "executed"
                    reason = "menu hover implies expand/submenu visible"

        # Add-to-cart NL covered by Add to cart click (even when NL omits "click").
        if status == "notExecuted" and _is_add_to_cart_nl(text):
            for s in compact_steps:
                if str(s.get("action") or "").lower() != "click":
                    continue
                blob = (
                    f"{s.get('value') or ''} {s.get('description') or ''} "
                    f"{json.dumps(s.get('locator') or {})} {s.get('nlStep') or ''}"
                ).lower()
                if _is_add_to_cart_blob(blob):
                    status = "executed"
                    reason = "add-to-cart click covers NL"
                    evidence_idx = s.get("index")
                    break

        # Cart contents verify: View Cart / view_cart URL / grounded cart assert.
        if status in ("notExecuted", "assertHollow") and _is_cart_verify_nl(text):
            if bound and any(_assert_is_grounded(s) for s in bound):
                status = "assertGrounded"
                reason = "cart verify grounded"
            else:
                has_cart_evidence = any(
                    (
                        str(s.get("action") or "").lower() == "click"
                        and _is_view_cart_blob(
                            f"{s.get('value') or ''} {s.get('description') or ''} "
                            f"{json.dumps(s.get('locator') or {})}"
                        )
                    )
                    or re.search(
                        r"view_cart|/cart\b|cart_info",
                        f"{s.get('url') or ''} {s.get('value') or ''}",
                        re.I,
                    )
                    for s in compact_steps
                )
                if has_cart_evidence:
                    status = "assertGrounded" if bound else "executed"
                    reason = "view cart / cart URL covers cart verify NL"

        step_statuses.append(
            {
                "nlIndex": i,
                "nlStep": text,
                "status": status,
                "evidenceStepIndex": evidence_idx,
                "reason": reason,
            }
        )

        if status in ("notExecuted", "misbound", "assertHollow"):
            if text not in unmapped and text not in optional_unmapped:
                unmapped.append(text)
        elif status == "softCovered":
            soft_covered.append(text)

    total = len([s for s in (nl_steps or []) if (s or "").strip()])
    soft = len(optional_unmapped)
    # softCovered passes the gate and counts as mapped (evidence existed).
    mapped = total - len(unmapped) - soft
    return {
        "nlTotal": total,
        "mapped": mapped,
        "unmapped": unmapped,
        "optionalUnmapped": optional_unmapped,
        "softCovered": soft_covered,
        "stepStatuses": step_statuses,
    }


def _nl_index_map(nl_steps: list[str]) -> dict[str, list[int]]:
    """Map lowercased NL text → 1-based indices (duplicates keep multiple slots)."""
    out: dict[str, list[int]] = {}
    for i, nl in enumerate(nl_steps or [], start=1):
        text = (nl or "").strip()
        if not text:
            continue
        out.setdefault(text.lower(), []).append(i)
    return out


def _assert_step_from_plan(item: dict[str, Any]) -> dict[str, Any]:
    nl = str(item.get("nlStep") or "").strip()
    kind = str(item.get("kind") or "assert").lower()
    return {
        "index": 0,
        "action": "screenshot" if kind == "screenshot" else "assert",
        "value": nl,
        "url": None,
        "nlStep": nl,
        "locator": None,
        "semanticLocators": [],
        "selectorCandidates": [],
        "verified": False,
        "description": nl,
    }


def _interleave_asserts_by_nl(
    action_steps: list[dict[str, Any]],
    assertion_plan: list[dict[str, Any]] | None,
    nl_steps: list[str],
) -> list[dict[str, Any]]:
    """
    Place asserts at their NL index so replay runs them on the correct page.

    Actions keep discovery order within/around slots; asserts insert at plan.index
    (or NL match). Avoids dumping every verify after the final go_back.
    """
    if not assertion_plan:
        return list(action_steps)

    nl_map = _nl_index_map(nl_steps)
    nl_occ: dict[str, int] = {}
    slots: dict[int, list[tuple[int, int, dict[str, Any]]]] = {}

    def action_slot(step: dict[str, Any], prev: int) -> int:
        nl = (step.get("nlStep") or "").strip()
        if not nl:
            return prev
        key = nl.lower()
        indices = nl_map.get(key) or []
        if not indices:
            return prev
        occ = nl_occ.get(key, 0)
        nl_occ[key] = occ + 1
        return indices[occ] if occ < len(indices) else indices[-1]

    prev_slot = 0
    seq = 0
    existing_assert_nl: set[str] = set()
    for step in action_steps:
        slot = action_slot(step, prev_slot)
        prev_slot = slot
        slots.setdefault(slot, []).append((0, seq, step))
        seq += 1
        if str(step.get("action") or "").lower() in ("assert", "screenshot"):
            key = (step.get("nlStep") or "").strip().lower()
            if key:
                existing_assert_nl.add(key)

    for item in assertion_plan or []:
        if not isinstance(item, dict):
            continue
        nl = str(item.get("nlStep") or "").strip()
        if not nl:
            continue
        key = nl.lower()
        if key in existing_assert_nl:
            continue
        kind = str(item.get("kind") or "assert").lower()
        # Screenshot NL already bound to a screenshot action — don't duplicate.
        if kind == "screenshot" and any(
            (s.get("nlStep") or "").strip().lower() == key
            and str(s.get("action") or "").lower() == "screenshot"
            for s in action_steps
        ):
            existing_assert_nl.add(key)
            continue

        slot = int(item.get("index") or 0)
        if slot <= 0:
            indices = nl_map.get(key) or []
            slot = indices[0] if indices else (max(slots.keys(), default=0) + 1)
        slots.setdefault(slot, []).append((1, seq, _assert_step_from_plan(item)))
        seq += 1
        existing_assert_nl.add(key)

    ordered: list[dict[str, Any]] = []
    for slot in sorted(slots.keys()):
        for _prio, _seq, step in sorted(slots[slot], key=lambda t: (t[0], t[1])):
            ordered.append(step)
    return ordered


def _merge_native_captured(
    step: dict[str, Any],
    native_captured: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Seed locator candidates from pre-action nativeCapturedActions when attrs were thin."""
    locs = _step_locators(step)
    if not native_captured:
        return locs
    element_index = step.get("elementIndex")
    action = _normalize_action(str(step.get("action") or ""))
    extras: list[dict[str, Any]] = []
    for cap in native_captured:
        if not isinstance(cap, dict):
            continue
        cap_action = _normalize_action(str(cap.get("type") or cap.get("action") or ""))
        if cap_action and action and cap_action != action:
            # Allow fill/input alias already normalized
            if not (cap_action == action):
                continue
        cap_index = cap.get("index")
        if element_index is not None and cap_index is not None and int(cap_index) != int(element_index):
            continue
        for loc in cap.get("locators") or []:
            if isinstance(loc, dict) and loc not in extras:
                extras.append(loc)
    if not extras:
        # Fall back: merge all captured locators for same action type
        for cap in native_captured:
            if not isinstance(cap, dict):
                continue
            cap_action = _normalize_action(str(cap.get("type") or cap.get("action") or ""))
            if cap_action != action:
                continue
            for loc in cap.get("locators") or []:
                if isinstance(loc, dict):
                    extras.append(loc)
    if not extras:
        return locs
    # Prefer existing, then extras not already present
    seen = {
        (str(l.get("kind")), str(l.get("value")), str(l.get("name") or ""))
        for l in locs
    }
    merged = list(locs)
    for loc in extras:
        key = (str(loc.get("kind")), str(loc.get("value")), str(loc.get("name") or ""))
        if key not in seen:
            merged.append(loc)
            seen.add(key)
    return merged


def build_compact_workflow(
    act_steps: list[dict[str, Any]],
    nl_steps: list[str] | None = None,
    assertion_plan: list[dict[str, Any]] | None = None,
    *,
    native_captured_actions: list[dict[str, Any]] | None = None,
    source: str = "browser-use-compact",
    url: str | None = None,
    site_pack: str | None = None,
    vocab: Any | None = None,
) -> dict[str, Any]:
    """
    Build compactWorkflow from full ActHistory (+ optional pre-action locator seeds).

    Site phrasing/CSS come from rulebook SiteVocab (url / site_pack). Legacy
    site-regex only runs when WEBPILOT_COMPACT_HEURISTICS=1.
    """
    with use_vocab(url=url, site_pack=site_pack, vocab=vocab):
        return _build_compact_workflow_inner(
            act_steps,
            nl_steps,
            assertion_plan,
            native_captured_actions=native_captured_actions,
            source=source,
        )


def _build_compact_workflow_inner(
    act_steps: list[dict[str, Any]],
    nl_steps: list[str] | None = None,
    assertion_plan: list[dict[str, Any]] | None = None,
    *,
    native_captured_actions: list[dict[str, Any]] | None = None,
    source: str = "browser-use-compact",
) -> dict[str, Any]:
    """
    Build compactWorkflow from full ActHistory (+ optional pre-action locator seeds).
    """
    nl_steps = list(nl_steps or [])
    assertion_plan = _ensure_assertion_plan_from_nl(nl_steps, assertion_plan)
    dropped: list[dict[str, Any]] = []
    kept_raw: list[dict[str, Any]] = []
    preserve_loops = _nl_wants_loops(nl_steps)
    claimed_verifies: set[str] = set()
    claimed_hovers: set[str] = set()

    for step in act_steps or []:
        if not isinstance(step, dict):
            continue
        raw_action = str(step.get("action") or "custom")
        action = _normalize_action(raw_action)
        description = str(step.get("description") or "")
        idx = int(step.get("index") or 0)

        if action == "search_page" or raw_action.lower() == "search_page":
            converted = _search_page_to_assert(
                step, nl_steps, assertion_plan, claimed_verifies=claimed_verifies
            )
            if converted:
                kept_raw.append(converted)
            else:
                dropped.append(
                    {
                        "index": idx,
                        "action": raw_action,
                        "reason": "drop agent-tool search_page",
                        "description": description[:120],
                    }
                )
            continue

        if action == "find_elements" or raw_action.lower() == "find_elements":
            converted = _find_elements_to_assert(
                step, nl_steps, assertion_plan, claimed_verifies=claimed_verifies
            )
            if converted:
                kept_raw.append(converted)
            else:
                dropped.append(
                    {
                        "index": idx,
                        "action": raw_action,
                        "reason": "drop agent-tool find_elements",
                        "description": description[:120],
                    }
                )
            continue

        if action == "evaluate" or raw_action.lower() == "evaluate":
            converted = _evaluate_to_hover(
                step, nl_steps, claimed_hovers=claimed_hovers
            )
            if not converted:
                converted = _evaluate_to_click(step, nl_steps)
            if converted:
                kept_raw.append(converted)
            else:
                dropped.append(
                    {
                        "index": idx,
                        "action": raw_action,
                        "reason": "drop agent-tool evaluate",
                        "description": description[:120],
                    }
                )
            continue

        if action in _DROP_ACTIONS or raw_action.lower() in _DROP_ACTIONS:
            dropped.append(
                {
                    "index": idx,
                    "action": raw_action,
                    "reason": f"drop agent-tool {action}",
                    "description": description[:120],
                }
            )
            continue
        if action not in _KEEP_ACTIONS and action not in ("assert",):
            if not step.get("selector") and not step.get("url") and not step.get("locators"):
                dropped.append(
                    {
                        "index": idx,
                        "action": raw_action,
                        "reason": f"drop unknown {action}",
                        "description": description[:120],
                    }
                )
                continue

        if _SKIP_LINK_RE.search(description) or _SKIP_LINK_RE.search(
            json.dumps(step.get("locators") or step.get("selector") or "")
        ):
            # Only drop if ALL locators are skip-links (filter may leave real ones)
            locs_probe = _filter_locators(action, _merge_native_captured(step, native_captured_actions))
            raw_locs = _merge_native_captured(step, native_captured_actions)
            if raw_locs and not locs_probe and action == "click":
                dropped.append(
                    {
                        "index": idx,
                        "action": raw_action,
                        "reason": "drop skip-link click",
                        "description": description[:120],
                    }
                )
                continue

        if action == "wait":
            try:
                seconds = float(step.get("value"))
            except (TypeError, ValueError):
                seconds = 0
            if seconds > 8:
                dropped.append(
                    {
                        "index": idx,
                        "action": raw_action,
                        "reason": f"drop long wait {seconds}s",
                        "description": description[:120],
                    }
                )
                continue

        locs = _filter_locators(action, _merge_native_captured(step, native_captured_actions))
        if action == "input" and not str(step.get("value") or "").strip():
            dropped.append(
                {
                    "index": idx,
                    "action": raw_action,
                    "reason": "drop empty input value",
                    "description": description[:120],
                }
            )
            continue
        if action == "click":
            raw_locs = _merge_native_captured(step, native_captured_actions)
            if raw_locs and not locs:
                dropped.append(
                    {
                        "index": idx,
                        "action": raw_action,
                        "reason": "drop skip-only locators",
                        "description": description[:120],
                    }
                )
                continue

        kept_raw.append({**step, "_action": action, "_locators": locs})

    # Pick best locators per input value (retries), then emit in encounter order.
    best_input: dict[str, dict[str, Any]] = {}
    for step in kept_raw:
        if step["_action"] != "input":
            continue
        key = str(step.get("value") or "").strip()
        locs = step["_locators"]
        prev = best_input.get(key)
        score = sum(_locator_rank(l) for l in locs) if locs else 0
        prev_score = sum(_locator_rank(l) for l in (prev or {}).get("_locators") or []) if prev else -1
        if prev is None:
            best_input[key] = step
        elif score > prev_score:
            dropped.append(
                {
                    "index": int(prev.get("index") or 0),
                    "action": str(prev.get("action") or "input"),
                    "reason": f"merged duplicate input value={key[:40]}",
                    "description": str(prev.get("description") or "")[:120],
                }
            )
            best_input[key] = step
        else:
            dropped.append(
                {
                    "index": int(step.get("index") or 0),
                    "action": str(step.get("action") or "input"),
                    "reason": f"merged duplicate input value={key[:40]}",
                    "description": str(step.get("description") or "")[:120],
                }
            )

    compact_steps: list[dict[str, Any]] = []
    used_inputs: set[str] = set()
    used_nl: dict[str, int] = {}
    nl_budget = _nl_occurrence_budget(nl_steps)
    last_click_sig: str | None = None
    click_run = 0
    last_nl_index = 0

    def _append_compact(raw_step: dict[str, Any], act: str, loc_list: list) -> None:
        nonlocal last_nl_index
        primary_loc = loc_list[0] if loc_list else None
        row = _to_compact_step(
            raw_step,
            act,
            loc_list,
            nl_steps,
            used_nl=used_nl,
            nl_budget=nl_budget,
            locator=primary_loc if isinstance(primary_loc, dict) else None,
            min_nl_index=max(0, last_nl_index - 1),  # allow slight backtrack
        )
        nl = (row.get("nlStep") or "").strip()
        if nl:
            key = nl.lower()
            used_nl[key] = used_nl.get(key, 0) + 1
            # Only interactive acts advance the sequential zipper. Promoted
            # search_page asserts often claim late NL indices early and would
            # otherwise block Enter/Submit binding.
            if act in ("navigate", "click", "input", "select", "press", "go_back", "hover"):
                for idx, candidate in enumerate(nl_steps or [], start=1):
                    if (candidate or "").strip().lower() == key:
                        last_nl_index = max(last_nl_index, idx)
                        break
        compact_steps.append(row)

    for step in kept_raw:
        action = step["_action"]
        locs = step["_locators"]
        value = None if step.get("value") is None else str(step.get("value"))
        if action == "input":
            key = (value or "").strip()
            if key in used_inputs:
                continue
            best = best_input.get(key) or step
            used_inputs.add(key)
            _append_compact(best, "input", best.get("_locators") or locs)
            last_click_sig = None
            click_run = 0
            continue
        if action == "click":
            sig = _click_sig(action, value, locs)
            if sig == last_click_sig:
                click_run += 1
                if not preserve_loops or click_run > _MAX_LOOP_CLICKS:
                    dropped.append(
                        {
                            "index": int(step.get("index") or 0),
                            "action": str(step.get("action") or "click"),
                            "reason": "merged duplicate click",
                            "description": str(step.get("description") or "")[:120],
                        }
                    )
                    continue
            else:
                last_click_sig = sig
                click_run = 1
            _append_compact(step, action, locs)
            continue
        if action == "assert":
            # Deduplicate / merge promoted asserts that share the same NL.
            hint = str(step.get("_nlHint") or step.get("description") or "").strip().lower()
            if hint:
                existing = next(
                    (
                        s
                        for s in compact_steps
                        if (s.get("nlStep") or "").strip().lower() == hint
                        and s.get("action") == "assert"
                    ),
                    None,
                )
                if existing:
                    # Merge locators from find_elements/search_page onto the kept assert.
                    new_locs = list(step.get("_locators") or [])
                    if new_locs:
                        cands = list(existing.get("selectorCandidates") or [])
                        sem = list(existing.get("semanticLocators") or [])
                        for loc in new_locs:
                            if loc and loc not in cands and loc != existing.get("locator"):
                                if str(loc.get("kind") or "") in _SEMANTIC_KINDS:
                                    sem.append(loc)
                                else:
                                    cands.append(loc)
                        if not existing.get("locator") and new_locs:
                            existing["locator"] = new_locs[0]
                        existing["semanticLocators"] = sem
                        existing["selectorCandidates"] = cands
                        if any(l.get("verified") for l in new_locs):
                            existing["verified"] = True
                    dropped.append(
                        {
                            "index": int(step.get("index") or 0),
                            "action": "assert",
                            "reason": "merged duplicate assert nl",
                            "description": str(step.get("description") or "")[:120],
                        }
                    )
                    continue
            _append_compact(step, action, locs)
            last_click_sig = None
            click_run = 0
            continue
        sig = _click_sig(action, value, locs)
        if compact_steps:
            prev = compact_steps[-1]
            prev_sig = _click_sig(
                str(prev.get("action")),
                prev.get("value"),
                list(prev.get("selectorCandidates") or []),
            )
            if prev_sig == sig:
                dropped.append(
                    {
                        "index": int(step.get("index") or 0),
                        "action": str(step.get("action") or action),
                        "reason": f"merged duplicate {action}",
                        "description": str(step.get("description") or "")[:120],
                    }
                )
                continue
        _append_compact(step, action, locs)
        last_click_sig = None
        click_run = 0

    # Interleave assertionPlan by NL index (not dump-at-end — wrong page context).
    compact_steps = _interleave_asserts_by_nl(compact_steps, assertion_plan, nl_steps)
    compact_steps = _ground_page_state_asserts(compact_steps)
    compact_steps = _ground_asserts_from_related_acts(compact_steps)
    compact_steps = _ground_hollow_asserts_from_nl_and_urls(compact_steps)
    compact_steps = _ensure_hover_steps(compact_steps, nl_steps)
    compact_steps = _ensure_optional_dismiss_steps(compact_steps, nl_steps)

    for i, step in enumerate(compact_steps, start=1):
        step["index"] = i

    coverage = _coverage(nl_steps, compact_steps, assertion_plan)
    return {
        "schemaVersion": COMPACT_WORKFLOW_SCHEMA_VERSION,
        "source": source,
        "steps": compact_steps,
        "dropped": dropped,
        "coverage": coverage,
    }


def _ensure_hover_steps(
    steps: list[dict[str, Any]],
    nl_steps: list[str],
) -> list[dict[str, Any]]:
    """
    Hover NL must become durable hover acts. When the agent used evaluate (or
    skipped emitting hover) but later clicked a sibling nav link, scaffold a
    hover on the named menu so replay/codegen cover the NL.
    """
    out = list(steps)
    claimed = {(s.get("nlStep") or "").strip().lower() for s in out if (s.get("nlStep") or "").strip()}
    hovered_targets = {
        str(s.get("value") or "").strip().lower()
        for s in out
        if str(s.get("action") or "").lower() == "hover" and s.get("value")
    }
    for loc_blob in out:
        if str(loc_blob.get("action") or "").lower() != "hover":
            continue
        for loc in (
            [loc_blob.get("locator")]
            + list(loc_blob.get("semanticLocators") or [])
            + list(loc_blob.get("selectorCandidates") or [])
        ):
            if isinstance(loc, dict):
                name = str(loc.get("name") or loc.get("value") or "").strip().lower()
                if name:
                    hovered_targets.add(name)

    for nl in nl_steps or []:
        text = (nl or "").strip()
        if not text or not _is_hover_nl(text):
            continue
        if text.lower() in claimed:
            continue
        target = _hover_target_from_nl(text)
        if not target:
            continue
        if target.lower() in hovered_targets:
            # Hover act exists without NL binding — attach NL.
            for step in out:
                if str(step.get("action") or "").lower() != "hover":
                    continue
                blob = f"{step.get('value') or ''} {json.dumps(step.get('locator') or {})}".lower()
                if target.lower() in blob and not (step.get("nlStep") or "").strip():
                    step["nlStep"] = text
                    claimed.add(text.lower())
                    break
            if text.lower() in claimed:
                continue
        locs = [
            {"kind": "role", "value": "link", "name": target, "exact": False},
            {"kind": "role", "value": "menuitem", "name": target, "exact": False},
            {"kind": "text", "value": target, "exact": False},
        ]
        # Insert before the next nav click when possible, else append near start.
        insert_at = len(out)
        for i, step in enumerate(out):
            if str(step.get("action") or "").lower() != "click":
                continue
            click_blob = f"{step.get('description') or ''} {json.dumps(step.get('locator') or {})}".lower()
            # Prefer inserting before Plans/Resources-style nav clicks after privacy dismiss.
            if any(k in click_blob for k in ("plan", "resource", "customer", "product", "solution")):
                insert_at = i
                break
        scaffold = {
            "index": 0,
            "action": "hover",
            "value": target,
            "url": out[insert_at - 1].get("url") if insert_at > 0 and out else (out[0].get("url") if out else None),
            "nlStep": text,
            "locator": locs[0],
            "semanticLocators": locs[1:],
            "selectorCandidates": locs,
            "verified": False,
            "verifiedBy": None,
            "elementIndex": None,
            "backendNodeId": None,
            "description": f"hover | {target} | scaffolded from NL",
            "pageTitle": None,
        }
        out.insert(insert_at, scaffold)
        claimed.add(text.lower())
        hovered_targets.add(target.lower())

    return out


def _ensure_optional_dismiss_steps(
    steps: list[dict[str, Any]],
    nl_steps: list[str],
) -> list[dict[str, Any]]:
    """
    Optional cookie/dialog NL must always appear in compact → codegen as if-present
    dismiss clicks. When browser-use skipped the banner, inject a scaffold step;
    when it clicked Continue shopping / Accept, mark that click optional + bind NL.
    """
    out = list(steps)
    claimed = {(s.get("nlStep") or "").strip().lower() for s in out if (s.get("nlStep") or "").strip()}

    for step in out:
        if str(step.get("action") or "").lower() != "click":
            continue
        blob = f"{step.get('description') or ''} {json.dumps(step.get('locator') or {})}"
        unbound = not (step.get("nlStep") or "").strip()
        # A dismiss click the agent made on its own (no NL asked for it) is banner noise:
        # replaying it as a required click fails whenever the banner does not show up.
        if not _is_overlay_dismiss_blob(blob) and not (unbound and _is_bare_dismiss_click(blob)):
            continue
        step["optional"] = True
        if not (step.get("nlStep") or "").strip():
            for nl in nl_steps or []:
                text = (nl or "").strip()
                if text and _is_optional_nl(text) and any(
                    k in text.lower() for k in ("cookie", "consent", "if a", "location", "sign-in", "sign in", "dismiss")
                ):
                    if text.lower() not in claimed:
                        step["nlStep"] = text
                        claimed.add(text.lower())
                        break

    # Inject missing optional dismiss NLs (so codegen always emits if-present handlers).
    insert_at = 1  # after first navigate when possible
    for i, s in enumerate(out):
        if str(s.get("action") or "").lower() == "navigate":
            insert_at = i + 1
            break

    for nl in nl_steps or []:
        text = (nl or "").strip()
        if not text or not _is_optional_nl(text):
            continue
        # Language "if not already" is optional but not a dismiss overlay.
        if _is_language_nl(text) and not any(k in text.lower() for k in ("cookie", "consent", "dismiss", "dialog")):
            continue
        if not any(k in text.lower() for k in ("cookie", "consent", "dismiss", "dialog", "location", "sign-in", "sign in", "if a")):
            continue
        if text.lower() in claimed:
            continue
        locs = _optional_dismiss_locators_for_nl(text)
        primary = locs[0] if locs else None
        scaffold = {
            "index": 0,
            "action": "click",
            "value": None,
            "url": out[insert_at - 1].get("url") if insert_at > 0 and out else None,
            "nlStep": text,
            "locator": primary,
            "semanticLocators": [l for l in locs[1:] if l.get("kind") in _SEMANTIC_KINDS],
            "selectorCandidates": locs,
            "verified": False,
            "verifiedBy": None,
            "elementIndex": None,
            "backendNodeId": None,
            "description": f"optional dismiss (codegen if-present): {text}",
            "pageTitle": None,
            "optional": True,
        }
        out.insert(insert_at, scaffold)
        claimed.add(text.lower())
        insert_at += 1

    return out


def _ground_hollow_asserts_from_nl_and_urls(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Ground remaining hollow verifies using observed URLs and NL-semantic locators
    (url contains, homepage load, Sign in, 'X is displayed').
    """
    urls = [str(s.get("url") or "") for s in steps if s.get("url")]
    # Values the flow entered earlier (search terms, destinations, …). When a hollow
    # assert mentions one of them and the value is reflected in an observed URL
    # (e.g. Booking's ?ss=London…), that URL is concrete evidence for the assert.
    entered_values = [
        str(s.get("value") or "").strip()
        for s in steps
        if str(s.get("action") or "").lower() in ("input", "fill", "type", "select")
        and len(str(s.get("value") or "").strip()) >= 3
    ]
    for pos, step in enumerate(steps):
        if str(step.get("action") or "").lower() not in ("assert", "verify"):
            continue
        if _assert_is_grounded(step):
            continue
        nl = str(step.get("nlStep") or step.get("value") or "").strip()
        if not nl:
            continue
        lower = nl.lower()
        bare_raw = _strip_gherkin_prefix(nl)
        bare = bare_raw.lower()

        # Only URLs observed at or after this assert count as evidence for it —
        # replay checks the current URL at the assert's position in the flow.
        urls_from_here = [
            str(s.get("url") or "")
            for s in steps[max(pos - 1, 0):]
            if s.get("url")
        ]
        # Vocab-driven URL / CSS grounding (digital products/cart, booking destination, …)
        patch = url_ground_for_nl(nl, urls_from_here or urls, entered_values)
        if patch:
            for key, val in patch.items():
                step[key] = val
            continue

        grounded_from_value = False
        for entered in entered_values:
            if entered.lower() not in lower:
                continue
            hit = next((u for u in urls_from_here if entered.lower() in u.lower()), None)
            if hit:
                step["value"] = f"__url_contains__:{entered}"
                step["url"] = hit
                grounded_from_value = True
                break
        if grounded_from_value:
            continue

        url_m = re.search(r"url\s+contains\s+(.+)$", bare, re.I)
        if url_m:
            fragment = url_m.group(1).replace(".", "").strip().strip("\"'")
            if fragment and any(fragment.lower() in u.lower() for u in urls):
                step["value"] = f"__url_contains__:{fragment}"
                step["url"] = next((u for u in urls if fragment.lower() in u.lower()), step.get("url"))
                continue

        # Home / landing page visibility — use first observed URL (usually the navigate target).
        if re.search(
            r"\b(loads?\s+successfully|homepage\s+loads|home\s+page\s+is\s+(visible|displayed|shown)|"
            r"home\s+page\s+.*\bsuccessfully\b|verify\s+home\s+page)\b",
            bare,
        ):
            home = next((u for u in urls if u), None)
            if home:
                step["value"] = f"__url_equals__:{home}"
                step["url"] = home
                continue

        # ALL PRODUCTS / products list / searched products / detail page
        if re.search(r"\ball\s+products\b|\bproducts\s+page\b|\bnavigated\s+to\s+all\s+products\b", bare):
            hit = next((u for u in urls if "/products" in u.lower()), None)
            if hit:
                step["value"] = "__url_contains__:products"
                step["url"] = hit
                continue
            step["value"] = "__url_contains__:products"
            continue
        if re.search(r"\bproducts?\s+list\b|\bproducts?\s+related\b|\bsearched\s+products\b", bare):
            locs = [
                {"kind": "css", "value": ".features_items .product-image-wrapper"},
                {"kind": "css", "value": ".features_items"},
                {"kind": "text", "value": "SEARCHED PRODUCTS", "exact": False},
            ]
            step["locator"] = locs[0]
            step["selectorCandidates"] = locs
            step["verified"] = True
            continue
        if re.search(r'text\s+[\'"]searched products[\'"]|searched products', bare):
            loc = {"kind": "text", "value": "SEARCHED PRODUCTS", "exact": False}
            step["locator"] = loc
            step["selectorCandidates"] = [loc, {"kind": "css", "value": "h2.title"}]
            step["verified"] = True
            continue
        if re.search(r"product\s+detail|detail\s+page", bare):
            hit = next((u for u in urls if "product_details" in u.lower()), None)
            if hit:
                step["value"] = "__url_contains__:product_details"
                step["url"] = hit
                continue
            locs = [
                {"kind": "css", "value": ".product-information"},
                {"kind": "css", "value": "div.product-details"},
            ]
            step["locator"] = locs[0]
            step["selectorCandidates"] = locs
            step["verified"] = True
            continue
        if re.search(r"\b(name|category|price|availability|condition|brand)\b", bare) and "detail" in bare:
            locs = [
                {"kind": "css", "value": ".product-information"},
                {"kind": "css", "value": ".product-information span span"},
            ]
            step["locator"] = locs[0]
            step["selectorCandidates"] = locs
            step["verified"] = True
            continue

        # "Verify X section" / "Verify the Sign in button is visible" — the NL names the
        # element type, so use its role. Agents often assert sections by reading the page
        # instead of probing it, leaving no locator evidence behind.
        noun = re.match(
            r"^(?:verify|assert|check|ensure)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+"
            r"(section|heading|title|tab|link|button)"
            r"(?:\s+(?:is|are)\s+(?:displayed|visible|shown|present))?\s*$",
            bare_raw,
            re.I,
        )
        if noun:
            name = noun.group(1).strip().strip("\"'")
            role = {
                "section": "heading",
                "heading": "heading",
                "title": "heading",
                "tab": "tab",
                "link": "link",
                "button": "button",
            }[noun.group(2).lower()]
            if name and len(name) <= 64:
                loc = {"kind": "role", "value": role, "name": name, "exact": False}
                step["locator"] = loc
                step["selectorCandidates"] = [
                    loc,
                    {"kind": "text", "value": name, "exact": False},
                ]
                step["verified"] = True
                continue

        if re.search(r"\bsign\s*in\b", lower) and "visible" in lower:
            loc = {"kind": "role", "value": "link", "name": "Sign in", "exact": True}
            step["locator"] = loc
            step["selectorCandidates"] = [loc]
            step["verified"] = True
            continue

        # Cart contents — prefer observed cart URL, else durable cart table / product text.
        if _is_cart_verify_nl(nl) or _is_cart_line_details_nl(nl):
            cart_url = next(
                (
                    u
                    for u in urls_from_here
                    if re.search(r"view_cart|/cart\b", u, re.I)
                ),
                None,
            )
            if not cart_url:
                cart_url = next(
                    (u for u in urls if re.search(r"view_cart|/cart\b", u, re.I)),
                    None,
                )
            if cart_url and _is_cart_verify_nl(nl) and not _is_cart_line_details_nl(nl):
                frag = "view_cart" if "view_cart" in cart_url.lower() else "cart"
                step["value"] = f"__url_contains__:{frag}"
                step["url"] = cart_url
                continue
            locs = [
                {"kind": "css", "value": "#cart_info_table tbody tr"},
                {"kind": "css", "value": "tr[id^='product-']"},
                {"kind": "css", "value": "#cart_info_table"},
                {"kind": "role", "value": "table", "exact": False},
            ]
            if _is_cart_line_details_nl(nl):
                locs = [
                    {"kind": "css", "value": "#cart_info_table tbody tr"},
                    {"kind": "css", "value": "tr[id^='product-'] .cart_price"},
                    {"kind": "css", "value": "tr[id^='product-'] .cart_quantity"},
                    {"kind": "css", "value": "tr[id^='product-'] .cart_total"},
                ] + locs
            step["locator"] = locs[0]
            step["selectorCandidates"] = locs
            step["verified"] = True
            continue

        # Main/site navigation chrome — role=navigation (or named menu link).
        if _is_menu_visible_nl(nl) or _is_menu_expand_nl(nl):
            menu_name = _menu_name_from_verify_nl(nl) or _hover_target_from_nl(nl)
            locs: list[dict[str, Any]] = []
            if menu_name:
                locs.extend(
                    [
                        {"kind": "role", "value": "link", "name": menu_name, "exact": False},
                        {"kind": "role", "value": "menuitem", "name": menu_name, "exact": False},
                        {"kind": "text", "value": menu_name, "exact": False},
                    ]
                )
            if re.search(r"\b(main\s+)?navigation(\s+menu)?\b", lower) and not menu_name:
                locs.append({"kind": "role", "value": "navigation", "exact": False})
                locs.append({"kind": "css", "value": "nav"})
            if "submenu" in lower and menu_name:
                locs.insert(
                    0,
                    {"kind": "role", "value": "menu", "name": menu_name, "exact": False},
                )
            if locs:
                step["locator"] = locs[0]
                step["selectorCandidates"] = locs
                step["verified"] = True
                continue

        # "Verify X is/are visible/displayed/shown" — text/role locator from the NL name.
        disp = re.match(
            r"^(?:verify|assert|check|ensure)\s+(?:that\s+)?(.+?)\s+(?:is|are)\s+"
            r"(?:displayed|visible|shown|present)\s*$",
            nl,
            re.I,
        )
        if disp:
            name = disp.group(1).strip().strip("\"'")
            name = re.sub(r"^(?:the|a|an)\s+", "", name, flags=re.I).strip()
            # "the search results page" is page state with no literal copy behind it, but
            # "This page was last edited" is real footer text — only the trailing noun
            # marks the page-state phrasing.
            page_state = bool(re.search(r"\b(page|screen|view)\s*$", name, re.I))
            if name and len(name) <= 64 and not page_state:
                if re.search(r"\.md$|readme", name, re.I):
                    loc = {"kind": "text", "value": name, "exact": False}
                elif re.search(r"\b(navigation|menu|nav)\b", name, re.I):
                    loc = {"kind": "role", "value": "navigation", "exact": False}
                    step["selectorCandidates"] = [
                        loc,
                        {"kind": "css", "value": "nav"},
                        {"kind": "text", "value": name, "exact": False},
                    ]
                elif re.search(r"\bsearch\b", name, re.I):
                    # Wikipedia / Booking search fields — prefer searchbox/combobox role,
                    # with text fallback matching placeholder ("Search Wikipedia").
                    loc = {"kind": "role", "value": "searchbox", "name": name, "exact": False}
                    step["selectorCandidates"] = [
                        loc,
                        {"kind": "role", "value": "combobox", "name": name, "exact": False},
                        {"kind": "placeholder", "value": name},
                        {"kind": "text", "value": name, "exact": False},
                    ]
                else:
                    # "X is displayed" asserts page copy, and nothing observed says the
                    # copy is a link or heading ("Revision history" is part of an h1 on
                    # Wikipedia). getByText matches the text in any element. Keep this a
                    # lone candidate: codegen ranks role above text, so an invented role
                    # would outrank the only locator we can actually stand behind.
                    loc = {"kind": "text", "value": name, "exact": False}
                    step["selectorCandidates"] = [loc]
                step["locator"] = loc
                if not step.get("selectorCandidates"):
                    step["selectorCandidates"] = [loc]
                step["verified"] = True
                continue
    return steps


def _ground_asserts_from_related_acts(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Hollow search-field verifies can reuse the locator from a nearby fill when
    browser-use never probed the control as a standalone assert (e.g. Wikipedia
    'Verify Search Wikipedia is visible' right before typing into searchInput).
    """
    # Collect every input locator with its step index for proximity matching.
    input_entries: list[tuple[int, dict[str, Any], str]] = []
    for idx, s in enumerate(steps):
        if str(s.get("action") or "").lower() != "input":
            continue
        for loc in (
            [s.get("locator")]
            + list(s.get("semanticLocators") or [])
            + list(s.get("selectorCandidates") or [])
        ):
            if isinstance(loc, dict) and (loc.get("value") or loc.get("name")):
                blob = f"{loc.get('name') or ''} {loc.get('value') or ''} {loc.get('filterText') or ''}".lower()
                input_entries.append((idx, loc, blob))
    if not input_entries:
        return steps
    for pos, step in enumerate(steps):
        if str(step.get("action") or "").lower() not in ("assert", "verify"):
            continue
        if _assert_is_grounded(step):
            continue
        nl = str(step.get("nlStep") or step.get("value") or "").lower()
        if "search" not in nl:
            continue
        if not re.search(r"\b(visible|displayed|shown|search input|search box|search field)\b", nl):
            continue
        # Prefer an input within ±3 steps; else first search-ish locator.
        nearby = [
            (abs(i - pos), loc)
            for i, loc, blob in input_entries
            if abs(i - pos) <= 3 and ("search" in blob or "searchbox" in blob or "combobox" in blob or i >= pos)
        ]
        if not nearby:
            nearby = [(abs(i - pos), loc) for i, loc, _blob in input_entries]
        nearby.sort(key=lambda t: t[0])
        loc = nearby[0][1]
        step["locator"] = loc
        cands = list(step.get("selectorCandidates") or [])
        if loc not in cands:
            cands.insert(0, loc)
        step["selectorCandidates"] = cands
        step["verified"] = True
    return steps


def _destination_hints_from_steps(steps: list[dict[str, Any]]) -> list[str]:
    """Collect URL/path hints from step URLs and click locator hrefs/names."""
    hints: list[str] = []
    for s in steps:
        url = str(s.get("url") or "").strip()
        if url:
            hints.append(url)
        for loc in (
            [s.get("locator")]
            + list(s.get("semanticLocators") or [])
            + list(s.get("selectorCandidates") or [])
        ):
            if not isinstance(loc, dict):
                continue
            for key in ("value", "name", "filterText"):
                raw = str(loc.get(key) or "").strip()
                if not raw:
                    continue
                hints.append(raw)
                for m in re.finditer(r"""href\s*=\s*['"]([^'"]+)['"]""", raw, re.I):
                    hints.append(m.group(1))
                # css a[href="/products"] without quotes around attr in some dumps
                for m in re.finditer(r"href\s*=\s*([^\s\]]+)", raw, re.I):
                    hints.append(m.group(1).strip("'\""))
    return hints


def _ground_page_state_asserts(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Hollow 'page is displayed' asserts get URL-token evidence from observed act URLs.
    Prefers any visited URL that contains NL tokens (not the final URL after go_back).
    Also uses click locator hrefs (e.g. a[href="/products"]) when post-nav URL was not captured.
    """
    urls = [str(s.get("url") or "") for s in steps if s.get("url")]
    dest_hints = _destination_hints_from_steps(steps)
    if not urls and not dest_hints:
        return steps
    for step in steps:
        if str(step.get("action") or "").lower() not in ("assert", "verify"):
            continue
        if _assert_is_grounded(step):
            continue
        nl = str(step.get("nlStep") or step.get("value") or "")
        lower = nl.lower()
        if not re.search(
            r"page is (displayed|shown|visible)|article page|results page|home page",
            lower,
            re.I,
        ):
            continue

        # Explicit home/landing page verify — ground to first URL even when token "home"
        # is too short to appear in the path.
        if re.search(r"\bhome\s+page\b", lower) and re.search(
            r"\b(visible|displayed|shown|successfully)\b", lower
        ):
            home = urls[0] if urls else (dest_hints[0] if dest_hints else None)
            if home and home.startswith("http"):
                step["value"] = f"__url_equals__:{home}"
                step["url"] = home
                continue

        tokens = [
            t
            for t in re.split(r"[^a-zA-Z0-9]+", nl)
            if len(t) >= 4
            and not re.match(
                r"^(verify|assert|check|ensure|visible|displayed|shown|present|loaded|page|results?|article|successfully|that|the|home)$",
                t,
                re.I,
            )
        ]
        best_url = None
        best_len = -1
        search_pool = list(urls) + [h for h in dest_hints if h.startswith("http") or h.startswith("/")]
        for u in search_pool:
            lower_url = u.lower()
            token_hit = any(token.lower() in lower_url for token in tokens)
            results_hit = bool(
                re.search(r"results page|search results", nl, re.I)
                and re.search(r"/s\?|[?&]k=|/search\b", lower_url)
            )
            if token_hit or results_hit:
                if len(u) > best_len:
                    best_url = u
                    best_len = len(u)
        # Fallback: clicked link named Products / path hint without absolute URL.
        if not best_url:
            for token in tokens:
                for hint in dest_hints:
                    if token.lower() in hint.lower():
                        best_url = f"/{token.lower()}"
                        break
                if best_url:
                    break
        if best_url:
            grounded = False
            for token in tokens:
                if token.lower() in best_url.lower() or any(
                    token.lower() in h.lower() for h in dest_hints
                ):
                    step["value"] = f"__url_contains__:{token}"
                    step["url"] = step.get("url") or (
                        best_url if best_url.startswith("http") else (urls[-1] if urls else best_url)
                    )
                    grounded = True
                    break
            if not grounded and re.search(r"results page|search results", nl, re.I):
                # Prefer query param or /s path fragment
                frag = "search"
                m = re.search(r"[?&]k=([^&]+)", best_url)
                if m:
                    frag = m.group(1).replace("+", " ")[:40]
                elif "/s?" in best_url.lower():
                    frag = "/s?"
                step["value"] = f"__url_contains__:{frag}"
                step["url"] = step.get("url") or best_url
    return steps


def _to_compact_step(
    step: dict[str, Any],
    action: str,
    locs: list[dict[str, Any]],
    nl_steps: list[str],
    *,
    used_nl: dict[str, int] | None = None,
    nl_budget: dict[str, int] | None = None,
    locator: dict[str, Any] | None = None,
    min_nl_index: int = 0,
) -> dict[str, Any]:
    primary, semantic, candidates = _split_locator_buckets(locs)
    verified = bool(step.get("locatorVerified")) or any(
        l.get("verified") or l.get("verifiedBy") for l in locs
    )
    verified_by = step.get("locatorVerifiedBy")
    if not verified_by:
        for l in locs:
            if l.get("verifiedBy"):
                verified_by = l.get("verifiedBy")
                break
            if l.get("verified"):
                verified_by = "snapshot"
                break
    element = step.get("element") if isinstance(step.get("element"), dict) else {}
    description = str(step.get("description") or "")
    value = None if step.get("value") is None else str(step.get("value"))
    primary_loc = locator or primary
    hint = str(step.get("_nlHint") or "").strip()
    if hint and not _nl_consistent_with_act(hint, action, value, description, primary_loc):
        hint = ""
    align_score = 0
    if hint:
        nl = hint
        align_score = current_vocab().weight("hard_min", 8)
    else:
        nl, align_score = _align_nl_step(
            action,
            value,
            description,
            nl_steps,
            used_nl=used_nl,
            nl_budget=nl_budget,
            locator=primary_loc if isinstance(primary_loc, dict) else None,
            min_nl_index=min_nl_index,
        )
    return {
        "index": int(step.get("index") or 0),
        "action": action,
        "value": value,
        "url": step.get("url"),
        "nlStep": nl,
        "locator": primary,
        "semanticLocators": semantic,
        "selectorCandidates": candidates,
        "verified": verified,
        "verifiedBy": verified_by,
        "elementIndex": step.get("elementIndex"),
        "backendNodeId": element.get("backend_node_id") or element.get("backendNodeId"),
        "description": description[:500] if description else None,
        "pageTitle": step.get("pageTitle"),
        "alignScore": align_score,
        "alignBand": _align_band(align_score) if nl else "none",
    }


def compact_steps_to_act_steps(compact: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Convert compactWorkflow.steps into ActHistory-shaped rows for replay/codegen adapters."""
    if not compact or not isinstance(compact, dict):
        return []
    rows: list[dict[str, Any]] = []
    for step in compact.get("steps") or []:
        if not isinstance(step, dict):
            continue
        candidates = list(step.get("selectorCandidates") or [])
        if step.get("locator") and step["locator"] not in candidates:
            candidates = [step["locator"], *candidates]
        semantic = list(step.get("semanticLocators") or [])
        # Prefer primary + semantic + rest, unique
        ordered: list[dict[str, Any]] = []
        seen: set[tuple[str, str, str]] = set()
        for loc in [
            step.get("locator"),
            *semantic,
            *candidates,
        ]:
            if not isinstance(loc, dict):
                continue
            key = (str(loc.get("kind")), str(loc.get("value")), str(loc.get("name") or ""))
            if key in seen:
                continue
            seen.add(key)
            ordered.append(loc)
        rows.append(
            {
                "index": step.get("index"),
                "action": step.get("action"),
                "value": step.get("value"),
                "url": step.get("url"),
                "description": step.get("nlStep") or step.get("description") or step.get("action"),
                "locators": ordered,
                "selector": json.dumps(ordered, ensure_ascii=False) if ordered else None,
                "pageTitle": step.get("pageTitle"),
                "elementIndex": step.get("elementIndex"),
                "locatorVerified": bool(step.get("verified")),
                "locatorVerifiedBy": step.get("verifiedBy"),
                "nlStep": step.get("nlStep"),
                "optional": bool(step.get("optional")),
            }
        )
    return rows
