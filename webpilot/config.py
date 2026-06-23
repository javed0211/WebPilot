from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv


PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_cwd = Path.cwd().resolve()
ROOT = Path(os.getenv("WEBPILOT_ROOT", _cwd)).resolve()
if not (ROOT / "config" / "webpilot.yaml").exists():
    ROOT = PACKAGE_ROOT
ENV_PATTERN = re.compile(r"\$\{(\w+)\}")


def _resolve_env(value: Any) -> Any:
    if isinstance(value, str):
        return ENV_PATTERN.sub(lambda match: os.getenv(match.group(1), match.group(0)), value)
    if isinstance(value, list):
        return [_resolve_env(item) for item in value]
    if isinstance(value, dict):
        return {key: _resolve_env(item) for key, item in value.items()}
    return value


@lru_cache(maxsize=1)
def settings() -> dict[str, Any]:
    load_dotenv(ROOT / ".env", override=False)
    path = ROOT / "config" / "webpilot.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}


def get_setting(key: str, default: Any = None) -> Any:
    current: Any = settings()
    for part in key.split("."):
        if not isinstance(current, dict) or part not in current:
            return default
        current = current[part]
    return current


def environment(name: str) -> dict[str, Any]:
    path = ROOT / "config" / "environments" / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"Environment configuration not found: {path}")
    return _resolve_env(json.loads(path.read_text(encoding="utf-8")))


def python_executable() -> str:
    configured = os.getenv("WEBPILOT_PYTHON")
    if configured:
        return configured
    venv = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    return str(venv) if venv.exists() else os.sys.executable
