"""Compatibility shim — prefer integrations.browser_use.compact."""
from .compact import (
    COMPACT_WORKFLOW_SCHEMA_VERSION,
    build_compact_workflow,
    compact_steps_to_act_steps,
)

__all__ = [
    "COMPACT_WORKFLOW_SCHEMA_VERSION",
    "build_compact_workflow",
    "compact_steps_to_act_steps",
]
