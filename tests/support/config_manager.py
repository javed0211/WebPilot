import json
import os
import re
from pathlib import Path
from typing import Any


class ConfigManager:
  """Load WebPilot environment JSON (resources/config/environments/<env>.json)."""

  _instance: dict[str, Any] | None = None

  @classmethod
  def get_config(cls) -> dict[str, Any]:
    if cls._instance is not None:
      return cls._instance
    env = os.environ.get("ENV", "qa")
    config_path = Path.cwd() / "resources" / "config" / "environments" / f"{env}.json"
    if not config_path.exists():
      raise FileNotFoundError(f'Configuration file not found for environment "{env}": {config_path}')
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    cls._instance = cls._resolve_env_vars(raw)
    return cls._instance

  @classmethod
  def _resolve_env_vars(cls, obj: Any) -> Any:
    if isinstance(obj, str):
      return re.sub(
        r"\$\{(\w+)\}",
        lambda match: os.environ.get(match.group(1), match.group(0)),
        obj,
      )
    if isinstance(obj, list):
      return [cls._resolve_env_vars(item) for item in obj]
    if isinstance(obj, dict):
      return {key: cls._resolve_env_vars(value) for key, value in obj.items()}
    return obj


config = ConfigManager.get_config()
