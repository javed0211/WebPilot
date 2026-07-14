"""Generic capability contract: intent, safety, pre/post validation, failure classification."""
from __future__ import annotations

import re
from typing import Any, Literal
from urllib.parse import urlparse

from .credentials import is_credential_step

SCHEMA_VERSION = 5

AUTH_RELAXED_ORIGINS = frozenset({
    "login.microsoftonline.com",
    "login.live.com",
    "login.microsoft.com",
    "account.live.com",
})

# Visible copy that usually means an auth/interstitial screen — generic across IdPs.
AUTH_INTERSTITIAL_PHRASES = (
    "stay signed in",
    "sign in",
    "pick an account",
    "enter password",
    "use another account",
    "verify your identity",
    "enter code",
)

QUARANTINE_FAILURE_CLASSES = frozenset({
    "locator_not_found",
    "postcondition_failed",
    "validation_failed",
})

Phase = Literal["pre", "post"]


def origin_for_url(url: str) -> str:
    parsed = urlparse(url or "")
    return parsed.netloc.lower() or "_global"


def url_pattern(url: str) -> str:
    parsed = urlparse(url or "about:blank")
    if parsed.scheme in ("http", "https"):
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path or '/'}"
    return url or "about:blank"


def infer_intent(step: str) -> str:
    lowered = step.strip().lower()
    if re.match(r"^(goto|navigate|go to)\b", lowered):
        return "navigate"
    if is_credential_step(step) or re.search(r"\b(login|sign[\s-]?in|authenticate)\b", lowered):
        return "authenticate"
    if re.match(r"^(verify|assert|check|ensure|then)\b", lowered):
        return "verify"
    if re.search(r"\b(delete|remove|purge)\b", lowered):
        return "delete"
    if re.search(r"\b(create|add new|submit|send|approve|publish)\b", lowered):
        return "mutate"
    if re.search(r"\b(click|press|tap|select|open|choose)\b", lowered):
        return "interact"
    if re.search(r"\b(enter|type|fill|input)\b", lowered):
        return "input"
    return "generic"


def infer_safety(intent: str, step: str) -> dict[str, Any]:
    lowered = step.lower()
    if intent in ("delete", "mutate") or re.search(
        r"\b(delete|remove|submit|send|approve|create|publish|charge|pay)\b",
        lowered,
    ):
        return {
            "sideEffect": "mutates_state" if intent != "delete" else "destructive",
            "safeToReplay": False,
            "requiresConfirmation": True,
        }
    return {
        "sideEffect": "none",
        "safeToReplay": True,
        "requiresConfirmation": False,
    }


def is_navigable_url(value: str) -> bool:
    """True only for absolute http(s) URLs — not NL navigation targets like CRM subareas."""
    candidate = (value or "").strip().strip('"\'')
    if not candidate:
        return False
    parsed = urlparse(candidate)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _extract_navigate_target(step: str) -> str | None:
    quoted = re.search(r'["\'](https?://[^"\']+)["\']', step, re.IGNORECASE)
    if quoted:
        target = quoted.group(1)
        return target if is_navigable_url(target) else None
    bare = re.search(r"(https?://\S+)", step, re.IGNORECASE)
    if not bare:
        return None
    target = bare.group(1).rstrip(".,;")
    return target if is_navigable_url(target) else None


def resolve_navigate_target(step: str) -> str | None:
    """Extract a browser URL from goto/navigate steps; ignore in-app NL navigation."""
    stripped = step.strip()
    for prefix in (r"^goto\s+", r"^go to\s+", r"^navigate to\s+"):
        if re.match(prefix, stripped, re.IGNORECASE):
            remainder = re.sub(prefix, "", stripped, flags=re.IGNORECASE).strip().strip('"\'').rstrip(".")
            return remainder if is_navigable_url(remainder) else None
    return _extract_navigate_target(step)


def _normalize_required_text(value: str) -> str:
    """Strip ZWSP / soft hyphens and collapse whitespace for replay contracts."""
    cleaned = (value or "").replace("\u200b", "").replace("\ufeff", "").replace("\u00ad", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def build_postconditions(intent: str, step: str, before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    post: dict[str, Any] = {
        "urlPattern": after.get("urlPattern"),
        "requiredAnchors": [],
        "notAllowedAnchors": [],
        "requiredEvidence": [],
        "requiredText": [],
        "urlContains": [],
        "forbiddenText": [],
    }
    # Navigate back: no hard post URL — history stack determines landing page.
    if re.search(r"\b(navigate\s+back|go\s+back|previous\s+page)\b", step or "", re.I):
        post["urlPattern"] = None
        post["urlContains"] = []
        post["requiredEvidence"] = []
        return post
    if intent == "authenticate":
        post["notAllowedAnchors"] = list(AUTH_INTERSTITIAL_PHRASES)
        post["forbiddenText"] = list(AUTH_INTERSTITIAL_PHRASES)
        post["forbiddenOrigins"] = sorted(AUTH_RELAXED_ORIGINS)
        after_origin = origin_for_url(after.get("urlPattern", "") or after.get("url", ""))
        if after_origin and after_origin not in AUTH_RELAXED_ORIGINS:
            post["urlRegex"] = re.escape(after_origin)
        else:
            nav_target = _extract_navigate_target(step)
            if nav_target:
                parsed = urlparse(nav_target)
                if parsed.netloc:
                    post["urlRegex"] = re.escape(parsed.netloc)
    # Interact/input: prefer URL change evidence over brittle DOM evidence texts (ZWSP headings, etc.).
    # Do not hard-require exact post-URL for interact — SPA delay / same-tab navigation timing
    # often trips url_pattern_mismatch even after a successful click; following verify steps confirm.
    if intent in ("interact", "input", "generic"):
        post["requiredEvidence"] = []
        post["urlPattern"] = None
        post["urlContains"] = []
        return post
    elif after.get("evidence"):
        post["requiredEvidence"] = (after.get("evidence") or [])[:2]
    # Only bake quoted step strings into requiredText for verify intents.
    if intent in ("verify", "assert", "generic") or _is_verify_step(step):
        for item in after.get("evidence") or []:
            text = _normalize_required_text(item.get("text") or "")
            if text and len(text) >= 3:
                post["requiredText"].append(text[:120])
        quoted = re.findall(r'["\']([^"\']{2,80})["\']', step)
        for value in quoted:
            if not value.startswith("http"):
                post["requiredText"].append(_normalize_required_text(value))
    post["requiredText"] = list(dict.fromkeys(t for t in post["requiredText"] if t))[:6]
    after_url = after.get("url") or after.get("urlPattern") or ""
    if after_url:
        parsed = urlparse(after_url)
        for fragment in (parsed.path, parsed.query):
            if fragment and fragment not in ("/", ""):
                post["urlContains"].append(fragment.strip("/?")[:80])
        post["urlContains"] = list(dict.fromkeys(post["urlContains"]))[:4]
    return post


def _is_verify_step(step: str) -> bool:
    return bool(re.search(r"\b(verify|assert|confirm|should see|should display|check that)\b", step or "", re.I))


def build_preconditions(before: dict[str, Any], *, page_type: str = "", intent: str = "") -> dict[str, Any]:
    pre: dict[str, Any] = {
        "urlPattern": before.get("urlPattern"),
        "anchors": (before.get("anchors") or [])[:4],
        "notAllowedAnchors": [],
        "forbiddenText": [],
    }
    # Only block "sign in" phrases on auth intents / interstitial page types — generic pages
    # (docs sites with Sign in in the nav) otherwise fail replay preconditions.
    if intent == "authenticate" or page_type in ("auth_interstitial", "auth"):
        pre["notAllowedAnchors"] = list(AUTH_INTERSTITIAL_PHRASES)
        pre["forbiddenText"] = list(AUTH_INTERSTITIAL_PHRASES)
    if page_type:
        pre["pageType"] = page_type
    return pre


def enrich_capability(
    capability: dict[str, Any],
    *,
    step: str,
    before: dict[str, Any],
    after: dict[str, Any],
) -> dict[str, Any]:
    intent = infer_intent(step)
    capability["schemaVersion"] = SCHEMA_VERSION
    capability["capabilityType"] = capability.get("capabilityType") or "site_capability"
    capability["intent"] = intent
    capability["preconditions"] = capability.get("preconditions") or build_preconditions(
        before, page_type=capability.get("pageType", ""), intent=intent
    )
    capability["postconditions"] = capability.get("postconditions") or build_postconditions(
        intent, step, before, after
    )
    capability["safety"] = capability.get("safety") or infer_safety(intent, step)
    quality = capability.get("quality") or {}
    capability["quality"] = {
        "confidence": float(quality.get("confidence") or 0.5),
        "failureClass": quality.get("failureClass"),
        "lastFailureReason": quality.get("lastFailureReason"),
    }
    return capability


def classify_failure(reason: str) -> str:
    lowered = (reason or "").lower()
    if any(term in lowered for term in ("auth", "sign in", "stay signed in", "login")):
        return "auth_required"
    if "precondition" in lowered or "before" in lowered and "fingerprint" in lowered:
        return "precondition_failed"
    if "postcondition" in lowered or "after" in lowered and "fingerprint" in lowered:
        return "postcondition_failed"
    if any(term in lowered for term in ("locator", "no unique visible", "deterministic action failed")):
        return "locator_not_found"
    if "side effect" in lowered or "safe to replay" in lowered:
        return "side_effect_blocked"
    if "timeout" in lowered or "timed out" in lowered:
        return "timeout"
    if "permission" in lowered or "forbidden" in lowered or "denied" in lowered:
        return "permission_denied"
    if "visible" in lowered or "validation" in lowered:
        return "validation_failed"
    return "unknown"


def route_failure(failure_class: str) -> str:
    """Recommended runner action: auth_advance | repair | quarantine | fail."""
    if failure_class == "auth_required":
        return "auth_advance"
    if failure_class in ("precondition_failed", "postcondition_failed", "locator_not_found", "validation_failed"):
        return "repair"
    if failure_class in QUARANTINE_FAILURE_CLASSES:
        return "quarantine"
    if failure_class in ("permission_denied", "timeout", "unknown"):
        return "fail"
    if failure_class == "side_effect_blocked":
        return "fail"
    return "repair"


def should_quarantine(failure_class: str, failure_count: int) -> bool:
    if failure_class not in QUARANTINE_FAILURE_CLASSES:
        return False
    return failure_count >= 2


def is_replay_allowed(capability: dict[str, Any]) -> bool:
    safety = capability.get("safety") or {}
    return bool(safety.get("safeToReplay", True))


def contract_from_legacy_fingerprint(fingerprint: dict[str, Any]) -> dict[str, Any]:
    """Map v2/v3 before/after blobs to a validation contract."""
    return {
        "urlPattern": fingerprint.get("urlPattern"),
        "anchors": fingerprint.get("anchors") or [],
        "requiredEvidence": fingerprint.get("evidence") or [],
        "notAllowedAnchors": fingerprint.get("notAllowedAnchors") or [],
        "urlRegex": fingerprint.get("urlRegex"),
        "forbiddenOrigins": fingerprint.get("forbiddenOrigins") or [],
    }


def looks_like_auth_interstitial(page_state: dict[str, Any]) -> bool:
    url = (page_state.get("url") or "").lower()
    origin = origin_for_url(url)
    if origin in AUTH_RELAXED_ORIGINS:
        return True
    body = (page_state.get("bodyText") or "").lower()
    return any(phrase in body for phrase in AUTH_INTERSTITIAL_PHRASES)


VALIDATE_CONTRACT_JS = """(payload) => {
  const normalize = (s) => (s || '')
    .replace(/[\\u200b\\ufeff\\u00ad]/g, '')
    .replace(/\\s+/g, ' ')
    .trim()
    .toLowerCase();
  const bodyText = normalize(document.body?.innerText || '');
  const href = location.href || '';
  const origin = (location.host || '').toLowerCase();
  const contract = payload.contract || {};
  let score = 0;
  let maxScore = 0;
  const failures = [];

  if (contract.urlPattern) {
    maxScore += 1;
    const pattern = contract.urlPattern;
    const current = `${location.protocol}//${location.host}${location.pathname || '/'}`;
    // Exact match or same-origin + path prefix (docs/SPA redirects, trailing slash).
    if (current === pattern) score += 1;
    else {
      try {
        const stored = new URL(pattern, location.origin);
        const sameOrigin = stored.host === location.host;
        const storedPath = (stored.pathname || '/').replace(/\\/+$/, '') || '/';
        const currentPath = (location.pathname || '/').replace(/\\/+$/, '') || '/';
        if (sameOrigin && (currentPath === storedPath || currentPath.startsWith(storedPath + '/'))) score += 1;
        else failures.push('url_pattern_mismatch');
      } catch (e) {
        failures.push('url_pattern_mismatch');
      }
    }
  }
  if (contract.urlRegex) {
    maxScore += 2;
    try {
      const re = new RegExp(contract.urlRegex, 'i');
      if (re.test(href) || re.test(origin)) score += 2;
      else failures.push('url_regex_mismatch');
    } catch (e) {
      failures.push('url_regex_invalid');
    }
  }
  if (contract.forbiddenOrigins && contract.forbiddenOrigins.length) {
    maxScore += 2;
    if (!contract.forbiddenOrigins.map(o => o.toLowerCase()).includes(origin)) score += 2;
    else failures.push('forbidden_origin_present');
  }
  for (const phrase of contract.notAllowedAnchors || contract.forbiddenText || []) {
    maxScore += 1;
    if (!bodyText.includes(normalize(phrase))) score += 1;
    else failures.push(`not_allowed:${phrase}`);
  }
  for (const fragment of contract.urlContains || []) {
    maxScore += 1;
    const wanted = normalize(fragment);
    if (wanted && href.toLowerCase().includes(wanted.toLowerCase())) score += 1;
    else failures.push(`missing_url_fragment:${fragment}`);
  }
  for (const text of contract.requiredText || []) {
    maxScore += 1;
    const wanted = normalize(text);
    if (!wanted || bodyText.includes(wanted)) score += 1;
    else failures.push(`missing_text:${text}`);
  }
  const anchors = contract.anchors || [];
  if (anchors.length) {
    maxScore += Math.min(anchors.length, 4);
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    let matched = 0;
    for (const anchor of anchors.slice(0, 4)) {
      const attrs = Object.entries(anchor.attrs || {}).map(([k,v]) => `[${k}="${CSS.escape(v)}"]`).join('');
      if ([...document.querySelectorAll(`${anchor.tag}${attrs}`)].some(visible)) matched++;
    }
    const need = Math.min(2, anchors.length);
    score += Math.min(matched, Math.min(anchors.length, 4));
    if (matched < need) failures.push('anchor_mismatch');
  }
  for (const item of contract.requiredEvidence || []) {
    maxScore += 1;
    const wanted = normalize(item.text || '');
    if (!wanted) continue;
    if (bodyText.includes(wanted)) score += 1;
    else failures.push(`missing_evidence:${item.text}`);
  }
  const confidence = maxScore > 0 ? score / maxScore : 1;
  const ok = failures.length === 0 || confidence >= payload.minConfidence;
  return JSON.stringify({ ok, confidence, failures, bodyText: bodyText.slice(0, 2000), url: href, origin });
}"""


async def validate_contract(
    page: Any,
    contract: dict[str, Any],
    *,
    phase: Phase,
    min_confidence: float = 0.6,
) -> tuple[bool, float, str, str | None]:
    import json

    raw = await page.evaluate(VALIDATE_CONTRACT_JS, {
        "contract": contract,
        "phase": phase,
        "minConfidence": min_confidence,
    })
    result = json.loads(raw) if isinstance(raw, str) else raw
    ok = bool(result.get("ok"))
    confidence = float(result.get("confidence") or 0)
    failures = result.get("failures") or []
    reason = ", ".join(failures) if failures else ""
    if not ok:
        label = "precondition" if phase == "pre" else "postcondition"
        reason = f"{label} validation failed ({confidence:.0%}): {reason or 'low confidence'}"
    failure_class = None if ok else classify_failure(reason)
    return ok, confidence, reason, failure_class


def migrate_legacy_capability(capability: dict[str, Any]) -> dict[str, Any]:
    """Upgrade v2/v3 capabilities in memory for validation (no write)."""
    if capability.get("schemaVersion", 2) >= SCHEMA_VERSION:
        return capability
    step = capability.get("step", "")
    before = capability.get("before") or {}
    after = capability.get("after") or {}
    return enrich_capability({**capability}, step=step, before=before, after=after)


def resolve_validation_contract(capability: dict[str, Any], phase: Phase) -> dict[str, Any]:
    if capability.get("schemaVersion", 2) >= 4:
        key = "preconditions" if phase == "pre" else "postconditions"
        contract = dict(capability.get(key) or {})
    else:
        legacy_key = "before" if phase == "pre" else "after"
        contract = contract_from_legacy_fingerprint(capability.get(legacy_key) or {})

    intent = str(capability.get("intent") or infer_intent(capability.get("step", "")))
    page_type = str(capability.get("pageType") or "")

    # Heal older stored knowledge: ZWSP in requiredText / evidence breaks playback on Docusaurus etc.
    if contract.get("requiredText"):
        contract["requiredText"] = [
            t for t in (_normalize_required_text(str(x)) for x in contract["requiredText"]) if t
        ][:6]
    if contract.get("requiredEvidence"):
        healed = []
        for item in contract["requiredEvidence"]:
            if not isinstance(item, dict):
                continue
            text = _normalize_required_text(str(item.get("text") or ""))
            if text:
                healed.append({**item, "text": text})
        contract["requiredEvidence"] = healed[:4]

    # Heal older stores that attached "sign in" forbidden phrases to every capability.
    if phase == "pre" and intent != "authenticate" and page_type not in ("auth_interstitial", "auth"):
        contract["notAllowedAnchors"] = [
            p for p in (contract.get("notAllowedAnchors") or []) if p not in AUTH_INTERSTITIAL_PHRASES
        ]
        contract["forbiddenText"] = [
            p for p in (contract.get("forbiddenText") or []) if p not in AUTH_INTERSTITIAL_PHRASES
        ]

    # Interact clicks should not require brittle page heading evidence from prior learning.
    if phase == "post" and intent in ("interact", "input"):
        contract["requiredEvidence"] = []
        # Drop evidence-like requiredText that wasn't quoted in the step.
        step = capability.get("step") or ""
        quoted = { _normalize_required_text(v).lower() for v in re.findall(r'["\']([^"\']{2,80})["\']', step) }
        contract["requiredText"] = [
            t for t in (contract.get("requiredText") or [])
            if _normalize_required_text(t).lower() in quoted
        ]

    return contract
