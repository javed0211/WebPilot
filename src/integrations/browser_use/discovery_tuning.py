"""Native discovery tuning — Nexus-style fast mode + control-loop breaker."""
from __future__ import annotations

import os
import re
from collections import Counter
from typing import Any
from urllib.parse import urlparse

_LOOP_PRONE = frozenset({"input", "type", "click", "select", "search_page", "find_text", "evaluate"})


def discovery_fast_mode_enabled(perf: dict | None = None) -> bool:
    """
    Lean agent knobs for heavy SPAs (Booking, etc.).

    Default OFF — stock browser-use (judge/thinking/planning on, flash off).
    Opt into fast mode with:
      WEBPILOT_DISCOVERY_FAST_MODE=1  or  intelligentRunner.performance.discoveryFastMode: true
    Force full agent (overrides yaml fast opt-in) with WEBPILOT_FULL_AGENT_MODE=1
    """
    # Default to full agent when unset (same as WEBPILOT_FULL_AGENT_MODE=1).
    full = os.environ.get("WEBPILOT_FULL_AGENT_MODE", "1").strip().lower()
    if full in ("1", "true", "yes", "on"):
        return False
    env = os.environ.get("WEBPILOT_DISCOVERY_FAST_MODE", "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    perf = perf or {}
    if "discoveryFastMode" in perf:
        return bool(perf.get("discoveryFastMode"))
    return False


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


def _goal_fingerprint(goal: str) -> str | None:
    """Coarse fingerprint of the agent's stated next_goal (wording-stable)."""
    g = _normalize_snippet(goal)
    if len(g) < 12:
        return None
    g = re.sub(r"\b(the|a|an|so i can|so that|then|and|to)\b", " ", g)
    g = re.sub(r"\s+", " ", g).strip()
    return g[:120] if g else None


def evaluation_is_uncertain(eval_text: str) -> bool:
    """True when the model did not clearly confirm the previous goal."""
    lower = (eval_text or "").strip().lower()
    if not lower:
        return False
    if re.search(r"\b(success|succeeded|successful)\b", lower) and not re.search(
        r"\b(partial|uncertain|inconclusive|not\s+yet|unverified|only partially)\b", lower
    ):
        return False
    if re.search(r"\b(fail|failed|failure)\b", lower) and not re.search(
        r"\b(partial|uncertain|inconclusive)\b", lower
    ):
        return False
    return bool(
        re.search(
            r"\b(uncertain|inconclusive|partial(?:ly)?|not\s+yet\s+verified|unverified|"
            r"not\s+conclusively|could\s+not\s+confirm|cannot\s+confirm|can't\s+confirm|"
            r"still\s+looks\s+like|does\s+not\s+confirm)\b",
            lower,
        )
    )


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
    if name in ("search_page", "find_text"):
        query = _normalize_snippet(str(params.get("value") or params.get("query") or params.get("text") or ""))
        if len(query) < 3:
            return None
        return f"search|{query[:80]}"
    if name == "evaluate":
        # Coarse: evaluate fallbacks that keep retrying the same intent
        blob = _normalize_snippet(str(params.get("description") or params.get("value") or "evaluate"))
        if len(blob) < 8:
            return "evaluate|generic"
        return f"evaluate|{blob[:80]}"
    return None


class ControlLoopBreaker:
    """
    Stop discovery when the agent is stuck — repeated controls, repeated search
    probes, repeated next_goal, or a long streak of uncertain evaluations.
    """

    def __init__(
        self,
        *,
        max_retries: int | None = None,
        window: int | None = None,
        max_uncertain: int | None = None,
    ):
        env_max = (os.environ.get("WEBPILOT_CONTROL_LOOP_MAX_RETRIES") or "").strip()
        env_win = (os.environ.get("WEBPILOT_CONTROL_LOOP_WINDOW") or "").strip()
        env_unc = (os.environ.get("WEBPILOT_CONTROL_LOOP_MAX_UNCERTAIN") or "").strip()
        self.max_retries = max(2, int(env_max) if env_max.isdigit() else (max_retries or 5))
        self.window = max(4, int(env_win) if env_win.isdigit() else (window or 10))
        self.max_uncertain = max(
            3, int(env_unc) if env_unc.isdigit() else (max_uncertain or 6)
        )
        self._fingerprints: list[str] = []
        self._goals: list[str] = []
        self._uncertain_streak = 0
        self.triggered = False
        self.message = ""
        self.enabled = os.environ.get("WEBPILOT_SKIP_CONTROL_LOOP_BREAKER", "").strip().lower() not in (
            "1",
            "true",
            "yes",
            "on",
        )

    def _trip(self, message: str) -> bool:
        self.triggered = True
        self.message = message
        return True

    def _check_fingerprint_window(self) -> bool:
        recent = self._fingerprints[-self.window :]
        if not recent:
            return False
        counts = Counter(recent)
        fp, count = counts.most_common(1)[0]
        if count >= self.max_retries:
            return self._trip(
                f"Stopped after {count} repeated attempts on the same probe "
                f"(limit {self.max_retries}) ({fp}). "
                "The agent was looping instead of progressing — fail this run and adjust the step or UI state."
            )
        return False

    def observe_actions(self, actions: list[dict[str, Any]] | None) -> bool:
        """Record actions; return True if breaker just triggered."""
        if not self.enabled or self.triggered:
            return self.triggered
        for action in actions or []:
            fp = fingerprint_from_captured_action(action)
            if fp:
                self._fingerprints.append(fp)
        return self._check_fingerprint_window()

    def observe_model_state(self, output: Any) -> bool:
        """
        Watch next_goal + evaluation_previous_goal for stuck planning
        (e.g. endless search/verify loops with eval[?]).
        """
        if not self.enabled or self.triggered:
            return self.triggered

        state = getattr(output, "current_state", None) or output
        eval_text = ""
        goal = ""
        for name in ("evaluation_previous_goal",):
            value = getattr(state, name, None)
            if value is None and isinstance(state, dict):
                value = state.get(name)
            if isinstance(value, str) and value.strip():
                eval_text = value.strip()
                break
        for name in ("next_goal",):
            value = getattr(state, name, None)
            if value is None and isinstance(state, dict):
                value = state.get(name)
            if isinstance(value, str) and value.strip():
                goal = value.strip()
                break

        if evaluation_is_uncertain(eval_text):
            self._uncertain_streak += 1
        elif eval_text:
            self._uncertain_streak = 0

        if self._uncertain_streak >= self.max_uncertain:
            return self._trip(
                f"Stopped after {self._uncertain_streak} consecutive uncertain evaluations "
                f"(limit {self.max_uncertain}). "
                "The agent could not verify progress — failing instead of probing forever."
            )

        gfp = _goal_fingerprint(goal)
        if gfp:
            self._goals.append(gfp)
            recent = self._goals[-self.window :]
            count = Counter(recent).most_common(1)[0][1]
            if count >= self.max_retries:
                return self._trip(
                    f"Stopped after {count} repeated agent goals (limit {self.max_retries}): "
                    f'"{gfp[:80]}". '
                    "The agent was restating the same plan without progress."
                )
        return False

    async def should_stop(self) -> bool:
        return bool(self.enabled and self.triggered)
