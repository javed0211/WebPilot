"""Multi-dimensional trust scoring for learned capabilities."""
from __future__ import annotations

import datetime
import os
from typing import Any


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def promotion_context() -> dict[str, Any]:
    return {
        "environment": os.environ.get("WEBPILOT_ENV", os.environ.get("WEBPILOT_DEFAULT_ENV", "qa")),
        "freshContext": os.environ.get("WEBPILOT_FRESH_CONTEXT") == "1"
        or os.environ.get("WEBPILOT_RESET_AUTH") == "1",
        "dataSet": os.environ.get("WEBPILOT_DATA_SET", ""),
        "browserProfile": os.environ.get("WEBPILOT_BROWSER_PROFILE", "chromium"),
    }


def record_promotion_trust(capability: dict[str, Any], *, context: dict[str, Any] | None = None) -> None:
    """Append validation context and recompute confidence/status."""
    ctx = context or promotion_context()
    quality = capability.setdefault("quality", {})
    history = quality.setdefault("validationContexts", [])
    history.append({**ctx, "at": _now_iso()})
    history[:] = history[-20:]

    environments = {item.get("environment") for item in history if item.get("environment")}
    quality["environments"] = sorted(environments)
    if ctx.get("freshContext"):
        quality["freshContextSuccesses"] = int(quality.get("freshContextSuccesses", 0)) + 1
    if ctx.get("dataSet"):
        variants = set(quality.get("dataVariants") or [])
        variants.add(ctx["dataSet"])
        quality["dataVariants"] = sorted(variants)

    success = int(capability.get("successCount", 0))
    failure = int(capability.get("failureCount", 0))
    fresh_successes = int(quality.get("freshContextSuccesses", 0))
    base = 0.35 + min(success, 8) * 0.08
    if fresh_successes:
        base += 0.1
    if len(environments) > 1:
        base += 0.05
    if failure:
        base -= min(failure, 3) * 0.12
    quality["confidence"] = round(min(0.99, max(0.1, base)), 2)
    capability["status"] = resolve_trust_status(capability)


def resolve_trust_status(capability: dict[str, Any]) -> str:
    if capability.get("status") == "quarantined":
        return "quarantined"
    success = int(capability.get("successCount", 0))
    quality = capability.get("quality") or {}
    fresh = int(quality.get("freshContextSuccesses", 0))
    confidence = float(quality.get("confidence") or 0)
    if success >= 3 and confidence >= 0.75:
        return "trusted"
    if success >= 2 and (fresh >= 1 or confidence >= 0.7):
        return "trusted"
    if success >= 1:
        return "candidate"
    return "candidate"


def step_signature_changed(capability: dict[str, Any], step: str) -> bool:
    from .knowledge import step_signature

    stored = capability.get("stepSignature") or step_signature(capability.get("step", ""))
    return stored != step_signature(step)


def invalidate_if_step_changed(capability: dict[str, Any], step: str) -> dict[str, Any]:
    """Reset counters when scenario step text changes but id collides."""
    from .knowledge import step_signature as _step_signature

    if not capability.get("step") or not step_signature_changed(capability, step):
        return capability
    capability["successCount"] = 0
    capability["failureCount"] = 0
    capability["status"] = "candidate"
    quality = capability.setdefault("quality", {})
    quality["confidence"] = 0.35
    quality["invalidatedReason"] = "step_signature_changed"
    capability["step"] = step
    capability["stepSignature"] = _step_signature(step)
    return capability
