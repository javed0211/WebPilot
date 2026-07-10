"""Load editable Markdown prompts from resources/prompts/."""

from __future__ import annotations

from pathlib import Path

from .paths import PROMPTS_ROOT


def _read(path: Path) -> str:
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def load_prompt(relative_path: str) -> str:
    full = PROMPTS_ROOT / relative_path
    if not full.is_file():
        raise FileNotFoundError(f'Prompt file not found: resources/prompts/{relative_path}')
    return _read(full)


def load_prompt_with_vars(relative_path: str, **vars: str) -> str:
    text = load_prompt(relative_path)
    for key, value in vars.items():
        text = text.replace(f'{{{{{key}}}}}', value or '')
    return text


def load_framework_rules() -> str:
    parts = [
        '=== LOCATOR STRICT RULES (mandatory) ===',
        load_prompt('shared/locator-strict-rules.md'),
        '',
        '=== FRAMEWORK GUIDELINES ===',
        load_prompt('shared/framework-guidelines.md'),
        '',
        '=== AUTOMATION EXERCISE CATALOG ===',
        load_prompt('shared/automationexercise-catalog.md'),
    ]
    return '\n'.join(parts)


def load_discovery_step_rules() -> str:
    return load_prompt('browser-use/discovery-step.md')
