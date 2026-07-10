"""Stable repository paths for the Browser Use integration."""

import os
from pathlib import Path

INSTALL_ROOT = Path(os.environ.get('WEBPILOT_INSTALL_ROOT') or Path(__file__).resolve().parents[3])
PROJECT_ROOT = Path(os.environ.get('WEBPILOT_PROJECT_ROOT') or Path.cwd()).resolve()
BROWSER_USE_SOURCE_ROOT = INSTALL_ROOT / 'packages' / 'browser-use'
TEST_FRAMEWORK_ROOT = PROJECT_ROOT / 'packages' / 'test-framework'
RESOURCES_ROOT = PROJECT_ROOT / 'resources'
CONFIG_ROOT = RESOURCES_ROOT / 'config'
PROMPTS_ROOT = RESOURCES_ROOT / 'prompts'
INSTALL_RESOURCES_ROOT = INSTALL_ROOT / 'resources'
INSTALL_PROMPTS_ROOT = INSTALL_RESOURCES_ROOT / 'prompts'
ASSETS_ROOT = RESOURCES_ROOT / 'assets'
RUNTIME_ROOT = PROJECT_ROOT / 'runtime'
REPORTS_ROOT = RUNTIME_ROOT / 'reports'
REPORTS_HTML_DIR = REPORTS_ROOT / 'html'
REPORTS_DATA_DIR = REPORTS_ROOT / 'data'
REPORTS_SUMMARIES_DIR = REPORTS_DATA_DIR / 'summaries'
REPORTS_EXECUTION_HISTORY_DIR = REPORTS_DATA_DIR / 'execution-history'
REPORTS_LLM_USAGE_DIR = REPORTS_DATA_DIR / 'llm-usage'
REPORTS_API_DIR = REPORTS_DATA_DIR / 'api'
REPORTS_LOGS_DIR = REPORTS_DATA_DIR / 'logs'
REPORTS_MARKDOWN_DIR = REPORTS_ROOT / 'markdown'
REPORTS_JUNIT_DIR = REPORTS_ROOT / 'junit'
REPORTS_VIDEOS_DIR = REPORTS_ROOT / 'videos'
REPORTS_TRACES_DIR = REPORTS_ROOT / 'traces'
REPORTS_SCREENSHOTS_DIR = REPORTS_ROOT / 'screenshots'
REPORTS_ASSETS_DIR = REPORTS_ROOT / 'assets'
REPORTS_HISTORY_DIR = REPORTS_ROOT / 'history'
def resolve_prompt_path(relative_path: str) -> Path:
    """Prefer project prompts, then fall back to the installed WebPilot package."""
    relative = Path(relative_path)
    candidates = (
        PROMPTS_ROOT / relative,
        INSTALL_PROMPTS_ROOT / relative,
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return candidates[0]


def ensure_report_dirs() -> None:
    for directory in (
        REPORTS_HTML_DIR,
        REPORTS_SUMMARIES_DIR,
        REPORTS_EXECUTION_HISTORY_DIR,
        REPORTS_LLM_USAGE_DIR,
        REPORTS_API_DIR,
        REPORTS_LOGS_DIR,
        REPORTS_MARKDOWN_DIR,
        REPORTS_JUNIT_DIR,
        REPORTS_VIDEOS_DIR,
        REPORTS_TRACES_DIR,
        REPORTS_SCREENSHOTS_DIR,
        REPORTS_ASSETS_DIR,
        REPORTS_HISTORY_DIR,
    ):
        directory.mkdir(parents=True, exist_ok=True)
    migrate_legacy_report_files()


def migrate_legacy_report_files() -> int:
    if not REPORTS_ROOT.is_dir():
        return 0

    rules = (
        (lambda name: name.endswith('_summary.json'), REPORTS_SUMMARIES_DIR),
        (lambda name: name.endswith('_execution_history.json'), REPORTS_EXECUTION_HISTORY_DIR),
        (lambda name: name.endswith('_llm_usage.json'), REPORTS_LLM_USAGE_DIR),
        (lambda name: name.startswith('api-') and name.endswith('.json'), REPORTS_API_DIR),
        (lambda name: name.endswith('-report.html'), REPORTS_HTML_DIR),
        (lambda name: name == 'index.html', REPORTS_HTML_DIR),
        (lambda name: name == 'execution_analysis_report.md', REPORTS_MARKDOWN_DIR),
        (lambda name: name == 'junit-results.xml', REPORTS_JUNIT_DIR),
        (lambda name: name.endswith('_cli_output.txt'), REPORTS_LOGS_DIR),
    )

    moved = 0
    for name in os.listdir(REPORTS_ROOT):
        source = REPORTS_ROOT / name
        if not source.is_file():
            continue
        for matcher, dest_dir in rules:
            if not matcher(name):
                continue
            dest_dir.mkdir(parents=True, exist_ok=True)
            destination = dest_dir / name
            if destination.exists():
                source.unlink()
            else:
                source.rename(destination)
            moved += 1
            break
    return moved


def summary_path(slug: str) -> Path:
    return REPORTS_SUMMARIES_DIR / f'{slug}_summary.json'


def execution_history_path(slug: str) -> Path:
    return REPORTS_EXECUTION_HISTORY_DIR / f'{slug}_execution_history.json'


def llm_usage_path(slug: str) -> Path:
    return REPORTS_LLM_USAGE_DIR / f'{slug}_llm_usage.json'


def resolve_summary_path(slug: str) -> Path:
    path = summary_path(slug)
    if path.exists():
        return path
    legacy = REPORTS_ROOT / f'{slug}_summary.json'
    if legacy.exists():
        return legacy
    return path


def resolve_execution_history_path(slug: str) -> Path:
    path = execution_history_path(slug)
    if path.exists():
        return path
    legacy = REPORTS_ROOT / f'{slug}_execution_history.json'
    if legacy.exists():
        return legacy
    return path
