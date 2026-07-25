"""Live console progress for the WebPilot discovery agent.

browser-use INFO dumps are quiet by default (BROWSER_USE_LOGGING_LEVEL=result).
This module prints short, human-readable progress lines from the step callback
so users can see what the agent is doing without enabling full verbose dumps.

Enable full browser-use dumps with WEBPILOT_VERBOSE=1 (or --verbose on CLI).
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse


def _truncate(text: str, limit: int = 100) -> str:
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _quote(text: str, limit: int = 60) -> str:
    return f'"{_truncate(text, limit)}"'


def _locator_label(locators: list[dict[str, Any]] | None) -> str:
    if not locators:
        return ""
    loc = locators[0] or {}
    kind = str(loc.get("kind") or "")
    name = str(loc.get("name") or "").strip()
    value = str(loc.get("value") or "").strip()
    if kind == "role" and name:
        return f"{value or 'control'} {_quote(name)}" if value else _quote(name)
    if kind == "placeholder" and value:
        return f"placeholder {_quote(value)}"
    if kind == "testid" and value:
        return f"testid {_quote(value)}"
    if kind == "text" and value:
        return _quote(value)
    if kind == "css" and value:
        return f"css {_quote(value, 40)}"
    return _quote(name or value) if (name or value) else ""


def _short_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        host = parsed.netloc or ""
        path = parsed.path or "/"
        if len(path) > 40:
            path = path[:39] + "…"
        return f"{host}{path}" if host else url[:80]
    except Exception:
        return _truncate(url, 80)


def format_action(action: dict[str, Any]) -> str:
    """One-line description of a captured agent action."""
    kind = str(action.get("type") or action.get("action") or "?").lower()
    if kind == "navigate":
        url = str(action.get("url") or "")
        return f"navigate {_short_url(url)}" if url else "navigate"
    if kind in ("click",):
        label = _locator_label(action.get("locators"))
        return f"click {label}".rstrip() if label else "click"
    if kind in ("input", "fill", "type"):
        label = _locator_label(action.get("locators"))
        value = str(action.get("value") or "")
        # Hide long values (often secrets / tokens) in the console.
        if value and len(value) > 80:
            shown = '"…"'
        elif value:
            shown = _quote(value, 40)
        else:
            shown = ""
        target = f" into {label}" if label else ""
        if shown:
            return f"type {shown}{target}".strip()
        return f"type{target}".strip() or "type"
    if kind in ("press", "send_keys"):
        return f"press {_quote(str(action.get('value') or ''), 30)}"
    if kind == "wait":
        secs = action.get("seconds")
        return f"wait {secs}s" if secs is not None else "wait"
    if kind == "go_back":
        return "go back"
    if kind in ("switch_tab", "close_tab"):
        return kind.replace("_", " ")
    if kind == "screenshot":
        return "screenshot"
    if kind == "search_page":
        return f"search {_quote(str(action.get('value') or ''), 40)}"
    if kind == "done":
        return "done"
    return kind.replace("_", " ")


def _state_field(output: Any, *names: str) -> str:
    state = getattr(output, "current_state", None) or output
    for name in names:
        value = getattr(state, name, None)
        if value is None and isinstance(state, dict):
            value = state.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def format_agent_step(
    agent_step: int,
    output: Any,
    actions: list[dict[str, Any]],
    *,
    nl_hint: str | None = None,
) -> str:
    """Multi-line progress block for one agent loop iteration."""
    lines: list[str] = []
    header = f"[Agent] #{agent_step}"
    if nl_hint:
        header += f"  (NL: {_truncate(nl_hint, 70)})"
    lines.append(header)

    eval_prev = _state_field(output, "evaluation_previous_goal")
    if eval_prev:
        verdict = "ok"
        lower = eval_prev.lower()
        if "fail" in lower:
            verdict = "fail"
        elif "uncertain" in lower:
            verdict = "?"
        lines.append(f"         eval[{verdict}]: {_truncate(eval_prev, 110)}")

    next_goal = _state_field(output, "next_goal")
    if next_goal:
        lines.append(f"         goal: {_truncate(next_goal, 110)}")

    if actions:
        for action in actions:
            lines.append(f"         → {format_action(action)}")
    else:
        # Flash / done / no-DOM actions still deserve a hint
        raw_names: list[str] = []
        for action_model in getattr(output, "action", []) or []:
            try:
                dumped = action_model.model_dump(exclude_none=True)
            except Exception:
                continue
            raw_names.extend(dumped.keys())
        if raw_names:
            lines.append(f"         → {', '.join(raw_names)}")
        else:
            lines.append("         → (no browser actions this step)")

    return "\n".join(lines)


def print_agent_step(
    agent_step: int,
    output: Any,
    actions: list[dict[str, Any]],
    *,
    nl_hint: str | None = None,
) -> None:
    """Print progress for one agent step (always on — independent of verbose dumps)."""
    if output is None and not actions:
        return
    print(format_agent_step(agent_step, output, actions, nl_hint=nl_hint), flush=True)


def branding_current_text(output: Any, fallback: str) -> str:
    """Prefer the agent's next goal for the live browser overlay."""
    goal = _state_field(output, "next_goal")
    if goal:
        return _truncate(goal, 80)
    return fallback
