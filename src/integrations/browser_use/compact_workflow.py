"""
Compact workflow — durable, ordered steps for Playwright replay / deterministic codegen.

Full actHistory remains the audit transcript. compactWorkflow is the source of truth
for script generation: noise dropped with reasons, locators ranked, NL coverage scored.
"""

from __future__ import annotations

import json
import re
from typing import Any

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
) -> str | None:
    """Find the verify NL line that this search_page query was satisfying."""
    q = (query or "").strip().lower()
    if not q:
        return None
    candidates: list[str] = []
    for nl in nl_steps or []:
        text = (nl or "").strip()
        if text:
            candidates.append(text)
    for item in assertion_plan or []:
        text = str(item.get("nlStep") or "").strip()
        if text and text not in candidates:
            candidates.append(text)

    best: tuple[int, str] | None = None
    for text in candidates:
        lower = text.lower()
        if not any(k in lower for k in ("verify", "assert", "check", "ensure", "capture screenshot")):
            continue
        score = 0
        if q in lower:
            score += 8
        q_tokens = [t for t in re.split(r"[^a-z0-9]+", q) if len(t) >= 4]
        for t in q_tokens[:6]:
            if t in lower:
                score += 2
        if score >= 6 and (best is None or score > best[0]):
            best = (score, text)
    return best[1] if best else None


def _search_page_to_assert(
    step: dict[str, Any],
    nl_steps: list[str],
    assertion_plan: list[dict[str, Any]],
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
    matched_nl = _match_verify_nl(query, nl_steps, assertion_plan)
    if not matched_nl:
        return None

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
    if any(k in matched_nl.lower() for k in ("section", "heading", "page")):
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


def _is_optional_nl(text: str) -> bool:
    """Conditional NL (If …) is soft — covered by cookie accept or allowed unmapped."""
    return bool(re.match(r"^if\b", (text or "").strip(), re.I))


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
) -> str | None:
    """Best-effort NL alignment for coverage (not inventing acts)."""
    blob = f"{action} {value or ''} {description or ''}".lower()
    used_counts = used_nl if used_nl is not None else {}
    budget = nl_budget if nl_budget is not None else _nl_occurrence_budget(nl_steps)
    best: tuple[int, str] | None = None
    for nl in nl_steps or []:
        text = (nl or "").strip()
        if not text:
            continue
        lower = text.lower()
        if used_counts.get(lower, 0) >= budget.get(lower, 1):
            continue
        score = 0
        if action in ("navigate", "open") and ("navigate" in lower or "http" in lower or "open" in lower):
            score += 3
        if action == "go_back":
            # "Navigate back to the previous page" / "go back" / "browser back"
            if any(k in lower for k in ("go back", "navigate back", "previous page", "browser back")):
                score += 8
            elif "back" in lower and "navigate" in lower:
                score += 6
            elif re.search(r"\bback\b", lower) and "feedback" not in lower:
                score += 4
        if action == "input" and value and str(value).lower()[:12] in lower:
            score += 5
        if action == "input" and any(k in lower for k in ("enter", "type", "fill", "email", "password", "code", "destination")):
            score += 2
        if action == "click":
            if any(k in lower for k in ("click", "press", "tap", "continue", "sign in", "confirm", "back", "accept", "select")):
                score += 2
            # Prefer cookie/consent NL for Accept / OneTrust clicks — not "Search".
            if any(k in blob for k in ("accept", "onetrust", "consent", "cookie")):
                if any(k in lower for k in ("cookie", "consent", "accept", "dismiss")):
                    score += 8
                if "search" in lower and "cookie" not in lower:
                    score -= 6
            # Dismiss / close / sign-in interstitial — never map to Search or destination.
            if any(k in blob for k in ("dismiss", "sign in information", "close dialog", "genius")):
                if any(k in lower for k in ("cookie", "consent", "dismiss", "if a")):
                    score += 8
                if "search" in lower or "destination" in lower or "date" in lower:
                    score -= 10
            # Calendar day cells (aria-label dates / weekday + day) → check-in/out NL.
            dateish = bool(
                re.search(r"\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", blob)
                or "calendar" in blob
                or "gridcell" in blob
            )
            if dateish:
                is_checkout_nl = bool(re.search(r"check[\s-]*out", lower))
                is_checkin_nl = bool(re.search(r"check[\s-]*in", lower)) and not is_checkout_nl
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
                elif "date picker" in lower or "open the date" in lower or "select dates" in lower:
                    score += 5
                if "search" in lower and "date" not in lower:
                    score -= 8
            # Destination suggestion clicks
            if value and str(value).lower()[:20] in lower:
                score += 6
            if "london" in blob and "london" in lower and not dateish:
                score += 4
            # Search button — require Search in the click blob, not just the NL.
            if "search" in lower:
                if re.search(r"\bsearch\b", blob) and "date" not in blob and "dismiss" not in blob:
                    score += 6
                else:
                    score -= 4
            if ("date picker" in lower or "open the date" in lower) and (
                dateish or "select dates" in blob or "date" in blob
            ):
                score += 4
            elif "date" in lower or re.search(r"check[\s-]*in", lower) or re.search(r"check[\s-]*out", lower):
                if any(k in blob for k in ("date", "calendar", "check-in", "check-out", "day")) or dateish:
                    score += 3
        if action == "assert" and any(k in lower for k in ("verify", "assert", "check", "ensure")):
            score += 4
        # Token overlap
        tokens = [t for t in re.split(r"[^a-z0-9]+", lower) if len(t) >= 4]
        for t in tokens[:8]:
            if t in blob:
                score += 1
        if best is None or score > best[0]:
            best = (score, text)
    if best and best[0] >= 3:
        return best[1]
    return None


def _coverage(
    nl_steps: list[str],
    compact_steps: list[dict[str, Any]],
    assertion_plan: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    mapped_nl: set[str] = set()
    for step in compact_steps:
        nl = (step.get("nlStep") or "").strip()
        if nl:
            mapped_nl.add(nl)
    for item in assertion_plan or []:
        nl = str(item.get("nlStep") or "").strip()
        if nl:
            mapped_nl.add(nl)

    # Cookie Accept clicks also cover optional "If cookie consent…" NL.
    has_cookie_accept = any(
        s.get("action") == "click"
        and (
            "accept" in json.dumps(s.get("locator") or s.get("selectorCandidates") or {}).lower()
            or "onetrust" in json.dumps(s.get("locator") or s.get("selectorCandidates") or {}).lower()
            or "consent" in str(s.get("description") or "").lower()
            or "accept" in str(s.get("nlStep") or "").lower()
        )
        for s in compact_steps
    )

    unmapped: list[str] = []
    optional_unmapped: list[str] = []
    for nl in nl_steps or []:
        text = (nl or "").strip()
        if not text:
            continue
        if text in mapped_nl:
            continue
        lower = text.lower()
        covered = False
        for m in mapped_nl:
            if m.lower() == lower or (len(lower) > 20 and (lower in m.lower() or m.lower() in lower)):
                covered = True
                break
        if not covered:
            if any((s.get("nlStep") or "").strip() == text for s in compact_steps):
                covered = True
        if not covered and _is_optional_nl(text):
            if has_cookie_accept or any(k in lower for k in ("cookie", "consent")):
                # Optional consent step: accept click present → covered; else soft-only.
                if has_cookie_accept:
                    covered = True
                else:
                    optional_unmapped.append(text)
                    continue
            else:
                optional_unmapped.append(text)
                continue
        # Selecting calendar days implies the date picker was opened.
        if not covered and ("date picker" in lower or "open the date" in lower):
            has_date_click = any(
                s.get("action") == "click"
                and re.search(
                    r"\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
                    str(s.get("description") or "").lower(),
                )
                for s in compact_steps
            )
            if has_date_click:
                covered = True
        if not covered:
            unmapped.append(text)

    total = len([s for s in (nl_steps or []) if (s or "").strip()])
    soft = len(optional_unmapped)
    return {
        "nlTotal": total,
        "mapped": total - len(unmapped) - soft,
        "unmapped": unmapped,
        "optionalUnmapped": optional_unmapped,
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
) -> dict[str, Any]:
    """
    Build compactWorkflow from full ActHistory (+ optional pre-action locator seeds).
    """
    nl_steps = list(nl_steps or [])
    assertion_plan = list(assertion_plan or [])
    dropped: list[dict[str, Any]] = []
    kept_raw: list[dict[str, Any]] = []
    preserve_loops = _nl_wants_loops(nl_steps)

    for step in act_steps or []:
        if not isinstance(step, dict):
            continue
        raw_action = str(step.get("action") or "custom")
        action = _normalize_action(raw_action)
        description = str(step.get("description") or "")
        idx = int(step.get("index") or 0)

        if action == "search_page" or raw_action.lower() == "search_page":
            converted = _search_page_to_assert(step, nl_steps, assertion_plan)
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

    def _append_compact(raw_step: dict[str, Any], act: str, loc_list: list) -> None:
        row = _to_compact_step(
            raw_step,
            act,
            loc_list,
            nl_steps,
            used_nl=used_nl,
            nl_budget=nl_budget,
        )
        nl = (row.get("nlStep") or "").strip()
        if nl:
            key = nl.lower()
            used_nl[key] = used_nl.get(key, 0) + 1
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
            # Deduplicate promoted search_page asserts that share the same NL.
            hint = str(step.get("_nlHint") or step.get("description") or "").strip().lower()
            if hint and any(
                (s.get("nlStep") or "").strip().lower() == hint and s.get("action") == "assert"
                for s in compact_steps
            ):
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


def _to_compact_step(
    step: dict[str, Any],
    action: str,
    locs: list[dict[str, Any]],
    nl_steps: list[str],
    *,
    used_nl: dict[str, int] | None = None,
    nl_budget: dict[str, int] | None = None,
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
    nl = str(step.get("_nlHint") or "").strip() or _align_nl_step(
        action,
        value,
        description,
        nl_steps,
        used_nl=used_nl,
        nl_budget=nl_budget,
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
            }
        )
    return rows
