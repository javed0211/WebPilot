"""Failure-classified repair prompts for scoped browser-use discovery."""
from __future__ import annotations

from typing import Any

from .capability_contract import classify_failure, resolve_validation_contract
from .intent_resolver import detect_page_type, resolve_step_intent


def failure_repair_hints(
    failure_class: str | None,
    failure_reason: str,
    *,
    capability: dict[str, Any] | None = None,
    page_state: dict[str, Any] | None = None,
) -> list[str]:
    hints: list[str] = []
    reason = (failure_reason or "").lower()
    page_state = page_state or {}

    if failure_class == "auth_required" or "auth" in reason:
        hints.extend([
            "An authentication interstitial is blocking this step.",
            "Complete login / Stay signed in / app selection before the business action.",
            "Do not call done(success=true) while on login.microsoftonline.com or a Sign in page.",
        ])
    if failure_class == "locator_not_found" or "locator" in reason or "deterministic action failed" in reason:
        hints.extend([
            "The recorded locators no longer match the page — find the control by role, label, and visible name.",
            "Prefer getByRole / getByLabel; avoid stale CSS ids.",
            "Re-read the DOM; do not assume elements from prior attempts exist.",
        ])
    if failure_class in ("postcondition_failed", "precondition_failed", "validation_failed"):
        hints.append("The previous replay reached the wrong page state — verify URL, headings, and shell anchors.")
        if capability:
            phase = "post" if failure_class == "postcondition_failed" else "pre"
            contract = resolve_validation_contract(capability, phase)
            if contract.get("urlRegex"):
                hints.append(f"Expected URL/origin matching: {contract['urlRegex']}")
            forbidden = contract.get("notAllowedAnchors") or contract.get("forbiddenText") or []
            if forbidden:
                hints.append(f"These phrases must NOT be visible: {', '.join(forbidden[:4])}")
            required = contract.get("requiredText") or []
            for text in required[:3]:
                hints.append(f"Page should contain: {text}")
            evidence = contract.get("requiredEvidence") or []
            for item in evidence[:2]:
                if item.get("text"):
                    hints.append(f"Expected visible text: {item['text']}")
    if failure_class == "side_effect_blocked":
        hints.append("This step mutates data — perform the action once only; do not repeat submits.")
    if failure_class == "permission_denied":
        hints.append("Check user role/permissions for this environment.")
    if failure_class == "timeout":
        hints.append("Wait for navigation/spinner to finish before done(success=true).")

    page_type = detect_page_type(page_state)
    if page_type == "auth_interstitial":
        hints.append(f"Current pageType={page_type} — finish auth before this step.")
    return hints


def build_scoped_task(
    sanitized_step: str,
    step: str,
    *,
    page_state: dict[str, Any],
    credential_suffix: str,
    discovery_rules: str,
    repair_mode: bool = False,
    failure_class: str | None = None,
    failure_reason: str = "",
    capability: dict[str, Any] | None = None,
) -> str:
    resolved = resolve_step_intent(step)
    page_type = detect_page_type(page_state)
    lines = [
        f"Execute ONLY this single test step and stop:\n{sanitized_step}\n",
        f"Resolved intent: action={resolved.get('action')} pageType={page_type}",
    ]
    if repair_mode:
        lines.append("\n=== REPAIR MODE ===")
        lines.append(f"Prior attempt failed ({failure_class or classify_failure(failure_reason)}): {failure_reason}")
        for hint in failure_repair_hints(
            failure_class or classify_failure(failure_reason),
            failure_reason,
            capability=capability,
            page_state=page_state,
        ):
            lines.append(f"- {hint}")
    lines.extend([
        "\nRules:",
        "- Do not execute any other steps from the scenario.",
        "- Preserve the current browser session state (cookies, cart, form data).",
        "- If a cookie/consent banner overlays the page, dismiss it first (Accept / Accept all cookies / Consent) before the primary action.",
        "- Call done(success=true) only when this step's observable outcome is satisfied.",
        "- After you click/type, if the UI advanced (target control gone because the form progressed, password field appeared, URL changed), that IS success — call done(success=true) immediately.",
        "- Never call done(success=false) only because the clicked control is missing AFTER a successful click or navigation.",
        "- If the UI is ambiguous, prefer the smallest action sequence that completes this step.",
        "- The step instruction describes USER INTENT — it is NOT an element label.",
        "- Your memory must reflect the CURRENT page state only — not invented prior sessions.",
        credential_suffix,
        "\n=== LOCATOR STRATEGY (mandatory) ===",
        discovery_rules,
    ])
    return "\n".join(line for line in lines if line)
