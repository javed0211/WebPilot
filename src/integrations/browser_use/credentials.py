"""Extract, mask, and wire credentials for Browser Use sensitive_data."""
from __future__ import annotations

import re
from typing import Any

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


def extract_step_credentials(step: str) -> tuple[str, dict[str, str]]:
    """Remove inline secrets from step text; return sanitized step + placeholder keys."""
    sensitive: dict[str, str] = {}
    sanitized = step

    login_match = INLINE_LOGIN_RE.search(step)
    if login_match:
        sensitive['username'] = login_match.group(1).strip()
        sensitive['password'] = login_match.group(2).strip()
        sanitized = INLINE_LOGIN_RE.sub('login using <username> and password <password>', step, count=1)
        return sanitized, sensitive

    email_match = EMAIL_IN_STEP_RE.search(step)
    if email_match:
        email = email_match.group(1).strip()
        sensitive['username'] = email
        sanitized = sanitized.replace(email, '<username>', 1)

    password_match = PASSWORD_IN_STEP_RE.search(step)
    if password_match:
        sensitive['password'] = password_match.group(1).strip()
        sanitized = PASSWORD_IN_STEP_RE.sub('password <password>', sanitized, count=1)

    return sanitized, sensitive


def is_credential_step(step: str) -> bool:
    lowered = step.lower()
    return bool(CREDENTIAL_STEP_RE.search(lowered) or 'password' in lowered or '@' in step)


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
    redacted = PASSWORD_IN_STEP_RE.sub('password <password>', redacted)
    redacted = EMAIL_IN_STEP_RE.sub('<username>', redacted)
    return redacted


def credential_task_suffix(step_sensitive: dict[str, str]) -> str:
    if not step_sensitive:
        return ''
    lines = [
        '\n\nCredential handling (mandatory):',
        '- Use <secret>username</secret> and <secret>password</secret> when typing credentials.',
        '- Never type, log, or repeat literal credential values.',
    ]
    if 'password' in step_sensitive:
        lines.append('- Login is NOT complete until past any Microsoft "Stay signed in?" screen (click Yes).')
    return '\n'.join(lines)
