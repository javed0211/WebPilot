"""Load editable Markdown prompts from resources/prompts/."""

from __future__ import annotations

from pathlib import Path

from .paths import INSTALL_PROMPTS_ROOT, PROMPTS_ROOT, resolve_prompt_path


def _read(path: Path) -> str:
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def load_prompt(relative_path: str) -> str:
    full = resolve_prompt_path(relative_path)
    if not full.is_file():
        searched = [str(PROMPTS_ROOT / relative_path), str(INSTALL_PROMPTS_ROOT / relative_path)]
        raise FileNotFoundError(
            f'Prompt file not found: resources/prompts/{relative_path} '
            f'(searched: {", ".join(searched)})'
        )
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
    """Scoped / per-step discovery: includes stop-after-one-action done() rules."""
    return load_prompt('browser-use/discovery-step.md')


def load_discovery_native_rules() -> str:
    """Full-scenario native agent: locator hints only — never early done() rules."""
    try:
        return load_prompt('browser-use/discovery-native.md')
    except FileNotFoundError:
        # Older installs may only ship discovery-step.md; strip early-stop sections.
        text = load_discovery_step_rules()
        for marker in (
            '## Before calling done(success=true)',
            '## After performing the step action (critical)',
        ):
            idx = text.find(marker)
            if idx >= 0:
                text = text[:idx].rstrip()
        return (
            text
            + '\n\nWork through every numbered Test step in order. '
            'Call done(success=true) only when the last step is complete.\n'
        )
