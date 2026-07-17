"""Verify ActHistory locator candidates against a page inventory snapshot.

Uniqueness proof: matchCount === 1 AND matched element is the interacted target
(by backend_node_id when available, else by ax_name + id/href fingerprint).
"""
from __future__ import annotations

import re
from typing import Any

_CSS_ID_RE = re.compile(r"""^[a-zA-Z][\w:-]*\[id=["']([^"']+)["']\]$|^#([\w:-]+)$""")
_CSS_ATTR_RE = re.compile(
    r"""^([a-zA-Z][\w:-]*|a|button|input|\*)\[([a-zA-Z_:][\w:-]*)=["']([^"']*)["']\]$"""
)


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _attrs(el: dict[str, Any]) -> dict[str, str]:
    raw = el.get("attributes") or {}
    return {str(k).lower(): _norm(v) for k, v in raw.items()}


def _ax(el: dict[str, Any]) -> str:
    return _norm(el.get("axName") or _attrs(el).get("aria-label") or "")


def _tag(el: dict[str, Any]) -> str:
    return _norm(el.get("tag") or "*").lower()


def _role_for_element(el: dict[str, Any]) -> str:
    attrs = _attrs(el)
    if attrs.get("role"):
        return attrs["role"].lower()
    tag = _tag(el)
    if tag == "a":
        return "link"
    if tag == "button":
        return "button"
    if tag == "input" and attrs.get("type") in ("submit", "button", "reset"):
        return "button"
    if tag in ("textbox",) or attrs.get("type") in ("text", "search", "email", "password"):
        return "textbox"
    return tag


def _name_matches(el_name: str, needle: str, *, exact: bool) -> bool:
    a = el_name.strip().lower()
    b = needle.strip().lower()
    if not a or not b:
        return False
    if exact:
        return a == b
    return b in a or a.startswith(b)


def _in_scope(el: dict[str, Any], scope: dict[str, Any] | None) -> bool:
    if not scope:
        return True
    kind = str(scope.get("kind") or "").lower()
    value = _norm(scope.get("value") or "").lower()
    name = _norm(scope.get("name") or "").lower()
    ancestors = el.get("ancestors") or []
    xpath = _norm(el.get("xpath") or "").lower()

    if kind == "css":
        if value == "nav" and ("/nav/" in f"/{xpath.strip('/')}/" or any(a.get("tag") == "nav" for a in ancestors)):
            return True
        if value in ("header", "main", "footer") and (
            f"/{value}/" in f"/{xpath.strip('/')}/" or any(a.get("tag") == value for a in ancestors)
        ):
            return True
        if value.startswith("#"):
            sid = value[1:]
            return any(a.get("id") == sid for a in ancestors)
        return any(value in _norm(a.get("tag") or "").lower() for a in ancestors) or value in xpath
    if kind == "role":
        role = value or name
        return any(_norm(a.get("role") or "").lower() == role for a in ancestors) or (
            role == "navigation" and ("/nav/" in f"/{xpath.strip('/')}/" or any(a.get("tag") == "nav" for a in ancestors))
        )
    return True


def element_matches_locator(el: dict[str, Any], locator: dict[str, Any]) -> bool:
    """Playwright-approximate match of one inventory element against a locator candidate."""
    if not _in_scope(el, locator.get("scope") if isinstance(locator.get("scope"), dict) else None):
        return False

    kind = str(locator.get("kind") or "").lower()
    value = _norm(locator.get("value") or "")
    name = _norm(locator.get("name") or locator.get("filterText") or "")
    exact = bool(locator.get("exact")) if locator.get("exact") is not None else True
    attrs = _attrs(el)
    ax = _ax(el)

    if kind == "testid":
        return attrs.get("data-testid") == value or attrs.get("data-test") == value or attrs.get("data-cy") == value

    if kind == "css":
        id_match = _CSS_ID_RE.match(value)
        if id_match:
            el_id = id_match.group(1) or id_match.group(2)
            return attrs.get("id") == el_id
        attr_match = _CSS_ATTR_RE.match(value)
        if attr_match:
            tag_req, attr_name, attr_val = attr_match.group(1), attr_match.group(2).lower(), attr_match.group(3)
            if tag_req not in ("*",) and _tag(el) != tag_req.lower() and tag_req.lower() != "a":
                if tag_req.lower() != _tag(el):
                    return False
            if tag_req.lower() == "a" and _tag(el) != "a":
                return False
            return attrs.get(attr_name) == attr_val
        # Fallback: id= in freeform
        m = re.search(r"""id=["']([^"']+)["']""", value)
        if m:
            return attrs.get("id") == m.group(1)
        m = re.search(r"""href=["']([^"']+)["']""", value)
        if m and _tag(el) == "a":
            return attrs.get("href") == m.group(1)
        return False

    if kind == "role":
        role = value.lower()
        if _role_for_element(el) != role:
            return False
        if not name:
            return True
        return _name_matches(ax, name, exact=exact)

    if kind == "placeholder":
        return attrs.get("placeholder") == value

    if kind == "label":
        return _name_matches(ax, value, exact=exact) or attrs.get("aria-label") == value

    if kind == "text":
        return _name_matches(ax, value, exact=exact)

    if kind == "xpath":
        # Attribute-anchored relative xpaths only
        if "@id=" in value:
            m = re.search(r"""@id=["']([^"']+)["']""", value)
            if m and attrs.get("id") == m.group(1):
                return True
        if "@href=" in value:
            m = re.search(r"""@href=["']([^"']+)["']""", value)
            if m and attrs.get("href") == m.group(1):
                return True
        if "normalize-space" in value and name:
            return _name_matches(ax, name or value, exact=True)
        return False

    return False


def _is_target(el: dict[str, Any], target: dict[str, Any]) -> bool:
    t_backend = target.get("backend_node_id") or target.get("backendNodeId")
    e_backend = el.get("backendNodeId") or el.get("backend_node_id")
    if t_backend is not None and e_backend is not None:
        try:
            return int(t_backend) == int(e_backend)
        except (TypeError, ValueError):
            return str(t_backend) == str(e_backend)

    # Fingerprint fallback when backend ids absent (heal snapshots)
    t_attrs = target.get("attributes") or {}
    e_attrs = _attrs(el)
    for key in ("id", "data-testid", "href"):
        tv = _norm(t_attrs.get(key))
        if tv and e_attrs.get(key) == tv:
            return True
    t_ax = _norm(target.get("ax_name") or target.get("axName"))
    if t_ax and _ax(el) == t_ax and _tag(el) == _norm(target.get("node_name") or target.get("tag") or "").lower():
        return True
    return False


def verify_locators(
    candidates: list[dict[str, Any]],
    *,
    target: dict[str, Any] | None,
    snapshot: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Return candidates that uniquely match the target in the page snapshot.

    Verified locators are marked verified=True, matchCount=1, and sorted:
    id/testid → scoped exact role → exact role → href → text → xpath.
    Unverified candidates are omitted from the primary list return; caller may
    fall back to soft ranking of originals when this returns empty.
    """
    if not candidates or not snapshot or not target:
        return []

    elements = list(snapshot.get("elements") or [])
    if not elements:
        return []

    verified: list[dict[str, Any]] = []
    for cand in candidates:
        matches = [el for el in elements if element_matches_locator(el, cand)]
        count = len(matches)
        if count != 1:
            continue
        if not _is_target(matches[0], target):
            continue
        out = dict(cand)
        out["verified"] = True
        out["verifiedBy"] = "snapshot"
        out["matchCount"] = 1
        verified.append(out)

    def sort_key(item: dict[str, Any]) -> tuple:
        kind = str(item.get("kind") or "")
        value = str(item.get("value") or "")
        has_scope = 1 if item.get("scope") else 0
        if kind == "testid":
            return (0, 0, 0)
        if kind == "css" and ("id=" in value or value.startswith("#") or value.endswith('-tab"]')):
            return (0, 0, 1)
        if kind == "role" and has_scope:
            return (1, 0, 0)
        if kind == "role":
            return (2, 0, 0)
        if kind == "css" and "href=" in value:
            return (3, 0, 0)
        if kind == "text":
            return (4, 0, 0)
        if kind == "xpath":
            return (5, 0, 0)
        return (6, 0, 0)

    verified.sort(key=sort_key)
    return verified
