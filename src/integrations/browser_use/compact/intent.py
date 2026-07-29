"""Vocab-driven intent detection for compact align/ground/coverage."""
from __future__ import annotations

import re
from typing import Any

from .vocab_context import current_vocab, heuristics_enabled


def _strip_gherkin(text: str) -> str:
    return re.sub(
        r"^\s*(?:given|when|then|and|but)\s+",
        "",
        (text or "").strip(),
        flags=re.I,
    )


def _verifyish(text: str) -> bool:
    t = _strip_gherkin(text).lower()
    return any(k in t for k in ("verify", "assert", "check", "ensure", "should"))


def intent_ids_for_nl(text: str) -> list[str]:
    return current_vocab().intents_for_nl(_strip_gherkin(text))


def intent_ids_for_act(blob: str) -> list[str]:
    return current_vocab().intents_for_act(blob or "")


def has_intent_nl(text: str, intent_id: str) -> bool:
    alias = current_vocab().aliases.get(intent_id)
    if alias and alias.nl_matches(_strip_gherkin(text)):
        return True
    return False


def has_intent_act(blob: str, intent_id: str) -> bool:
    alias = current_vocab().aliases.get(intent_id)
    if alias and alias.act_matches(blob or ""):
        return True
    return False


def is_add_to_cart_nl(text: str) -> bool:
    if _verifyish(text):
        return False
    if has_intent_nl(text, "add_to_cart"):
        return True
    if not heuristics_enabled():
        return False
    t = _strip_gherkin(text).lower()
    if re.search(r"\bview[\s_-]*cart\b|\bopen\s+(the\s+)?cart\b", t):
        return False
    return bool(
        re.search(r"\badd\b.+\b(to\s+(the\s+)?)?cart\b", t)
        or re.search(r"\badd[\s_-]*to[\s_-]*cart\b", t)
    )


def is_add_to_cart_blob(blob: str) -> bool:
    if has_intent_act(blob, "add_to_cart"):
        return True
    if not heuristics_enabled():
        b = (blob or "").lower()
        if re.search(r"\bview[\s_-]*cart\b", b):
            return False
        # Soft generic fallback when vocab missed exact phrasing but pattern is clear.
        return bool(re.search(r"add[\s_-]*to[\s_-]*cart|addtocart|\.add-to-cart\b", b))
    b = (blob or "").lower()
    if re.search(r"\bview[\s_-]*cart\b", b):
        return False
    return bool(re.search(r"add[\s_-]*to[\s_-]*cart|addtocart|\.add-to-cart\b", b))


def is_view_cart_blob(blob: str) -> bool:
    if is_add_to_cart_blob(blob):
        return False
    if has_intent_act(blob, "view_cart"):
        return True
    if not heuristics_enabled():
        return bool(re.search(r"\bview[\s_-]*cart\b", (blob or "").lower()))
    return bool(re.search(r"\bview[\s_-]*cart\b", (blob or "").lower()))


def is_cart_verify_nl(text: str) -> bool:
    if has_intent_nl(text, "cart_verify"):
        return True
    if not heuristics_enabled():
        t = _strip_gherkin(text).lower()
        if not re.search(r"\b(verify|assert|check|ensure|should)\b", t):
            return False
        if not re.search(r"\bcart\b", t):
            return False
        return bool(
            re.search(r"\b(appears?|appear|visible|shown|displayed|present|listed|in|on)\b", t)
        )
    t = _strip_gherkin(text).lower()
    if not re.search(r"\b(verify|assert|check|ensure|should)\b", t):
        return False
    if not re.search(r"\bcart\b", t):
        return False
    return bool(
        re.search(r"\b(appears?|appear|visible|shown|displayed|present|listed|in|on)\b", t)
        or re.search(r"\b(product|item)\b.+\bcart\b|\bcart\b.+\b(product|item)\b", t)
    )


def is_cart_line_details_nl(text: str) -> bool:
    t = _strip_gherkin(text).lower()
    if not re.search(r"\b(verify|assert|check|ensure|should)\b", t):
        return False
    return bool(
        re.search(r"\b(price|quantity|qty|total)\b", t)
        and re.search(r"\b(product|cart|item|visible|correct|shown|displayed)\b", t)
    )


def is_continue_shopping_nl(text: str) -> bool:
    if has_intent_nl(text, "continue_shopping"):
        return True
    return bool(re.search(r"continue\s+shopping", _strip_gherkin(text), re.I))


def is_continue_shopping_blob(blob: str) -> bool:
    if has_intent_act(blob, "continue_shopping"):
        return True
    return bool(re.search(r"continue\s+shopping", blob or "", re.I))


def is_cookie_or_optional_nl(text: str) -> bool:
    vocab = current_vocab()
    ids = intent_ids_for_nl(text)
    if any(vocab.is_optional_intent(i) for i in ids):
        return True
    t = _strip_gherkin(text).lower()
    if t.startswith("if ") or " if " in t:
        return True
    return any(k in t for k in ("cookie", "consent", "dismiss", "privacy popup"))


def exclusive_conflict_nl_act(nl: str, act_blob: str) -> bool:
    vocab = current_vocab()
    nl_ids = set(intent_ids_for_nl(nl))
    act_ids = set(intent_ids_for_act(act_blob))
    for a in nl_ids:
        for b in act_ids:
            if a != b and vocab.exclusive_conflict(a, b):
                return True
    # language NL vs search act
    if "language_select" in nl_ids and "search_submit" in act_ids:
        return True
    if "search_submit" in nl_ids and "language_select" in act_ids:
        return True
    return False


def css_probe_score(selector: str, nl_text: str) -> int:
    """Score find_elements selector against NL using vocab css_probes + aliases."""
    vocab = current_vocab()
    sel = (selector or "").lower()
    lower = (nl_text or "").lower()
    score = 0
    hits = vocab.css_probe_match(selector)
    if "cart_rows" in hits and (is_cart_verify_nl(nl_text) or is_cart_line_details_nl(nl_text)):
        score += 12
    if "amazon_results" in hits:
        if "s-search-result" in sel or "search-result" in sel:
            has_title = bool(re.search(r"\bh2\b", sel))
            has_price = "a-price" in sel or "offscreen" in sel
            if has_title and ("title" in lower or "product result shows a product" in lower):
                score += 12
            elif has_price and ("price" in lower or "purchasing" in lower):
                score += 12
            elif "at least one product" in lower or "product result is visible" in lower:
                score += 10
            elif "search results page" in lower or "results page" in lower:
                score += 7
        if "nav-logo" in sel and "logo" in lower:
            score += 8
    if "ae_products_list" in hits and (
        "products" in lower or "product" in lower or "searched" in lower
    ):
        score += 8
    if "wiki_heading" in hits and ("heading" in lower or "title" in lower):
        score += 8
    if "wiki_logo" in hits and "logo" in lower:
        score += 8

    # Generic chrome probes (always useful)
    if sel in ("img",) or "logo" in sel:
        if "logo" in lower:
            score += 8
    if "search" in sel and ("input" in sel or sel.endswith("searchinput") or "search-input" in sel):
        if "search" in lower and ("input" in lower or "logo" in lower):
            score += 8
    if "firstheading" in sel or re.match(r"^h1\b", sel) or sel == "h1":
        if "heading" in lower or "title" in lower:
            score += 8
    if "toc" in sel or "contents" in sel or "vector-toc" in sel:
        if any(k in lower for k in ("contents", "navigation", "toc")):
            score += 8
    if "product_details" in sel or "view product" in sel:
        if re.search(r"view\s*product|product\s+detail", lower):
            score += 12
    return score


def url_ground_for_nl(nl: str, urls: list[str], entered_values: list[str]) -> dict[str, Any] | None:
    """Return assert value/url patch from vocab url_tokens, or None."""
    vocab = current_vocab()
    bare = _strip_gherkin(nl).lower()
    for _key, rule in vocab.url_tokens.items():
        if not isinstance(rule, dict):
            continue
        patterns = [str(p) for p in (rule.get("nl_patterns") or []) if p]
        matched = False
        if patterns:
            for pat in patterns:
                try:
                    if re.search(pat, bare):
                        matched = True
                        break
                except re.error:
                    if pat.lower() in bare:
                        matched = True
                        break
        if not matched and not patterns:
            continue
        if not matched:
            continue
        ground = str(rule.get("ground") or "")
        if ground == "url_equals_first":
            home = next((u for u in urls if u), None)
            if home:
                return {"value": f"__url_equals__:{home}", "url": home}
        if ground == "url_contains_capture":
            for pat in patterns:
                try:
                    m = re.search(pat, bare)
                except re.error:
                    m = None
                if m and m.lastindex:
                    fragment = m.group(1).replace(".", "").strip().strip("\"'")
                    if fragment and any(fragment.lower() in u.lower() for u in urls):
                        hit = next(u for u in urls if fragment.lower() in u.lower())
                        return {"value": f"__url_contains__:{fragment}", "url": hit}
        emit = rule.get("emit")
        subs = [str(s) for s in (rule.get("url_substrings") or []) if s]
        if emit or subs:
            hit = None
            for u in urls:
                ul = u.lower()
                if any(s.lower() in ul for s in subs):
                    hit = u
                    break
            if emit:
                return {"value": str(emit), "url": hit}
            if hit:
                return {"value": f"__url_contains__:{subs[0]}", "url": hit}
        url_regex = rule.get("url_regex")
        if url_regex:
            try:
                hit = next((u for u in urls if re.search(str(url_regex), u, re.I)), None)
            except re.error:
                hit = None
            if hit:
                return {"value": f"__url_contains__:{hit.split('?')[0][-24:]}", "url": hit}

    # entered_value_in_url (digital)
    entered_rule = vocab.url_tokens.get("entered_value_in_url") or {}
    if entered_rule.get("enabled", True):
        min_len = int(entered_rule.get("min_len") or 3)
        for entered in entered_values:
            if len(entered) < min_len or entered.lower() not in bare:
                continue
            hit = next((u for u in urls if entered.lower() in u.lower()), None)
            if hit:
                return {"value": f"__url_contains__:{entered}", "url": hit}

    # Alias ground blocks
    for intent_id in intent_ids_for_nl(nl):
        alias = vocab.aliases.get(intent_id)
        if not alias or not alias.ground:
            continue
        g = alias.ground
        for frag in g.get("url_contains_any") or []:
            hit = next((u for u in urls if str(frag).lower() in u.lower()), None)
            if hit:
                return {"value": f"__url_contains__:{frag}", "url": hit}
        # Do not invent CSS locators for trailing page-state verifies
        # ("… search results page is displayed") — those stay URL-only / hollow.
        page_state = bool(re.search(r"\b(page|screen|view)\s*(is\s+)?(displayed|visible|shown)?\s*$", bare))
        css = g.get("css") or []
        if css and not page_state:
            locs = [{"kind": "css", "value": c} for c in css]
            return {"locator": locs[0], "selectorCandidates": locs, "verified": True}
        if g.get("entered_value_in_url"):
            for entered in entered_values:
                if entered.lower() not in bare:
                    continue
                hit = next((u for u in urls if entered.lower() in u.lower()), None)
                if hit:
                    return {"value": f"__url_contains__:{entered}", "url": hit}
    return None


def locator_templates_for_optional(intent_id: str = "cookie_dismiss") -> list[dict[str, Any]]:
    alias = current_vocab().aliases.get(intent_id)
    if alias and alias.locator_templates:
        return [dict(t) for t in alias.locator_templates]
    if intent_id != "cookie_dismiss":
        return []
    return [
        {"kind": "role", "value": "button", "name": "Accept all", "exact": False},
        {"kind": "css", "value": "#onetrust-accept-btn-handler"},
    ]


def search_page_bridge_bonus(query: str, nl_text: str) -> int:
    vocab = current_vocab()
    q = (query or "").lower()
    lower = (nl_text or "").lower()
    bonus = 0
    for alias in vocab.aliases.values():
        if not alias.nl_matches(nl_text):
            continue
        for bridge in alias.search_page_bridges:
            needles = [str(x).lower() for x in (bridge.get("query_contains") or [])]
            if needles and any(n in q for n in needles):
                bonus += int(bridge.get("bonus") or 6)
    # Prefer intro NL for long wiki lead text even without alias match
    if ("from wikipedia" in q or len(q) >= 40) and any(
        k in lower for k in ("introduction", "intro", "lead")
    ):
        bonus = max(bonus, 8)
    if re.search(r"\b(encyclopedia|the free encyclopedia)\b", q) and any(
        k in lower for k in ("logo", "homepage", "home page", "search input")
    ):
        bonus = max(bonus, 6)
    return bonus
