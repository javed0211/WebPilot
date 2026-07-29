"""Optional dismiss + hover scaffolds (vocab locator templates)."""
from .engine import _ensure_hover_steps, _ensure_optional_dismiss_steps
from .intent import locator_templates_for_optional

__all__ = [
    "_ensure_hover_steps",
    "_ensure_optional_dismiss_steps",
    "locator_templates_for_optional",
]
