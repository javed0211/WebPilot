from __future__ import annotations

import os
from typing import Any

from integrations.browser_use.llm_config import resolve_provider_config, validate_provider_config


def resolve_openhands_llm() -> dict[str, Any]:
    provider, cfg = resolve_provider_config()
    validate_provider_config(provider, cfg)

    model_override = (
        os.environ.get("WEBPILOT_OPENHANDS_MODEL")
        or os.environ.get("WEBPILOT_LLM_MODEL")
        or ""
    ).strip()

    if provider == "azure":
        deployment = str(cfg.get("deploymentId") or cfg.get("model") or "").strip()
        return {
            "provider": provider,
            "model": model_override or f"azure/{deployment}",
            "api_key": cfg.get("apiKey", ""),
            "base_url": cfg.get("endpoint", ""),
            "api_version": cfg.get("apiVersion", ""),
        }

    model = str(cfg.get("model") or "").strip()
    if provider == "openai":
        model_name = model_override or f"openai/{model}"
    elif provider == "anthropic":
        model_name = model_override or f"anthropic/{model}"
    elif provider in {"google", "gcp"}:
        model_name = model_override or f"gemini/{model}"
    elif provider == "ollama":
        model_name = model_override or f"ollama/{model}"
    else:
        model_name = model_override or model

    return {
        "provider": provider,
        "model": model_name,
        "api_key": cfg.get("apiKey", ""),
        "base_url": cfg.get("endpoint", ""),
        "api_version": cfg.get("apiVersion", ""),
    }
