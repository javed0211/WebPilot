"""Load editable Markdown prompts from prompts/ (see prompts/README.md)."""

from __future__ import annotations

import os

PROMPTS_ROOT = os.path.join(os.getcwd(), 'prompts')


def _read(path: str) -> str:
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def load_prompt(relative_path: str) -> str:
    full = os.path.join(PROMPTS_ROOT, relative_path)
    if not os.path.isfile(full):
        raise FileNotFoundError(f'Prompt file not found: prompts/{relative_path}')
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
