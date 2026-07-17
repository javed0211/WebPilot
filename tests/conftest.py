import json
import os
from pathlib import Path

import pytest


def _load_env_config() -> dict:
    env = os.environ.get("ENV", "qa")
    config_path = Path.cwd() / "resources" / "config" / "environments" / f"{env}.json"
    if not config_path.exists():
        return {}
    return json.loads(config_path.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def env_config() -> dict:
    return _load_env_config()


@pytest.fixture(scope="session")
def browser_type_launch_args(env_config: dict) -> dict:
    launch_args: dict = {"channel": "chrome"}
    variables = env_config.get("variables") or {}
    if variables.get("headless") is True:
        launch_args["headless"] = True
    return launch_args


@pytest.fixture(scope="session")
def browser_context_args(env_config: dict) -> dict:
    base_url = env_config.get("baseUrl")
    context_args: dict = {"viewport": {"width": 1280, "height": 720}}
    if base_url:
        context_args["base_url"] = base_url
    return context_args
