"""Cross-scenario capability lookup and merge for global knowledge scope."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .capability_contract import migrate_legacy_capability
from .intent_resolver import capability_match_score
from .knowledge import (
    SCENARIOS_DIR,
    _capability_stale,
    find_capability,
    origin_for_url,
    step_signature,
)


def cross_scenario_enabled() -> bool:
    flag = os.environ.get("WEBPILOT_CROSS_SCENARIO", "1").strip().lower()
    return flag not in ("0", "false", "no", "off")


def _capabilities_for_origin(store: dict[str, Any], origin: str) -> list[dict[str, Any]]:
    caps: list[dict[str, Any]] = []
    for item in store.get("capabilities") or []:
        cap_origin = item.get("origin") or origin_for_url(
            (item.get("before") or {}).get("urlPattern", "")
        )
        if cap_origin == origin:
            caps.append(item)
    return caps


def collect_cross_scenario_stores(current_url: str) -> list[dict[str, Any]]:
    """Gather capabilities from peer scenario stores matching the current origin."""
    if not cross_scenario_enabled() or not SCENARIOS_DIR.exists():
        return []
    origin = origin_for_url(current_url)
    stores: list[dict[str, Any]] = []
    for path in sorted(SCENARIOS_DIR.glob("*.json")):
        try:
            import json

            with open(path, encoding="utf-8") as handle:
                store = json.load(handle)
        except Exception:
            continue
        caps = _capabilities_for_origin(store, origin)
        if caps:
            stores.append({"capabilities": caps, "source": str(path.name)})
    return stores


def find_cross_scenario_capability(
    step: str,
    current_url: str,
    page_state: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Best capability from any scenario store for this origin + step."""
    page_state = page_state or {"url": current_url, "urlPattern": current_url, "bodyText": ""}
    signature = step_signature(step)
    candidates: list[dict[str, Any]] = []
    for store in collect_cross_scenario_stores(current_url):
        for item in store.get("capabilities") or []:
            if item.get("stepSignature") != signature:
                continue
            if item.get("status") == "quarantined":
                continue
            if _capability_stale(item):
                continue
            candidates.append(migrate_legacy_capability(item))
    if not candidates:
        return None
    ranked = sorted(
        candidates,
        key=lambda item: capability_match_score(item, step, page_state),
        reverse=True,
    )
    best = ranked[0]
    if capability_match_score(best, step, page_state) < 0:
        return None
    best["importedFrom"] = "cross_scenario"
    return best


def merge_capability_into_page_store(
    page_store: dict[str, Any],
    capability: dict[str, Any],
) -> bool:
    """Upsert a capability into a page-level store (for global promotion)."""
    capabilities = page_store.setdefault("capabilities", [])
    capability_id = capability.get("id")
    if not capability_id:
        return False
    existing = next((item for item in capabilities if item.get("id") == capability_id), None)
    if existing:
        if int(capability.get("successCount", 0)) >= int(existing.get("successCount", 0)):
            capabilities[capabilities.index(existing)] = capability
        return True
    capabilities.append(capability)
    return True


def find_with_cross_scenario_fallback(
    primary_stores: list[dict[str, Any]],
    step: str,
    current_url: str,
    page_state: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    for data in primary_stores:
        found = find_capability(data, step, current_url, page_state)
        if found:
            return found
    return find_cross_scenario_capability(step, current_url, page_state)
