"""Native discovery tuning — Nexus-style fast mode + control-loop breaker."""
from __future__ import annotations

import os
import re
from collections import Counter
from typing import Any
from urllib.parse import urlparse

_LOOP_PRONE = frozenset({"input", "type", "click", "select"})
# Exploration tools (search_page / find_elements) are noisy — do not trip the breaker.


def discovery_fast_mode_enabled(perf: dict | None = None) -> bool:
    """
    Lean agent knobs for heavy SPAs (Booking, etc.).

    Default ON — matches Nexus fast mode. Restore full agent with:
      WEBPILOT_FULL_AGENT_MODE=1  or  intelligentRunner.performance.discoveryFastMode: false
    """
    if os.environ.get("WEBPILOT_FULL_AGENT_MODE", "").strip().lower() in ("1", "true", "yes", "on"):
        return False
    env = os.environ.get("WEBPILOT_DISCOVERY_FAST_MODE", "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    perf = perf or {}
    if "discoveryFastMode" in perf:
        return bool(perf.get("discoveryFastMode"))
    return True


def apply_discovery_fast_mode(perf: dict) -> dict:
    """Return a copy of perf with fast-mode agent knobs when enabled."""
    out = dict(perf or {})
    if not discovery_fast_mode_enabled(out):
        out["_discoveryFastModeActive"] = False
        return out
    # Nexus defaults for heavy sites — judge/planning/thinking add per-step latency.
    out["judgeMode"] = "off"
    out["useThinking"] = False
    out["flashMode"] = True
    out["enablePlanning"] = False
    out["visionDetailLevel"] = "low"
    out["_discoveryFastModeActive"] = True
    return out


def extract_initial_navigate_url(steps: list[str]) -> str | None:
    """First absolute http(s) URL in NL steps for deterministic initial navigate."""
    for step in steps or []:
        m = re.search(r"https?://[^\s\"'<>]+", step or "", re.I)
        if m:
            url = m.group(0).rstrip(".,);]")
            try:
                parsed = urlparse(url)
                if parsed.scheme in ("http", "https") and parsed.netloc:
                    return url
            except Exception:
                continue
    return None


def build_lean_native_task(steps: list[str], discovery_rules: str) -> str:
    """Lean task text — numbered steps first; short locator hints last (Nexus-style)."""
    numbered = "\n".join(f"{i}. {step}" for i, step in enumerate(steps, start=1))
    rules = (discovery_rules or "").strip()
    parts = [
        "Execute this UI test end-to-end in the browser.",
        "Complete every numbered step in order — do not skip date pickers, Search, or verify steps.",
        "Dismiss cookie/consent and blocking popups (Close / Dismiss / Not now) when they appear;",
        "do not sign in unless a step requires authentication.",
        "Call done(success=true) only when the last numbered step outcome is satisfied.",
        "",
        "Test steps:",
        numbered,
    ]
    if rules:
        parts.extend(["", "=== LOCATOR HINTS ===", rules])
    return "\n".join(parts)


def _normalize_snippet(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def fingerprint_from_captured_action(action: dict[str, Any]) -> str | None:
    """Fingerprint for control-loop detection from WebPilot captured action dicts."""
    if not isinstance(action, dict):
        return None
    # actions_from_output uses {"type": "input"|"click"|...}; raw BA dumps use action name keys.
    name = str(action.get("type") or action.get("action") or action.get("name") or "").strip().lower()
    params = action
    if not name:
        for k, v in action.items():
            if k in ("interacted_element", "result"):
                continue
            if k in _LOOP_PRONE and isinstance(v, dict):
                name = k
                params = v
                break
        else:
            return None
    elif name not in _LOOP_PRONE:
        nested = action.get(name)
        if isinstance(nested, dict):
            params = nested
        else:
            return None

    if name in ("input", "type"):
        text = str(params.get("text") or params.get("value") or "").strip().lower()
        index = params.get("index")
        if not text and index is None:
            return None
        return f"input|{index}|{text[:80]}"
    if name == "click":
        index = params.get("index")
        desc = _normalize_snippet(str(params.get("description") or params.get("text") or ""))[:60]
        # Prefer first locator text for stability across re-indexes
        locs = params.get("locators") or []
        if isinstance(locs, list) and locs:
            loc0 = locs[0] if isinstance(locs[0], dict) else {}
            desc = _normalize_snippet(str(loc0.get("value") or loc0.get("name") or desc))[:60]
        if not desc and index is None:
            return None
        return f"click|{index}|{desc}"
    if name == "select":
        text = str(params.get("text") or params.get("label") or "").strip().lower()
        return f"select|{params.get('index')}|{text[:60]}"
    return None


class ControlLoopBreaker:
    """Stop discovery when the same search/select/input repeats too often (Nexus pattern)."""

    def __init__(self, *, max_retries: int | None = None, window: int | None = None):
        env_max = (os.environ.get("WEBPILOT_CONTROL_LOOP_MAX_RETRIES") or "").strip()
        env_win = (os.environ.get("WEBPILOT_CONTROL_LOOP_WINDOW") or "").strip()
        self.max_retries = max(2, int(env_max) if env_max.isdigit() else (max_retries or 5))
        self.window = max(4, int(env_win) if env_win.isdigit() else (window or 10))
        self._fingerprints: list[str] = []
        self.triggered = False
        self.message = ""
        self.enabled = os.environ.get("WEBPILOT_SKIP_CONTROL_LOOP_BREAKER", "").strip().lower() not in (
            "1",
            "true",
            "yes",
            "on",
        )

    def observe_actions(self, actions: list[dict[str, Any]] | None) -> bool:
        """Record actions; return True if breaker just triggered."""
        if not self.enabled or self.triggered:
            return self.triggered
        for action in actions or []:
            fp = fingerprint_from_captured_action(action)
            if fp:
                self._fingerprints.append(fp)
        recent = self._fingerprints[-self.window :]
        if not recent:
            return False
        counts = Counter(recent)
        fp, count = counts.most_common(1)[0]
        if count >= self.max_retries:
            self.triggered = True
            detail = f" ({fp})" if fp else ""
            self.message = (
                f"Stopped after {count} repeated attempts on the same control "
                f"(limit {self.max_retries}){detail}. "
                "Try a different selector or complete this step manually."
            )
            return True
        return False

    async def should_stop(self) -> bool:
        return bool(self.enabled and self.triggered)
