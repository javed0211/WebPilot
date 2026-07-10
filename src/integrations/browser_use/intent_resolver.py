"""Generic step intent resolution and page-type detection for capability matching."""
from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import urlparse

from .capability_contract import AUTH_INTERSTITIAL_PHRASES, AUTH_RELAXED_ORIGINS, infer_intent, origin_for_url

# CRM / SaaS shells — detected from URL + body (generic, not vendor-specific only).
SHELL_URL_HINTS = (
    "dynamics.com",
    "salesforce.com",
    "service-now.com",
    "servicenow.com",
    "lightning.force.com",
    "sharepoint.com",
    "office.com",
    "portal.azure",
)

ENTITY_LIST_BODY_HINTS = (
    "active accounts",
    "new",
    "export",
    "account name",
    "entity list",
    "records",
    "rows",
    "filter",
)

APP_SHELL_BODY_HINTS = (
    "sales",
    "service",
    "settings",
    "dashboard",
    "home",
    "navigation",
    "apps",
)

APP_SWITCHER_STEP_HINTS = (
    "application",
    "app launcher",
    "switch app",
    "change app",
    "change the application",
    "waffle",
    "app picker",
    "select app",
)


def _quoted_values(step: str) -> list[str]:
    return re.findall(r'["\']([^"\']+)["\']', step)


def resolve_step_intent(step: str) -> dict[str, Any]:
    """Normalize NL step into structured intent for matching and storage."""
    lowered = step.strip().lower()
    base_intent = infer_intent(step)
    quoted = _quoted_values(step)
    target_label = quoted[0] if quoted else ""
    entity = ""
    action = base_intent

    if re.search(r"\bopen\b", lowered) and quoted:
        action = "open_record"
        target_label = quoted[0]
        entity = _infer_entity(lowered, quoted[0])
    elif re.search(r"\b(search|find|lookup)\b", lowered):
        action = "search"
        if quoted:
            target_label = quoted[0]
    elif re.search(r"\b(click|press|tap|select)\b", lowered):
        action = "click"
        if any(hint in lowered for hint in APP_SWITCHER_STEP_HINTS):
            action = "switch_application"
    elif re.search(r"\b(create|add new)\b", lowered):
        action = "create_record"
        entity = _infer_entity(lowered, target_label)
    elif base_intent == "navigate":
        action = "navigate"
        url_match = re.search(r"(https?://\S+)", step, re.IGNORECASE)
        if url_match:
            target_label = url_match.group(1).rstrip(".,;")
    elif base_intent == "authenticate":
        action = "authenticate"

    page_type_hint = _page_type_hint_from_step(lowered)
    return {
        "intent": base_intent,
        "action": action,
        "entity": entity,
        "targetLabel": target_label,
        "pageTypeHint": page_type_hint,
        "stepTokens": sorted(_word_tokens(step)),
    }


def _infer_entity(lowered: str, target: str) -> str:
    for entity in (
        "account",
        "contact",
        "lead",
        "opportunity",
        "case",
        "order",
        "invoice",
        "customer",
        "user",
        "product",
        "claim",
        "policy",
    ):
        if entity in lowered:
            return entity
    if target and not target.startswith("http"):
        return "record"
    return ""


def _page_type_hint_from_step(lowered: str) -> str:
    if any(h in lowered for h in APP_SWITCHER_STEP_HINTS):
        return "app_switcher"
    if re.search(r"\b(login|sign[\s-]?in|authenticate|password)\b", lowered):
        return "auth_interstitial"
    if re.match(r"^(goto|navigate|go to)\b", lowered):
        return "navigation"
    if re.match(r"^(verify|assert|check|ensure)\b", lowered):
        return "verification"
    return ""


def _word_tokens(step: str) -> set[str]:
    return {
        word
        for word in re.findall(r"[a-z0-9]+", step.lower())
        if word not in {"the", "a", "an", "to", "in", "on", "and", "of", "is", "are", "for"}
    }


def detect_page_type(page_state: dict[str, Any]) -> str:
    """Classify current page for capability preconditions (generic SaaS/CRM)."""
    url = (page_state.get("url") or "").lower()
    body = (page_state.get("bodyText") or "").lower()
    origin = origin_for_url(url)

    if origin in AUTH_RELAXED_ORIGINS or any(p in body for p in AUTH_INTERSTITIAL_PHRASES):
        return "auth_interstitial"

    if any(hint in url for hint in SHELL_URL_HINTS):
        if any(hint in body for hint in ENTITY_LIST_BODY_HINTS):
            return "entity_list"
        if any(hint in body for hint in APP_SHELL_BODY_HINTS):
            return "app_shell"
        return "app_shell"

    if page_state.get("title", "").lower().find("sign in") >= 0:
        return "auth_interstitial"

    evidence = page_state.get("evidence") or []
    evidence_text = " ".join((item.get("text") or "") for item in evidence).lower()
    if any(hint in evidence_text for hint in ENTITY_LIST_BODY_HINTS):
        return "entity_list"

    path = urlparse(url).path.lower()
    if any(seg in path for seg in ("login", "signin", "sign-in", "oauth", "authorize", "kmsi")):
        return "auth_interstitial"
    if any(seg in path for seg in ("list", "grid", "search", "entity")):
        return "entity_list"
    if any(seg in path for seg in ("form", "edit", "create", "new")):
        return "form"

    return "generic"


def capability_match_score(
    capability: dict[str, Any],
    step: str,
    page_state: dict[str, Any],
) -> float:
    """Rank capabilities: step signature is required; score disambiguates duplicates."""
    resolved = resolve_step_intent(step)
    page_type = detect_page_type(page_state)
    score = 0.0

    cap_intent = capability.get("intentDescriptor") or {}
    if not cap_intent:
        cap_intent = {
            "intent": capability.get("intent", ""),
            "action": capability.get("intent", ""),
            "pageTypeHint": capability.get("pageType", ""),
        }

    if cap_intent.get("action") == resolved.get("action"):
        score += 3.0
    elif cap_intent.get("intent") == resolved.get("intent"):
        score += 1.5

    cap_page = capability.get("pageType") or cap_intent.get("pageTypeHint") or ""
    if cap_page and cap_page == page_type:
        score += 2.0
    elif cap_page and cap_page != page_type:
        score -= 1.0

    if resolved.get("targetLabel") and cap_intent.get("targetLabel"):
        if resolved["targetLabel"].lower() == cap_intent["targetLabel"].lower():
            score += 2.0

    if resolved.get("entity") and cap_intent.get("entity") == resolved.get("entity"):
        score += 1.0

    score += float((capability.get("quality") or {}).get("confidence") or 0) * 0.5
    score += min(int(capability.get("successCount", 0)), 5) * 0.2
    return score


def build_capability_identity(
    step: str,
    before: dict[str, Any],
    after: dict[str, Any],
    page_type: str,
) -> str:
    resolved = resolve_step_intent(step)
    parts = [
        step_signature(step),
        resolved.get("action", ""),
        resolved.get("entity", ""),
        resolved.get("targetLabel", "")[:80],
        page_type,
        before.get("urlPattern", ""),
        after.get("urlPattern", ""),
    ]
    return "|".join(parts)


def step_signature(step: str) -> str:
    return re.sub(r"\s+", " ", step.strip().lower())


def capability_id_from_identity(identity: str) -> str:
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]


def attach_intent_descriptor(
    capability: dict[str, Any],
    step: str,
    page_state: dict[str, Any],
) -> dict[str, Any]:
    resolved = resolve_step_intent(step)
    page_type = detect_page_type(page_state)
    capability["intentDescriptor"] = resolved
    capability["pageType"] = page_type
    pre = capability.setdefault("preconditions", {})
    pre["pageType"] = page_type
    return capability
