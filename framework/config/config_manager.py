from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


ENV_PATTERN = re.compile(r"\$\{(\w+)\}")
ROOT = Path(__file__).resolve().parents[2]


def _resolve_env_vars(value: Any) -> Any:
    if isinstance(value, str):
        return ENV_PATTERN.sub(lambda match: os.getenv(match.group(1), match.group(0)), value)
    if isinstance(value, list):
        return [_resolve_env_vars(item) for item in value]
    if isinstance(value, dict):
        return {key: _resolve_env_vars(item) for key, item in value.items()}
    return value


@lru_cache(maxsize=None)
def load_config(environment: str | None = None) -> dict[str, Any]:
    env = environment or os.getenv("ENV", "qa")
    config_path = ROOT / "config" / "environments" / f"{env}.json"
    if not config_path.exists():
        raise FileNotFoundError(
            f'Configuration file not found for environment "{env}" at: {config_path}'
        )
    with config_path.open(encoding="utf-8") as handle:
        return _resolve_env_vars(json.load(handle))


config = load_config()
