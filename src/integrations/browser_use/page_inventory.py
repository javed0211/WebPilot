"""Page-centric interactive inventory — shared across scenarios for verified locators.

Store: runtime/page-inventory/<origin>/<pageKey>.json
Keyed by host+path (not step text). Session backend_node_id is for verify only.

Memory ownership:
  Owns — verified page controls + coverage (snapshotQuality / capHit).
  Must not own — action recipes, scenario success, or ActHistory rewrite.

Reuse policy by snapshotQuality:
  complete → prefer | partial/capped → hint | failed → ignore
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .paths import RUNTIME_ROOT

PAGE_INVENTORY_ROOT = RUNTIME_ROOT / "page-inventory"
PAGE_INVENTORY_SCHEMA_VERSION = 2

# Capture caps — missing ≠ absent when capHit/snapshotQuality say so.
INTERACTIVE_ELEMENT_CAP = 120
HEAL_ELEMENT_CAP = 120

_ATTR_KEEP = (
    "id",
    "name",
    "href",
    "role",
    "type",
    "placeholder",
    "aria-label",
    "data-testid",
    "data-test",
    "data-cy",
    "class",
)


def page_key_from_url(url: str | None) -> str | None:
    """Stable key: host + normalized path (no query/fragment)."""
    if not url or not str(url).strip():
        return None
    try:
        parsed = urlparse(str(url).strip())
    except Exception:
        return None
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    # Flatten to filesystem-safe segment
    safe = re.sub(r"[^\w.\-]+", "_", f"{parsed.netloc}{path}").strip("_")
    return safe[:180] or None


def origin_from_url(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(str(url).strip())
    except Exception:
        return None
    if not parsed.netloc:
        return None
    return re.sub(r"[^\w.\-]+", "_", parsed.netloc)[:120]


def inventory_path(url: str | None) -> Path | None:
    origin = origin_from_url(url)
    key = page_key_from_url(url)
    if not origin or not key:
        return None
    return PAGE_INVENTORY_ROOT / origin / f"{key}.json"


def _clean(value: Any, limit: int = 200) -> str:
    if value is None:
        return ""
    text = re.sub(r"[\ue000-\uf8ff]", " ", str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _ancestor_landmarks(node: Any, depth: int = 8) -> list[dict[str, str]]:
    """Walk parent_node for landmark / identifying containers."""
    out: list[dict[str, str]] = []
    current = getattr(node, "parent_node", None)
    hops = 0
    while current is not None and hops < depth:
        hops += 1
        tag = (getattr(current, "tag_name", None) or getattr(current, "node_name", "") or "").lower()
        attrs = dict(getattr(current, "attributes", None) or {})
        role = (attrs.get("role") or "").lower()
        el_id = attrs.get("id") or ""
        testid = attrs.get("data-testid") or attrs.get("data-test") or ""
        landmark = tag in ("nav", "header", "main", "footer", "aside", "form") or role in (
            "navigation",
            "banner",
            "main",
            "contentinfo",
            "complementary",
            "dialog",
            "search",
        )
        if landmark or el_id or testid:
            item: dict[str, str] = {"tag": tag or "*"}
            if role:
                item["role"] = role
            if el_id:
                item["id"] = str(el_id)
            if testid:
                item["testid"] = str(testid)
            out.append(item)
        current = getattr(current, "parent_node", None)
    return out


def serialize_selector_map_element(node: Any) -> dict[str, Any] | None:
    """Compact interactive element from EnhancedDOMTreeNode / selector_map value."""
    if node is None:
        return None
    if isinstance(node, dict):
        tag = (node.get("node_name") or node.get("tag") or "*").lower()
        attrs_raw = dict(node.get("attributes") or {})
        ax = _clean(node.get("ax_name") or attrs_raw.get("aria-label"))
        backend = node.get("backend_node_id")
        xpath = node.get("x_path") or node.get("xpath")
        ancestors = node.get("ancestors") or []
    else:
        tag = (getattr(node, "tag_name", None) or getattr(node, "node_name", "") or "*").lower()
        attrs_raw = dict(getattr(node, "attributes", None) or {})
        ax_node = getattr(node, "ax_node", None)
        ax = _clean(
            (getattr(ax_node, "name", None) if ax_node else None)
            or attrs_raw.get("aria-label")
            or attrs_raw.get("ax_name")
        )
        backend = getattr(node, "backend_node_id", None)
        xpath = getattr(node, "xpath", None) or getattr(node, "x_path", None)
        try:
            xpath = xpath if isinstance(xpath, str) else str(xpath) if xpath else None
        except Exception:
            xpath = None
        ancestors = _ancestor_landmarks(node)

    if ":" in tag:
        tag = tag.split(":")[-1]
    attrs = {k: _clean(attrs_raw.get(k), 120) for k in _ATTR_KEEP if attrs_raw.get(k)}
    # Truncate noisy class lists
    if "class" in attrs and len(attrs["class"]) > 80:
        attrs["class"] = attrs["class"][:80]

    return {
        "backendNodeId": backend,
        "tag": tag or "*",
        "axName": ax or None,
        "attributes": attrs,
        "xpath": _clean(xpath, 300) or None,
        "ancestors": ancestors,
    }


def _coverage_fields(
    *,
    selector_map_size: int,
    interactive_stored: int,
    cap: int,
    source: str,
    ax_nodes_seen: int | None = None,
    verified_controls: int = 0,
    failed: bool = False,
) -> dict[str, Any]:
    """Inventory coverage metadata — reuse policy keys off snapshotQuality."""
    cap_hit = selector_map_size > cap or interactive_stored >= cap
    if failed:
        quality = "failed"
    elif interactive_stored == 0 and selector_map_size == 0:
        quality = "failed"
    elif cap_hit:
        quality = "capped"
    elif interactive_stored < max(1, selector_map_size // 2) and selector_map_size > 10:
        quality = "partial"
    else:
        quality = "complete"
    return {
        "domNodesSeen": selector_map_size,
        "axNodesSeen": ax_nodes_seen if ax_nodes_seen is not None else selector_map_size,
        "interactiveCandidatesSeen": selector_map_size,
        "interactiveCandidatesStored": interactive_stored,
        "verifiedControlsStored": verified_controls,
        "snapshotQuality": quality,
        "capHit": cap_hit,
        "captureCap": cap,
        "captureSource": source,
    }


def inventory_reuse_policy(inventory: dict[str, Any] | None) -> str:
    """How strongly to prefer inventory locators: prefer | hint | ignore."""
    if not inventory:
        return "ignore"
    quality = str(inventory.get("snapshotQuality") or "").lower()
    if quality == "failed":
        return "ignore"
    if quality == "complete":
        return "prefer"
    if quality in ("partial", "capped"):
        return "hint"
    # Legacy snapshots without quality metadata — soft hint only.
    if inventory.get("verifiedLocators") or inventory.get("elements"):
        return "hint"
    return "ignore"


def snapshot_from_browser_state(state: Any) -> dict[str, Any] | None:
    """Build inventory snapshot from BrowserStateSummary (has dom_state.selector_map)."""
    if state is None:
        return None
    url = getattr(state, "url", None) or (state.get("url") if isinstance(state, dict) else None)
    title = getattr(state, "title", None) or (state.get("title") if isinstance(state, dict) else None)
    dom_state = getattr(state, "dom_state", None)
    if dom_state is None and isinstance(state, dict):
        dom_state = state.get("dom_state")
    selector_map = getattr(dom_state, "selector_map", None) if dom_state is not None else None
    if selector_map is None and isinstance(dom_state, dict):
        selector_map = dom_state.get("selector_map")
    if not selector_map:
        key = page_key_from_url(str(url) if url else None)
        return {
            "schemaVersion": PAGE_INVENTORY_SCHEMA_VERSION,
            "pageKey": key,
            "url": str(url) if url else None,
            "title": str(title) if title else None,
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "fingerprint": None,
            "elementCount": 0,
            "elements": [],
            "verifiedLocators": [],
            **_coverage_fields(
                selector_map_size=0,
                interactive_stored=0,
                cap=INTERACTIVE_ELEMENT_CAP,
                source="selector_map",
                failed=True,
            ),
        }

    map_items = list(selector_map.items()) if hasattr(selector_map, "items") else list(selector_map)
    map_size = len(map_items)
    elements: list[dict[str, Any]] = []
    for _idx, node in map_items[:INTERACTIVE_ELEMENT_CAP]:
        serialized = serialize_selector_map_element(node)
        if serialized:
            elements.append(serialized)

    if not elements:
        key = page_key_from_url(str(url) if url else None)
        return {
            "schemaVersion": PAGE_INVENTORY_SCHEMA_VERSION,
            "pageKey": key,
            "url": str(url) if url else None,
            "title": str(title) if title else None,
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "fingerprint": None,
            "elementCount": 0,
            "elements": [],
            "verifiedLocators": [],
            **_coverage_fields(
                selector_map_size=map_size,
                interactive_stored=0,
                cap=INTERACTIVE_ELEMENT_CAP,
                source="selector_map",
                failed=True,
            ),
        }

    key = page_key_from_url(str(url) if url else None)
    fingerprint = hashlib.sha256(
        json.dumps(
            [(e.get("tag"), e.get("axName"), e.get("attributes")) for e in elements[:40]],
            sort_keys=True,
            ensure_ascii=False,
        ).encode("utf-8")
    ).hexdigest()[:16]

    return {
        "schemaVersion": PAGE_INVENTORY_SCHEMA_VERSION,
        "pageKey": key,
        "url": str(url) if url else None,
        "title": str(title) if title else None,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "fingerprint": fingerprint,
        "elementCount": len(elements),
        "elements": elements,
        "verifiedLocators": [],
        **_coverage_fields(
            selector_map_size=map_size,
            interactive_stored=len(elements),
            cap=INTERACTIVE_ELEMENT_CAP,
            source="selector_map",
        ),
    }


def snapshot_from_heal_elements(url: str, title: str, elements: list[dict[str, Any]]) -> dict[str, Any]:
    """Build inventory from Playwright heal pageState (collectPageElements shape)."""
    seen = len(elements or [])
    compact: list[dict[str, Any]] = []
    for el in (elements or [])[:HEAL_ELEMENT_CAP]:
        tag = (el.get("tagName") or el.get("tag") or "*").lower()
        text = _clean(el.get("text") or el.get("axName"))
        attrs: dict[str, str] = {}
        placeholder = el.get("placeholder")
        if placeholder:
            attrs["placeholder"] = _clean(placeholder)
        selector = el.get("selector") or ""
        if selector.startswith("#"):
            attrs["id"] = selector[1:]
        for cand in el.get("selectorCandidates") or []:
            kind = str(cand.get("kind") or "")
            value = str(cand.get("value") or "")
            if kind == "testid" and value:
                attrs["data-testid"] = value
            if kind == "role" and "name=" in value:
                # role[name='X'] already covered by text
                pass
        compact.append(
            {
                "backendNodeId": None,
                "tag": tag,
                "axName": text or None,
                "attributes": attrs,
                "xpath": None,
                "ancestors": [],
            }
        )
    key = page_key_from_url(url)
    fingerprint = hashlib.sha256(
        json.dumps([(e.get("tag"), e.get("axName")) for e in compact[:40]], sort_keys=True).encode()
    ).hexdigest()[:16]
    failed = len(compact) == 0
    return {
        "schemaVersion": PAGE_INVENTORY_SCHEMA_VERSION,
        "pageKey": key,
        "url": url,
        "title": title,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "fingerprint": fingerprint,
        "elementCount": len(compact),
        "elements": compact,
        "verifiedLocators": [],
        **_coverage_fields(
            selector_map_size=seen,
            interactive_stored=len(compact),
            cap=HEAL_ELEMENT_CAP,
            source="heal_page_state",
            failed=failed,
        ),
    }


def load_inventory(url: str | None) -> dict[str, Any] | None:
    path = inventory_path(url)
    if not path or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def upsert_inventory(
    snapshot: dict[str, Any],
    *,
    verified_locator: dict[str, Any] | None = None,
    ax_name: str | None = None,
) -> Path | None:
    """Merge snapshot into disk inventory; optionally record a verified locator."""
    url = snapshot.get("url")
    path = inventory_path(url)
    if not path:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)

    existing = load_inventory(url) or {}
    merged = {
        **existing,
        **snapshot,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "schemaVersion": PAGE_INVENTORY_SCHEMA_VERSION,
    }
    # Prefer denser element lists — never wipe existing elements with an empty upsert
    if (not snapshot.get("elements")) and existing.get("elements"):
        merged["elements"] = existing.get("elements") or []
        merged["elementCount"] = existing.get("elementCount", 0)
    elif existing.get("elementCount", 0) > snapshot.get("elementCount", 0) and snapshot.get("elements"):
        # Keep whichever list is larger unless fingerprint changed
        if snapshot.get("fingerprint") == existing.get("fingerprint"):
            merged["elements"] = existing.get("elements") or snapshot.get("elements") or []
            merged["elementCount"] = max(
                existing.get("elementCount", 0), snapshot.get("elementCount", 0)
            )

    # Preserve / refresh coverage metadata from the denser snapshot
    for cov_key in (
        "domNodesSeen",
        "axNodesSeen",
        "interactiveCandidatesSeen",
        "interactiveCandidatesStored",
        "snapshotQuality",
        "capHit",
        "captureCap",
        "captureSource",
    ):
        if snapshot.get(cov_key) is not None:
            merged[cov_key] = snapshot[cov_key]
        elif existing.get(cov_key) is not None and cov_key not in merged:
            merged[cov_key] = existing[cov_key]

    verified = list(existing.get("verifiedLocators") or [])
    if verified_locator:
        entry = {
            **verified_locator,
            "axName": ax_name or verified_locator.get("axName"),
            "recordedAt": datetime.now(timezone.utc).isoformat(),
        }
        # Dedupe by kind+value+name
        key = (
            str(entry.get("kind")),
            str(entry.get("value")),
            str(entry.get("name") or ""),
        )
        verified = [
            v
            for v in verified
            if (str(v.get("kind")), str(v.get("value")), str(v.get("name") or "")) != key
        ]
        verified.insert(0, entry)
        verified = verified[:40]
    merged["verifiedLocators"] = verified
    merged["verifiedControlsStored"] = len(verified)

    path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def lookup_verified_locators(
    url: str | None,
    ax_name: str | None = None,
    *,
    min_policy: str = "hint",
) -> list[dict[str, Any]]:
    """Read inventory verified locators for a page (optional ax_name filter).

    Reuse policy (snapshotQuality):
      complete → prefer (full list)
      partial/capped → hint (still returned; caller ranks softer)
      failed/missing → ignore (empty)
    min_policy: minimum acceptable policy ('prefer' | 'hint').
    """
    inv = load_inventory(url)
    if not inv:
        return []
    policy = inventory_reuse_policy(inv)
    order = {"ignore": 0, "hint": 1, "prefer": 2}
    if order.get(policy, 0) < order.get(min_policy, 1):
        return []
    locs = list(inv.get("verifiedLocators") or [])
    if not ax_name:
        return locs
    needle = ax_name.strip().lower()
    return [l for l in locs if str(l.get("axName") or l.get("name") or "").strip().lower() == needle]
