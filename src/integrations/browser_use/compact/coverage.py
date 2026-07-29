"""Coverage classification — hard vs soft statuses."""
from .engine import _coverage

HARD_STATUSES = frozenset({"notExecuted", "misbound", "assertHollow"})
SOFT_STATUSES = frozenset({"optionalSkipped", "softCovered"})
PASS_STATUSES = frozenset({"executed", "assertGrounded"})

compute_coverage = _coverage

__all__ = [
    "HARD_STATUSES",
    "PASS_STATUSES",
    "SOFT_STATUSES",
    "_coverage",
    "compute_coverage",
]
