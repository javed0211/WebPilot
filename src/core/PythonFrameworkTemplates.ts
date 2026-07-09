import * as fs from 'fs';
import * as path from 'path';

export const PYTHON_FRAMEWORK_PATHS = {
  pyproject: 'pyproject.toml',
  conftest: 'tests/conftest.py',
  generatedInit: 'tests/generated/__init__.py',
  pagesInit: 'tests/generated/pages/__init__.py',
  basePage: 'tests/generated/pages/base_page.py',
  configManager: 'tests/support/__init__.py',
  supportConfig: 'tests/support/config_manager.py',
  sampleTest: 'tests/generated/test_automationexercise_smoke.py',
} as const;

export function isFullPythonPlaywright(profile: {
  language: string;
  automationTool: string;
}): boolean {
  return profile.language === 'python' && profile.automationTool === 'playwright';
}

export function buildPyprojectToml(projectName: string): string {
  return `[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "${projectName}"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "playwright>=1.49.0",
  "pytest>=8.0.0",
  "pytest-playwright>=0.5.2",
]

[tool.pytest.ini_options]
testpaths = ["tests/generated"]
pythonpath = ["."]
addopts = "-q"
`;
}

export const PYTHON_CONFTEST = `import json
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
`;

export const PYTHON_BASE_PAGE = `import re
from playwright.sync_api import Locator, Page, expect


class BasePage:
    """Shared Playwright helpers for WebPilot-generated page objects."""

    def __init__(self, page: Page) -> None:
        self.page = page

    def navigate(self, url: str) -> None:
        self.page.goto(url, wait_until="load")

    def click_by_role(self, role: str, **kwargs) -> None:
        self.page.get_by_role(role, **kwargs).click()

    def fill_by_label(self, label: str, value: str) -> None:
        self.page.get_by_label(label).fill(value)

    def fill_by_placeholder(self, placeholder: str, value: str) -> None:
        self.page.get_by_placeholder(placeholder).fill(value)

    def assert_url(self, pattern: str | re.Pattern[str]) -> None:
        expect(self.page).to_have_url(pattern)

    def assert_element_visible(self, selector: str) -> None:
        expect(self.page.locator(selector)).to_be_visible()

    def assert_heading_visible(self, text: str | re.Pattern[str]) -> None:
        expect(self.page.get_by_role("heading", name=text)).to_be_visible()

    def assert_count_at_least(self, locator: Locator, minimum: int) -> None:
        count = locator.count()
        assert count >= minimum, f"Expected at least {minimum} elements, found {count}"
`;

export const PYTHON_CONFIG_MANAGER = `import json
import os
import re
from pathlib import Path
from typing import Any


class ConfigManager:
  """Load WebPilot environment JSON (resources/config/environments/<env>.json)."""

  _instance: dict[str, Any] | None = None

  @classmethod
  def get_config(cls) -> dict[str, Any]:
    if cls._instance is not None:
      return cls._instance
    env = os.environ.get("ENV", "qa")
    config_path = Path.cwd() / "resources" / "config" / "environments" / f"{env}.json"
    if not config_path.exists():
      raise FileNotFoundError(f'Configuration file not found for environment "{env}": {config_path}')
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    cls._instance = cls._resolve_env_vars(raw)
    return cls._instance

  @classmethod
  def _resolve_env_vars(cls, obj: Any) -> Any:
    if isinstance(obj, str):
      return re.sub(
        r"\\$\\{(\\w+)\\}",
        lambda match: os.environ.get(match.group(1), match.group(0)),
        obj,
      )
    if isinstance(obj, list):
      return [cls._resolve_env_vars(item) for item in obj]
    if isinstance(obj, dict):
      return {key: cls._resolve_env_vars(value) for key, value in obj.items()}
    return obj


config = ConfigManager.get_config()
`;

export const PYTHON_SAMPLE_TEST = `import re

from playwright.sync_api import Page, expect

from tests.generated.pages.base_page import BasePage


def test_automationexercise_smoke(page: Page) -> None:
    home = BasePage(page)
    home.navigate("https://automationexercise.com/")
    expect(page).to_have_title(re.compile(r"Automation Exercise", re.I))
`;

export const PYTHON_PACKAGE_INIT = '';
export const PYTHON_PAGES_INIT = `from tests.generated.pages.base_page import BasePage

__all__ = ["BasePage"]
`;

export interface PythonFrameworkFile {
  path: string;
  content: string;
}

export function pythonFrameworkFiles(projectName: string): PythonFrameworkFile[] {
  return [
    { path: PYTHON_FRAMEWORK_PATHS.pyproject, content: buildPyprojectToml(projectName) },
    { path: PYTHON_FRAMEWORK_PATHS.conftest, content: PYTHON_CONFTEST },
    { path: PYTHON_FRAMEWORK_PATHS.generatedInit, content: PYTHON_PACKAGE_INIT },
    { path: PYTHON_FRAMEWORK_PATHS.pagesInit, content: PYTHON_PAGES_INIT },
    { path: PYTHON_FRAMEWORK_PATHS.basePage, content: PYTHON_BASE_PAGE },
    { path: PYTHON_FRAMEWORK_PATHS.configManager, content: PYTHON_PACKAGE_INIT },
    { path: PYTHON_FRAMEWORK_PATHS.supportConfig, content: PYTHON_CONFIG_MANAGER },
    { path: PYTHON_FRAMEWORK_PATHS.sampleTest, content: PYTHON_SAMPLE_TEST },
  ];
}

/** Write missing Python Playwright framework files (safe for existing projects). */
export function ensurePythonPlaywrightFramework(
  cwd = process.cwd(),
  projectName = 'webpilot-project'
): string[] {
  const written: string[] = [];
  for (const file of pythonFrameworkFiles(projectName)) {
    const fullPath = path.join(cwd, file.path);
    if (fs.existsSync(fullPath)) {
      continue;
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content.trimEnd() + '\n', 'utf8');
    written.push(file.path);
  }
  return written;
}

export function readProjectName(cwd = process.cwd()): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name && pkg.name !== '') {
      return pkg.name;
    }
  } catch {
    // ignore
  }
  return 'webpilot-project';
}
