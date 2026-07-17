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

# Short chrome labels that substring-match unrelated links (GitHub "Actions" vs PR titles).
_AMBIGUOUS_SHORT_NAMES = frozenset(
    {
        "actions",
        "code",
        "security",
        "insights",
        "issues",
        "pull requests",
        "pulse",
        "projects",
        "wiki",
        "settings",
    }
)

_ABSOLUTE_XPATH_RE = re.compile(
    r"^(?:html|/html|/body|body)(/|$)",
    re.IGNORECASE,
)
_STABLE_TAB_ID_RE = re.compile(r"""\[[\s]*id\s*=\s*["']?[\w-]*-tab["']?\]|#([\w-]*-tab)\b""", re.I)
_EXACT_HREF_RE = re.compile(r"""\[[\s]*href\s*=\s*["'][^"'*]+["']\s*\]""")


def _scope_hints_from_element(attrs: dict[str, Any], x_path: str | None) -> list[dict[str, str]]:
    """Derive cheap ancestor scopes from xpath + leaf attrs (no live page probe).

    browser-use uniquely targets via backend_node_id; Playwright cannot use that.
    Transfer uniqueness by scoping leaf semantics to a landmark/container when
    the absolute xpath or class fingerprint implies one.
    """
    scopes: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(kind: str, value: str, name: str | None = None) -> None:
        key = (kind, value if not name else f"{value}:{name}")
        if key in seen:
            return
        seen.add(key)
        item: dict[str, str] = {"kind": kind, "value": value}
        if name:
            item["name"] = name
        scopes.append(item)

    cls = str(attrs.get("class") or "")
    cls_l = cls.lower()
    xp = (x_path or "").replace("\\", "/").lower()
    xp_norm = f"/{xp.strip('/')}/"

    if "underlinenav" in cls_l or "js-responsive-underlinenav" in cls_l:
        add("css", "nav")
        add("role", "navigation")
    if "/nav/" in xp_norm:
        add("css", "nav")
        add("role", "navigation")
    if "/header/" in xp_norm:
        add("css", "header")
        add("role", "banner")
    if "/main/" in xp_norm:
        add("css", "main")
        add("role", "main")
    if "/footer/" in xp_norm:
        add("css", "footer")
        add("role", "contentinfo")
    if "menu-item" in cls_l or "js-selected-navigation-item" in cls_l:
        # Side menus (GitHub Insights → Pulse) live under nav without UnderlineNav.
        add("css", "nav")

    return scopes


def _role_locator(
    role: str,
    accessible_name: str,
    *,
    scope: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Semantic role locator with exact match + optional ancestor scope."""
    loc: dict[str, Any] = {
        "kind": "role",
        "value": role,
        "name": accessible_name,
        "filterText": accessible_name,
        "exact": True,
    }
    if scope:
        loc["scope"] = scope
    return loc


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


def _filter_locators_for_action(action: str, locators: list[dict[str, str]]) -> list[dict[str, str]]:
    """Drop skip-link / anchor locators for fill/input — they break Playwright replay."""
    if action not in ("input", "fill"):
        return locators
    bad_fragments = ("#main", "skip to main", "skip to content")
    filtered: list[dict[str, str]] = []
    for loc in locators:
        blob = f"{loc.get('kind','')}:{loc.get('value','')}:{loc.get('name','')}".lower()
        if any(b in blob for b in bad_fragments):
            continue
        if loc.get("kind") == "role" and loc.get("value") == "link":
            continue
        if loc.get("kind") == "css" and "a[href" in blob and "#main" in blob:
            continue
        filtered.append(loc)
    return filtered if filtered else locators


def locator_stability_score(item: dict[str, str]) -> float:
    """Soft fallback score when DOM verify is unavailable or finds no unique match.

    Not uniqueness proof — prefer verify_locators() / verified=True instead.
    """
    kind = str(item.get("kind") or "css").lower()
    value = str(item.get("value") or "")
    name = str(item.get("name") or item.get("filterText") or "")
    # Kind bases aligned with SelectorRanker (TS) — capture must match codegen intent.
    score = {
        "role": 0.90,
        "label": 0.86,
        "placeholder": 0.82,
        "testid": 0.80,
        "text": 0.68,
        "css": 0.50,
        "xpath": 0.25,
    }.get(kind, 0.20)

    if kind == "role" and name:
        score += 0.04
        lowered = name.strip().lower()
        if lowered in _AMBIGUOUS_SHORT_NAMES:
            # Page-wide role is unsafe; scoped role is a real uniqueness strategy.
            score -= 0.10 if item.get("scope") else 0.35
        if len(name) > 40 or re.search(r"\[ctrl|\[alt|\[shift|\[cmd", name, re.I):
            score -= 0.25
        if re.search(r"\s+\d+$", name.strip()):
            score -= 0.22  # "Issues 149" — prefer id=issues-tab
        if len(name.strip().split()) >= 2 and lowered not in _AMBIGUOUS_SHORT_NAMES:
            score += 0.10
        if "/" in name or "." in name:
            score += 0.05  # path-like names are usually unique with exact match

    if item.get("exact"):
        score += 0.05
    if item.get("scope"):
        # Scope transfers browser-use uniqueness; text scopes are weak (many matches).
        score += 0.05 if kind == "text" else 0.20

    if kind == "css":
        if _STABLE_TAB_ID_RE.search(value) or value.endswith('-tab"]') or value.endswith("-tab']"):
            score += 0.55  # strongest transferable unique attr (id=*-tab)
        elif re.search(r"""\[[\s]*id\s*=\s*["'][^"']+["']\]""", value):
            score += 0.40  # any id attribute
        if _EXACT_HREF_RE.search(value):
            score += 0.22
        if re.search(r"nth-child|nth-of-type|:[a-z]{3,}\(", value):
            score -= 0.15

    if kind == "testid":
        score += 0.12  # unique test ids rival element ids
    if kind == "text":
        lowered = name.strip().lower() or value.strip().lower()
        if lowered in _AMBIGUOUS_SHORT_NAMES:
            score -= 0.25
    if kind == "xpath":
        score -= 0.05

    return score


def uniqueness_tier(item: dict[str, Any]) -> int:
    """Soft fallback ordering tier (NOT DOM uniqueness proof).

    Prefer candidates with verified=True from locator_verifier.
    Lower tier = preferred among unverified fallbacks only.
    """
    kind = str(item.get("kind") or "css").lower()
    value = str(item.get("value") or "")
    if kind == "testid":
        return 0
    if kind == "css" and (
        _STABLE_TAB_ID_RE.search(value)
        or value.endswith('-tab"]')
        or value.endswith("-tab']")
        or re.search(r"""\[[\s]*id\s*=\s*["'][^"']+["']\]""", value)
    ):
        return 0
    if item.get("scope") and kind in ("role", "css", "text"):
        return 1
    if kind in ("role", "label", "placeholder") and (item.get("exact") or item.get("name")):
        return 2
    if kind == "css" and _EXACT_HREF_RE.search(value):
        return 3
    if kind == "text":
        return 4
    if kind == "xpath":
        return 5
    return 3


def rank_locator_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Dedupe and order locators. Verified (DOM-proven) candidates always lead."""
    seen: set[tuple[str, str, str, str]] = set()
    unique: list[dict[str, Any]] = []
    for candidate in candidates:
        if candidate.get("kind") == "xpath" and _is_absolute_xpath(candidate.get("value")):
            continue
        scope = candidate.get("scope") or {}
        scope_key = ""
        if isinstance(scope, dict):
            scope_key = f"{scope.get('kind','')}:{scope.get('value','')}:{scope.get('name','')}"
        key = (
            str(candidate.get("kind", "")),
            str(candidate.get("value", candidate.get("name", ""))),
            str(candidate.get("name", "")),
            scope_key,
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)

    unique.sort(
        key=lambda item: (
            0 if item.get("verified") else 1,  # DOM-proven first
            uniqueness_tier(item),
            -locator_stability_score(item),
            _LOCATOR_KIND_PRIORITY.get(item.get("kind", "css"), 99),
            len(str(item.get("name", item.get("value", "")))),
        )
    )
    return unique


def _prefer_inventory_locators(
    page_url: str | None,
    accessible_name: str,
    generated: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Phase 3: prepend inventory-verified locators for known page+axName (token save).

    Reuse policy: complete=prefer, partial/capped=hint, failed=ignore.
    """
    if not page_url:
        return generated
    try:
        from .page_inventory import inventory_reuse_policy, load_inventory, lookup_verified_locators

        inv = load_inventory(page_url)
        policy = inventory_reuse_policy(inv)
        if policy == "ignore":
            return generated
        known = lookup_verified_locators(page_url, accessible_name or None, min_policy="hint")
    except Exception:
        return generated
    if not known:
        try:
            from .page_inventory import lookup_verified_locators as lookup

            known = lookup(page_url, None, min_policy="hint")[:3] if not accessible_name else []
        except Exception:
            known = []
    if not known:
        return generated

    prepended: list[dict[str, Any]] = []
    for loc in known:
        item = {
            k: v
            for k, v in loc.items()
            if k in ("kind", "value", "name", "exact", "scope", "filterText", "tag", "verifiedBy")
        }
        if not item.get("kind"):
            continue
        item["verified"] = True
        item["matchCount"] = 1
        item["inventoryPolicy"] = policy
        if accessible_name and not item.get("name") and item.get("kind") == "role":
            item["name"] = accessible_name
            item["filterText"] = accessible_name
        prepended.append(item)
    if not prepended:
        return generated
    # Strong prefer: inventory first. Hint: still prepend but keep generated high in mix.
    if policy == "prefer":
        return rank_locator_candidates(prepended + list(generated))[:12]
    merged = rank_locator_candidates(list(generated) + prepended)[:12]
    # Ensure at least one inventory hint stays near the front
    head = prepended[0]
    head_key = (
        str(head.get("kind")),
        str(head.get("value")),
        str(head.get("name") or ""),
    )
    if not any(
        (str(m.get("kind")), str(m.get("value")), str(m.get("name") or "")) == head_key
        for m in merged[:3]
    ):
        merged = [head] + [
            m
            for m in merged
            if (str(m.get("kind")), str(m.get("value")), str(m.get("name") or "")) != head_key
        ][:11]
    return merged


def locator_candidates_from_element(element: Any, page_url: str | None = None) -> list[dict[str, str]]:
    """Emit Playwright locator candidates from an interacted element.

    Candidate *generation* only — uniqueness is proven later by locator_verifier
    against a page inventory snapshot (selector_map). Soft ranking is fallback.
    Absolute html/body xpaths are never stored.
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
    x_path = str(data.get("x_path") or "") or None
    scopes = _scope_hints_from_element(attrs, x_path)
    primary_scope = scopes[0] if scopes else None
    candidates: list[dict[str, Any]] = []

    def add_role(role: str) -> None:
        if not accessible_name:
            return
        # Unscoped exact role (still may collide page-wide).
        candidates.append(_role_locator(role, accessible_name))
        # Scoped variant — uniqueness strategy when ancestor landmark is known.
        if primary_scope:
            candidates.append(_role_locator(role, accessible_name, scope=primary_scope))

    if tag == "a":
        add_role("link")
    if tag == "button":
        add_role("button")
    if tag == "input" and input_type in ("submit", "button"):
        add_role("button")
    role = attrs.get("role")
    if role:
        add_role(str(role))
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
        css: dict[str, Any] = {"kind": "css", "value": f'a[href="{href}"]'}
        if accessible_name:
            css["filterText"] = accessible_name
        if primary_scope:
            css["scope"] = primary_scope
            candidates.append(dict(css))  # scoped href
        candidates.append({k: v for k, v in css.items() if k != "scope"})
    if text and len(text) <= 120:
        text_loc: dict[str, Any] = {
            "kind": "text",
            "value": text,
            "tag": tag,
            "filterText": text,
            "exact": True,
        }
        candidates.append(text_loc)
        if primary_scope:
            candidates.append({**text_loc, "scope": primary_scope})

    candidates.extend(
        _relative_xpath_candidates(
            tag,
            attrs,
            accessible_name,
            absolute_xpath=x_path,
        )
    )

    ranked = rank_locator_candidates(candidates)[:12]
    return _prefer_inventory_locators(page_url, accessible_name, ranked)


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


def _snapshot_for_url(
    page_url: str | None,
    page_snapshots: dict[str, dict[str, Any]] | None,
) -> dict[str, Any] | None:
    if not page_snapshots or not page_url:
        return None
    from .page_inventory import page_key_from_url

    key = page_key_from_url(page_url)
    if key and key in page_snapshots:
        return page_snapshots[key]
    # Exact URL fallback
    if page_url in page_snapshots:
        return page_snapshots[page_url]
    return None


def _apply_locator_verification(
    locators: list[dict[str, Any]],
    *,
    element_dict: dict[str, Any] | None,
    page_url: str | None,
    page_snapshots: dict[str, dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], bool]:
    """Prefer DOM-verified unique locators; soft-rank originals if none verify."""
    if not locators or not element_dict:
        return locators, False
    snapshot = _snapshot_for_url(page_url, page_snapshots)
    if not snapshot:
        # Try persisted inventory for this URL (cross-run / Phase 3)
        try:
            from .page_inventory import load_inventory

            snapshot = load_inventory(page_url)
        except Exception:
            snapshot = None
    if not snapshot:
        return rank_locator_candidates(locators), False

    from .locator_verifier import verify_locators

    verified = verify_locators(locators, target=element_dict, snapshot=snapshot)
    if verified:
        # Keep a few unverified fallbacks after proven ones
        verified_keys = {
            (
                str(v.get("kind")),
                str(v.get("value")),
                str(v.get("name") or ""),
                str((v.get("scope") or {}).get("value") or ""),
            )
            for v in verified
        }
        extras = [
            loc
            for loc in rank_locator_candidates(locators)
            if (
                str(loc.get("kind")),
                str(loc.get("value")),
                str(loc.get("name") or ""),
                str((loc.get("scope") or {}).get("value") or ""),
            )
            not in verified_keys
        ][:4]
        return verified + extras, True
    return rank_locator_candidates(locators), False


def build_act_history(
    history_list: Any,
    page_snapshots: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """
    Build ActHistory steps strictly from browser-use AgentHistoryList.

    When page_snapshots (selector_map inventories keyed by pageKey) are provided,
    locators are DOM-verified for uniqueness before write.

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
                locators = (
                    locator_candidates_from_element(element, page_url=page_url)
                    if element_dict
                    else []
                )
                locators = _filter_locators_for_action(action, locators)
                locators, was_verified = _apply_locator_verification(
                    locators,
                    element_dict=element_dict,
                    page_url=page_url,
                    page_snapshots=page_snapshots,
                )

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
                if element_dict and action in ("click", "input", "fill") and locators:
                    if was_verified:
                        step["locatorVerified"] = True
                    else:
                        step["locatorUnverified"] = True
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
            page_url = params.get("url")
            locators = (
                locator_candidates_from_element(element, page_url=page_url)
                if element_dict
                else []
            )
            locators = _filter_locators_for_action(action, locators)
            locators, was_verified = _apply_locator_verification(
                locators,
                element_dict=element_dict,
                page_url=page_url,
                page_snapshots=page_snapshots,
            )
            value = params.get("text") or params.get("url") or params.get("keys") or params.get("key")
            step = {
                "index": len(steps) + 1,
                "action": action if action != "custom" else name,
                "selector": json.dumps(locators, ensure_ascii=False) if locators else None,
                "value": None if value is None else str(value),
                "url": page_url,
                "description": f"{action}",
                "pageTitle": None,
                "elementIndex": params.get("index"),
                "element": element_dict,
                "locators": locators,
                "agentStep": None,
                "actionParams": params,
            }
            if element_dict and action in ("click", "input", "fill") and locators:
                if was_verified:
                    step["locatorVerified"] = True
                else:
                    step["locatorUnverified"] = True
            steps.append(step)
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
