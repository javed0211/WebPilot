"""Public API for compact workflow builds."""
from __future__ import annotations

from typing import Any

from .engine import (
    COMPACT_WORKFLOW_SCHEMA_VERSION,
    build_compact_workflow as _engine_build,
    compact_steps_to_act_steps,
)
from .llm_align import maybe_llm_align
from .vocab_context import heuristics_enabled, llm_align_enabled


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
    Build compactWorkflow via vocab-driven evidence alignment.

    Binding order: SiteVocab + evidence → soft/hard classify → optional LLM
    align (off) → legacy heuristics only if WEBPILOT_COMPACT_HEURISTICS=1.
    """
    # Infer url from first navigate when caller omitted it.
    if not url:
        for step in act_steps or []:
            if not isinstance(step, dict):
                continue
            action = str(step.get("action") or "").lower()
            if action in ("navigate", "goto", "go_to", "open"):
                candidate = str(step.get("url") or step.get("value") or "").strip()
                if candidate.startswith("http"):
                    url = candidate
                    break

    compact = _engine_build(
        act_steps,
        nl_steps,
        assertion_plan,
        native_captured_actions=native_captured_actions,
        source=source,
        url=url,
        site_pack=site_pack,
        vocab=vocab,
    )

    if llm_align_enabled():
        compact = maybe_llm_align(compact, nl_steps or [], act_steps or [])

    if heuristics_enabled():
        from .fallback_heuristics import apply_legacy_site_heuristics

        compact = apply_legacy_site_heuristics(
            compact,
            act_steps or [],
            nl_steps or [],
            assertion_plan,
        )

    compact["schemaVersion"] = COMPACT_WORKFLOW_SCHEMA_VERSION
    return compact


__all__ = [
    "COMPACT_WORKFLOW_SCHEMA_VERSION",
    "build_compact_workflow",
    "compact_steps_to_act_steps",
]
