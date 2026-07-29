"""Optional LLM residual binder — off by default (WEBPILOT_COMPACT_LLM_ALIGN=1).

May only propose NL↔existing-act bindings; never invents acts.
"""
from __future__ import annotations

from typing import Any


def maybe_llm_align(
    compact: dict[str, Any],
    nl_steps: list[str],
    act_steps: list[dict[str, Any]],
) -> dict[str, Any]:
    """Stub: LLM align is not implemented in-process; returns compact unchanged."""
    del nl_steps, act_steps
    cov = compact.get("coverage") or {}
    if cov.get("unmapped"):
        # Marker so reports show LLM align was requested but not applied.
        compact.setdefault("meta", {})["llmAlign"] = "skipped-no-provider"
    return compact
