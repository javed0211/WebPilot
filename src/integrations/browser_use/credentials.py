"""Extract, mask, and wire credentials for Browser Use sensitive_data."""
from __future__ import annotations

import json
import os
import re
from typing import Any

from .llm_config import _load_dotenv
from .paths import resolve_environment_config_path

ENV_VAR_RE = re.compile(r'\$\{([^}]+)\}')
STEP_PLACEHOLDER_RE = re.compile(r'\$\{([^}]+)\}')
SECRET_TAG_RE = re.compile(r'<secret>(.*?)</secret>', re.IGNORECASE)
CREDENTIAL_PAIR_VARS_RE = re.compile(
    r'(?:login|sign[\s-]?in)\s+(?:using|with)\s+(?:credentials?\s+)?["\']?\$\{([^}]+)\}["\']?\s+and\s+(?:password\s+)?["\']?\$\{([^}]+)\}["\']?',
    re.IGNORECASE,
)

INLINE_LOGIN_RE = re.compile(
    r'login\s+(?:using|with)\s+["\']?([^"\']+@[^"\']+)["\']?\s+and\s+password\s+["\']([^"\']+)["\']',
    re.IGNORECASE,
)
EMAIL_IN_STEP_RE = re.compile(r'["\']([^"\']+@[^"\']+)["\']')
PASSWORD_IN_STEP_RE = re.compile(r'\bpassword\s+["\']([^"\']+)["\']', re.IGNORECASE)
CREDENTIAL_STEP_RE = re.compile(
    r'\b(login|sign[\s-]?in|authenticate|credentials?)\b',
    re.IGNORECASE,
)


def _credential_env_fallback_keys(key: str) -> tuple[str, ...]:
    snake = re.sub(r'(?<!^)(?=[A-Z])', '_', key).upper()
    fallbacks = [snake, key.upper()]
    if key == 'username':
        fallbacks.extend(['QA_USERNAME', 'DEV_USERNAME', 'PROD_USERNAME', 'USERNAME'])
    elif key == 'password':
        fallbacks.extend(['QA_PASSWORD', 'DEV_PASSWORD', 'PROD_PASSWORD', 'PASSWORD'])
    return tuple(dict.fromkeys(item for item in fallbacks if item))


def _is_sensitive_variable_key(key: str, value: str, credential_keys: set[str]) -> bool:
    lowered = key.lower()
    if key in credential_keys or lowered in credential_keys:
        return True
    if any(token in lowered for token in ('password', 'secret', 'token', 'apikey', 'api_key')):
        return True
    if key.upper() in {
        'QA_USERNAME', 'QA_PASSWORD',
        'DEV_USERNAME', 'DEV_PASSWORD',
        'PROD_USERNAME', 'PROD_PASSWORD',
        'USERNAME', 'PASSWORD',
    }:
        return True
    if lowered in {'username', 'user', 'email'} and '@' in value:
        return True
    return False


def load_environment_config(env_name: str) -> dict[str, Any]:
    _load_dotenv()
    config_path = resolve_environment_config_path(env_name)
    if not config_path.is_file():
        return {}
    with open(config_path, encoding='utf-8') as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {}


def build_environment_variable_map(env_name: str) -> tuple[dict[str, str], set[str]]:
    """Flatten environment JSON + credentials into ${key} lookup values."""
    config = load_environment_config(env_name)
    values: dict[str, str] = {}
    sensitive_keys: set[str] = set()

    def register(key: str, value: str, *, sensitive: bool = False) -> None:
        if not value or _is_unresolved_placeholder(value):
            return
        values[key] = value
        if key == 'baseUrl':
            values['baseURL'] = value
            values['BASE_URL'] = value
        if sensitive:
            sensitive_keys.add(key)

    for field in ('baseUrl', 'apiBaseUrl', 'environment'):
        raw = config.get(field)
        if isinstance(raw, str) and raw.strip():
            register(field, _resolve_env_vars(raw.strip()))

    for cred_key, cred_val in load_environment_credentials(env_name).items():
        register(cred_key, cred_val, sensitive=True)

    raw_config = load_environment_config(env_name)
    resolved_creds = load_environment_credentials(env_name)
    for cred_key, raw_val in (raw_config.get('credentials') or {}).items():
        resolved_val = resolved_creds.get(cred_key, '')
        if not resolved_val or _is_unresolved_placeholder(resolved_val):
            continue
        if isinstance(raw_val, str):
            env_ref = ENV_VAR_RE.fullmatch(raw_val.strip())
            if env_ref:
                register(env_ref.group(1), resolved_val, sensitive=True)

    for var_key, var_val in (config.get('variables') or {}).items():
        if var_val is not None:
            register(str(var_key), _resolve_env_vars(str(var_val)))

    return values, sensitive_keys


def _credential_placeholder_aliases(key: str) -> tuple[str, ...]:
    lowered = key.lower()
    aliases: list[str] = [key]
    if lowered in {"qa_username", "username", "user", "email"}:
        aliases.extend(["username", "QA_USERNAME", "qa_username"])
    elif lowered in {"qa_password", "password", "pass"}:
        aliases.extend(["password", "QA_PASSWORD", "qa_password"])
    return tuple(dict.fromkeys(item for item in aliases if item))


def _lookup_credential_value(key: str, env_name: str) -> str | None:
    creds = load_environment_credentials(env_name)
    for alias in _credential_placeholder_aliases(key):
        value = creds.get(alias)
        if value and not _is_unresolved_placeholder(value):
            return value
    return None


def _lookup_variable(key: str, var_map: dict[str, str]) -> str | None:
    candidates = [key, key.lower(), key.upper()]
    snake = re.sub(r'(?<!^)(?=[A-Z])', '_', key).upper()
    candidates.append(snake)
    for candidate in candidates:
        if candidate in var_map:
            return var_map[candidate]
    env_val = (os.environ.get(key) or os.environ.get(snake) or '').strip()
    if env_val and not _is_unresolved_placeholder(env_val):
        return env_val
    return None


def _resolve_env_vars(value: str) -> str:
    def repl(match: re.Match[str]) -> str:
        return os.environ.get(match.group(1), match.group(0))

    return ENV_VAR_RE.sub(repl, value)


def _is_unresolved_placeholder(value: str) -> bool:
    stripped = (value or '').strip()
    return bool(stripped) and stripped.startswith('${') and stripped.endswith('}')


def _resolve_credential_value(raw: str, *fallback_env_keys: str) -> str:
    resolved = _resolve_env_vars(raw).strip()
    if resolved and not _is_unresolved_placeholder(resolved):
        return resolved
    for key in fallback_env_keys:
        fallback = (os.environ.get(key) or '').strip()
        if fallback:
            return fallback
    return resolved


def is_unresolved_credential_placeholder(value: str) -> bool:
    return _is_unresolved_placeholder(value)


def load_environment_credentials(env_name: str) -> dict[str, str]:
    """Load resolved credentials from config/environments/<env>.json."""
    config = load_environment_config(env_name)
    raw = config.get('credentials') or {}
    resolved: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(value, str):
            resolved[key] = _resolve_credential_value(value, *_credential_env_fallback_keys(key))
    return resolved


def extract_step_credentials(step: str) -> tuple[str, dict[str, str]]:
    """Remove inline secrets from step text; return sanitized step + placeholder keys."""
    sensitive: dict[str, str] = {}
    sanitized = step

    login_match = INLINE_LOGIN_RE.search(step)
    if login_match:
        sensitive['username'] = login_match.group(1).strip()
        sensitive['password'] = login_match.group(2).strip()
        sanitized = INLINE_LOGIN_RE.sub(
            'login using <secret>username</secret> and password <secret>password</secret>',
            step,
            count=1,
        )
        return sanitized, sensitive

    email_match = EMAIL_IN_STEP_RE.search(step)
    if email_match:
        email = email_match.group(1).strip()
        sensitive['username'] = email
        sanitized = sanitized.replace(email, '<secret>username</secret>', 1)

    password_match = PASSWORD_IN_STEP_RE.search(step)
    if password_match:
        raw_password = password_match.group(1).strip()
        if not SECRET_TAG_RE.search(raw_password):
            sensitive['password'] = raw_password
            sanitized = PASSWORD_IN_STEP_RE.sub('password <secret>password</secret>', sanitized, count=1)

    return sanitized, sensitive


def resolve_step_placeholders(step: str, env_name: str) -> tuple[str, dict[str, str]]:
    """Expand ${baseURL}, ${username}, ${QA_PASSWORD}, etc. Mask secrets for the LLM."""
    var_map, sensitive_keys = build_environment_variable_map(env_name)
    sensitive: dict[str, str] = {}
    if not STEP_PLACEHOLDER_RE.search(step):
        return step, sensitive

    def replace_placeholder(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        value = _lookup_variable(key, var_map) or _lookup_credential_value(key, env_name)
        if not value:
            return match.group(0)
        if _is_sensitive_variable_key(key, value, sensitive_keys):
            sensitive[key] = value
            canonical = "username" if key.lower() in {"qa_username", "username", "user", "email"} else (
                "password" if key.lower() in {"qa_password", "password", "pass"} else key
            )
            if canonical != key:
                sensitive[canonical] = value
            return f'<secret>{canonical}</secret>'
        return value

    sanitized = STEP_PLACEHOLDER_RE.sub(replace_placeholder, step)
    pair_match = CREDENTIAL_PAIR_VARS_RE.search(step)
    if pair_match:
        for key in (pair_match.group(1).strip(), pair_match.group(2).strip()):
            value = _lookup_variable(key, var_map) or _lookup_credential_value(key, env_name)
            if value and _is_sensitive_variable_key(key, value, sensitive_keys):
                sensitive[key] = value
                canonical = "username" if key.lower() in {"qa_username", "username", "user", "email"} else (
                    "password" if key.lower() in {"qa_password", "password", "pass"} else key
                )
                if canonical != key:
                    sensitive[canonical] = value
    return sanitized, sensitive


def prepare_step(step: str, env_name: str) -> tuple[str, dict[str, str]]:
    """Resolve ${...} keys from the active environment JSON, then mask inline secrets."""
    expanded, placeholder_sensitive = resolve_step_placeholders(step, env_name)
    sanitized, inline_sensitive = extract_step_credentials(expanded)
    merged = merge_sensitive_data(placeholder_sensitive, inline_sensitive)
    return sanitized, {key: str(value) for key, value in merged.items() if value}


def is_credential_step(step: str) -> bool:
    lowered = step.lower()
    return bool(
        CREDENTIAL_STEP_RE.search(lowered)
        or 'password' in lowered
        or '@' in step
        or (
            STEP_PLACEHOLDER_RE.search(step)
            and any(token in lowered for token in ('login', 'sign', 'credential', 'password', 'username'))
        )
    )


def merge_sensitive_data(*sources: dict[str, Any] | None) -> dict[str, str | dict[str, str]]:
    merged: dict[str, str | dict[str, str]] = {}
    for source in sources:
        if not source:
            continue
        for key, value in source.items():
            if isinstance(value, dict):
                existing = merged.get(key)
                if isinstance(existing, dict):
                    existing.update(value)
                else:
                    merged[key] = dict(value)
            elif value:
                merged[key] = str(value)
    return merged


def collect_secret_values(sensitive_data: dict[str, Any] | None) -> list[str]:
    if not sensitive_data:
        return []
    values: list[str] = []
    for key, value in sensitive_data.items():
        if isinstance(value, dict):
            values.extend(str(v) for v in value.values() if v)
        elif value:
            values.append(str(value))
    # Longest first so partial replacements do not leave fragments.
    return sorted({value for value in values if value}, key=len, reverse=True)


def redact_for_logs(text: str, sensitive_data: dict[str, Any] | None = None) -> str:
    """Mask credential values before writing to stdout, reports, or execution history."""
    if not text:
        return text
    redacted = text
    for secret in collect_secret_values(sensitive_data):
        if secret in redacted:
            redacted = redacted.replace(secret, '••••••••')
    redacted = PASSWORD_IN_STEP_RE.sub('password <secret>password</secret>', redacted)
    redacted = EMAIL_IN_STEP_RE.sub('<secret>username</secret>', redacted)
    return redacted


def build_sensitive_data_from_steps(steps: list[str], env_name: str) -> tuple[list[str], dict[str, str | dict[str, str]]]:
    """Prepare sanitized steps and merged sensitive_data for the full scenario."""
    sanitized_steps: list[str] = []
    placeholders: dict[str, str] = {}
    for step in steps:
        sanitized, step_sensitive = prepare_step(step, env_name)
        sanitized_steps.append(sanitized)
        placeholders.update(step_sensitive)
    return sanitized_steps, placeholders


def task_requires_environment_credentials(task: str) -> bool:
    if STEP_PLACEHOLDER_RE.search(task):
        return True
    lowered = task.lower()
    if any(
        phrase in lowered
        for phrase in ('valid credentials', 'sign in', 'sign-in', 'login', 'password', 'authenticate')
    ):
        return True
    for line in task.splitlines():
        stripped = line.strip()
        if stripped and is_credential_step(stripped):
            return True
    return False


def flatten_sensitive_data(sensitive_data: dict[str, Any] | None) -> dict[str, str]:
    flat: dict[str, str] = {}
    if not sensitive_data:
        return flat
    for key, value in sensitive_data.items():
        if isinstance(value, dict):
            for nested_key, nested_value in value.items():
                if nested_value and not _is_unresolved_placeholder(str(nested_value)):
                    flat[nested_key] = str(nested_value)
        elif value and not _is_unresolved_placeholder(str(value)):
            flat[key] = str(value)
    return flat


def resolve_sensitive_text(value: str, sensitive_data: dict[str, Any] | None = None) -> str:
    """Replace credential placeholders with real values for browser input/replay."""
    if not value or not sensitive_data:
        return value

    flat = flatten_sensitive_data(sensitive_data)
    if not flat:
        return value

    resolved = value
    for placeholder in SECRET_TAG_RE.findall(resolved):
        secret = flat.get(placeholder)
        if secret:
            resolved = re.sub(
                rf'<secret>{re.escape(placeholder)}</secret>',
                secret,
                resolved,
                flags=re.IGNORECASE,
            )

    for key, secret in sorted(flat.items(), key=lambda item: len(item[0]), reverse=True):
        resolved = resolved.replace(f'<{key}>', secret)

    stripped = resolved.strip()
    if stripped in flat:
        return flat[stripped]

    return resolved


def enrich_step_sensitive_data(
    step: str,
    env_name: str,
    *sources: dict[str, Any] | None,
) -> dict[str, str | dict[str, str]]:
    """Merge inline, global, and environment credentials for a step."""
    _, prepared_sensitive = prepare_step(step, env_name)
    merged = merge_sensitive_data(prepared_sensitive, *sources)
    if not is_credential_step(step):
        return merged

    env_creds = load_environment_credentials(env_name)
    for key, value in env_creds.items():
        if value and not _is_unresolved_placeholder(value):
            merged[key] = value
    return merged


def credential_task_suffix(step_sensitive: dict[str, str]) -> str:
    if not step_sensitive:
        return ''
    keys = sorted(step_sensitive.keys())
    secret_examples = ', '.join(f'<secret>{key}</secret>' for key in keys[:6])
    lines = [
        '\n\nCredential handling (mandatory):',
        f'- Use these sensitive placeholders when typing: {secret_examples}.',
        '- Never type, log, or repeat literal credential values.',
    ]
    if any('password' in key.lower() for key in keys):
        lines.append('- Login is NOT complete until past any Microsoft "Stay signed in?" screen (click Yes).')
    return '\n'.join(lines)
