"""
Model capability helpers for Python runners.

Mirrors core/llmCapabilities.ts so browser-use and codegen paths stay aligned.
"""
from __future__ import annotations

import json
from typing import Any

from .paths import CONFIG_ROOT


def _load_models_config() -> dict[str, Any]:
    path = CONFIG_ROOT / 'llm-models.json'
    if not path.is_file():
        return {'defaults': {'tokenLimitField': 'max_tokens'}}
    return json.loads(path.read_text(encoding='utf-8'))


def normalize_model_key(model_or_deployment: str) -> str:
    return model_or_deployment.lower().replace('azure/', '', 1).strip()


def resolve_token_limit_field(model_or_deployment: str) -> str:
    key = normalize_model_key(model_or_deployment)
    cfg = _load_models_config()
    overrides = cfg.get('overrides') or {}
    if key in overrides and overrides[key].get('tokenLimitField'):
        return overrides[key]['tokenLimitField']

    for family in cfg.get('families') or []:
        match = str(family.get('match', '')).lower()
        if match and match in key:
            return family.get('tokenLimitField', 'max_completion_tokens')

    return (cfg.get('defaults') or {}).get('tokenLimitField', 'max_tokens')
