"""
Resolve LLM credentials for Python runners (browser-use, codegen).

Mirrors core/LLMClient.ts: config/llm.json + .env + config/webpilot.yaml activeProvider.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from .paths import CONFIG_ROOT, PROJECT_ROOT

_ENV_REF_RE = re.compile(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}')


def _expand_env_refs(value: Any) -> Any:
    """Replace ``${VAR}`` references with environment values.

    `webpilot init` writes env placeholders (e.g. ``${AZURE_OPENAI_API_KEY}``)
    into config/llm.json instead of real secrets, so the secret lives in .env.
    Unresolved references collapse to an empty string, which downstream
    placeholder checks then treat as "not configured".
    """
    if not isinstance(value, str):
        return value
    return _ENV_REF_RE.sub(lambda match: os.environ.get(match.group(1), ''), value)


def _load_dotenv() -> None:
    env_path = PROJECT_ROOT / '.env'
    try:
        from dotenv import load_dotenv

        if env_path.is_file():
            load_dotenv(env_path, override=False)
        else:
            load_dotenv(override=False)
    except ImportError:
        if env_path.is_file():
            for line in env_path.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, value = line.partition('=')
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value


def _is_placeholder(value: str | None) -> bool:
    if not value or not str(value).strip():
        return True
    text = str(value).strip()
    # An unresolved ${VAR} reference means the .env value was never set.
    if '${' in text:
        return True
    upper = text.upper()
    return 'YOUR_' in upper or upper in ('', 'CHANGE_ME', 'CHANGEME')


def load_webpilot_yaml() -> dict[str, Any]:
    path = CONFIG_ROOT / 'webpilot.yaml'
    if not path.is_file():
        return {}
    try:
        import yaml

        return yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    except Exception:
        return {}


def load_llm_json() -> dict[str, Any]:
    path = CONFIG_ROOT / 'llm.json'
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def get_active_provider() -> str:
    _load_dotenv()
    wp = load_webpilot_yaml()
    return (
        os.environ.get('WEBPILOT_LLM_PROVIDER')
        or (wp.get('framework') or {}).get('activeProvider')
        or 'azure'
    )


def resolve_provider_config(provider: str | None = None) -> tuple[str, dict[str, Any]]:
    """Return (provider_name, merged config dict with apiKey, endpoint, etc.)."""
    _load_dotenv()
    prov = (provider or get_active_provider()).lower()
    llm = load_llm_json()
    block = {key: _expand_env_refs(value) for key, value in (llm.get(prov) or {}).items()}

    if prov == 'azure':
        block['apiKey'] = (
            block.get('apiKey')
            if not _is_placeholder(block.get('apiKey'))
            else os.environ.get('AZURE_OPENAI_API_KEY', '')
        )
        block['endpoint'] = (
            block.get('endpoint')
            if not _is_placeholder(block.get('endpoint'))
            else os.environ.get('AZURE_OPENAI_ENDPOINT', '')
        )
        block['deploymentId'] = (
            block.get('deploymentId')
            if not _is_placeholder(block.get('deploymentId'))
            else os.environ.get('AZURE_OPENAI_DEPLOYMENT', block.get('model', 'gpt-4.1'))
        )
        block['apiVersion'] = (
            block.get('apiVersion')
            or os.environ.get('AZURE_OPENAI_API_VERSION')
            or os.environ.get('OPENAI_API_VERSION')
            or '2024-12-01-preview'
        )
        block['model'] = block.get('model') or block['deploymentId']
        # Optional explicit billed model for cost estimates when deploymentId is opaque.
        block['pricingModel'] = (
            block.get('pricingModel')
            or os.environ.get('WEBPILOT_LLM_MODEL')
            or block.get('model')
        )
        if block.get('endpoint'):
            block['endpoint'] = str(block['endpoint']).rstrip('/')

    elif prov == 'openai':
        block['apiKey'] = (
            block.get('apiKey')
            if not _is_placeholder(block.get('apiKey'))
            else os.environ.get('OPENAI_API_KEY', '')
        )
        block['model'] = block.get('model') or 'gpt-4o'

    elif prov == 'google':
        block['apiKey'] = (
            block.get('apiKey')
            if not _is_placeholder(block.get('apiKey'))
            else os.environ.get('GEMINI_API_KEY', '')
        )
        block['model'] = block.get('model') or 'gemini-2.5-flash'

    elif prov == 'anthropic':
        block['apiKey'] = (
            block.get('apiKey')
            if not _is_placeholder(block.get('apiKey'))
            else os.environ.get('ANTHROPIC_API_KEY', '')
        )

    elif prov == 'ollama':
        block['model'] = (
            os.environ.get('WEBPILOT_OLLAMA_MODEL')
            or block.get('model')
            or 'qwen2.5:3b'
        )
        block['endpoint'] = (
            os.environ.get('WEBPILOT_OLLAMA_HOST')
            or block.get('endpoint')
            or 'http://localhost:11434'
        )

    return prov, block


def validate_provider_config(provider: str, cfg: dict[str, Any]) -> None:
    if provider == 'azure':
        missing = []
        if _is_placeholder(cfg.get('apiKey')):
            missing.append('AZURE_OPENAI_API_KEY')
        if _is_placeholder(cfg.get('endpoint')):
            missing.append('AZURE_OPENAI_ENDPOINT')
        if _is_placeholder(cfg.get('deploymentId')):
            missing.append('AZURE_OPENAI_DEPLOYMENT (or deploymentId in config/llm.json)')
        if missing:
            raise ValueError(
                'Azure OpenAI is not configured. Set in .env or config/llm.json:\n  '
                + '\n  '.join(missing)
                + '\n\nExample .env:\n'
                '  AZURE_OPENAI_API_KEY=...\n'
                '  AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com\n'
                '  AZURE_OPENAI_DEPLOYMENT=gpt-4.1\n'
                '  AZURE_OPENAI_API_VERSION=2024-12-01-preview'
            )
    elif provider == 'openai':
        if _is_placeholder(cfg.get('apiKey')):
            raise ValueError(
                'OpenAI API key missing. Set OPENAI_API_KEY in .env or openai.apiKey in config/llm.json.'
            )
    elif provider == 'google':
        if _is_placeholder(cfg.get('apiKey')):
            raise ValueError(
                'Gemini API key missing. Set GEMINI_API_KEY in .env or google.apiKey in config/llm.json.'
            )
    elif provider == 'ollama':
        if _is_placeholder(cfg.get('model')):
            raise ValueError(
                'Ollama model missing. Set ollama.model in config/llm.json or WEBPILOT_OLLAMA_MODEL.'
            )


def apply_azure_env(cfg: dict[str, Any]) -> None:
    os.environ['AZURE_OPENAI_API_KEY'] = cfg.get('apiKey', '')
    os.environ['AZURE_OPENAI_ENDPOINT'] = cfg.get('endpoint', '')
    os.environ['AZURE_OPENAI_DEPLOYMENT'] = cfg.get('deploymentId', '')
    os.environ['OPENAI_API_VERSION'] = cfg.get('apiVersion', '')
    os.environ['AZURE_OPENAI_API_VERSION'] = cfg.get('apiVersion', '')


def create_browser_use_llm(provider: str, cfg: dict[str, Any]):
    """Return a browser-use chat model for the active provider."""
    if provider == 'azure':
        from browser_use import ChatAzureOpenAI

        apply_azure_env(cfg)
        return ChatAzureOpenAI(
            model=cfg['model'],
            api_key=cfg['apiKey'],
            azure_endpoint=cfg['endpoint'],
            azure_deployment=cfg['deploymentId'],
            api_version=cfg['apiVersion'],
            temperature=0.0,
        )

    if provider == 'openai':
        from browser_use import ChatOpenAI

        return ChatOpenAI(model=cfg['model'], api_key=cfg['apiKey'], temperature=0.0)

    if provider == 'ollama':
        from browser_use import ChatOllama

        return ChatOllama(model=cfg['model'], host=cfg.get('endpoint') or 'http://localhost:11434')

    raise ValueError(
        f'browser-use runner supports activeProvider "azure", "openai", or "ollama" (got "{provider}"). '
        'Set framework.activeProvider in config/webpilot.yaml or use Azure/OpenAI credentials.'
    )


def create_codegen_client(provider: str, cfg: dict[str, Any]):
    """OpenAI SDK client for post-run Playwright codegen."""
    if provider == 'azure':
        from openai import AzureOpenAI

        apply_azure_env(cfg)
        return AzureOpenAI(
            api_key=cfg['apiKey'],
            api_version=cfg['apiVersion'],
            azure_endpoint=cfg['endpoint'],
        ), cfg['deploymentId']

    if provider == 'openai':
        from openai import OpenAI

        return OpenAI(api_key=cfg['apiKey']), cfg['model']

    raise ValueError(f'Codegen does not support provider "{provider}" yet.')
