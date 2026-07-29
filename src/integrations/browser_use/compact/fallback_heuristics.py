"""Legacy site-regex fallback — only when WEBPILOT_COMPACT_HEURISTICS=1.

Primary coverage uses SiteVocab. This module exists so old Python site
dictionaries can still be applied as an explicit escape hatch.
"""
from __future__ import annotations

from typing import Any


def apply_legacy_site_heuristics(
    compact: dict[str, Any],
    act_steps: list[dict[str, Any]],
    nl_steps: list[str],
    assertion_plan: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """
    No-op rebuild marker. Site patterns now live in vocab.json; enabling
    heuristics only records that the escape hatch was requested. Extend here
    only for emergency patches that cannot yet be expressed as vocab.
    """
    del act_steps, nl_steps, assertion_plan
    compact.setdefault("meta", {})["heuristicsFallback"] = True
    return compact
