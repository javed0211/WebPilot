import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from integrations.browser_use.credentials import (
    build_environment_variable_map,
    load_environment_config,
    load_environment_credentials,
    prepare_step,
)
from integrations.browser_use.paths import resolve_environment_config_path

REPO_ROOT = Path(__file__).resolve().parents[2]
QA_JSON = REPO_ROOT / 'resources' / 'config' / 'environments' / 'qa.json'


class QaEnvironmentConfigTests(unittest.TestCase):
    def test_qa_json_exists(self):
        self.assertTrue(QA_JSON.is_file(), f'missing {QA_JSON}')

    def test_resolve_environment_config_path_from_repo_root(self):
        os.chdir(REPO_ROOT)
        resolved = resolve_environment_config_path('qa')
        self.assertEqual(resolved.resolve(), QA_JSON.resolve())

    def test_webpilot_project_root_env_overrides_cwd(self):
        os.chdir(REPO_ROOT / 'packages' / 'test-framework')
        with patch.dict(os.environ, {'WEBPILOT_PROJECT_ROOT': str(REPO_ROOT)}, clear=False):
            resolved = resolve_environment_config_path('qa')
        self.assertEqual(resolved.resolve(), QA_JSON.resolve())

    def test_webpilot_project_root_accepts_windows_style_path_string(self):
        """CLI may set WEBPILOT_PROJECT_ROOT with backslashes on Windows."""
        windows_style = str(REPO_ROOT).replace('/', '\\')
        with patch.dict(os.environ, {'WEBPILOT_PROJECT_ROOT': windows_style}, clear=False):
            os.chdir(REPO_ROOT / 'packages' / 'test-framework')
            resolved = resolve_environment_config_path('qa')
        self.assertEqual(resolved.resolve(), QA_JSON.resolve())

    def test_load_environment_config_reads_qa_fields(self):
        os.chdir(REPO_ROOT)
        config = load_environment_config('qa')
        self.assertEqual(config.get('environment'), 'qa')
        self.assertEqual(config.get('baseUrl'), 'https://automationexercise.com')
        self.assertEqual(config.get('apiBaseUrl'), 'https://dummyjson.com')
        self.assertEqual(config.get('variables', {}).get('timeout'), 30000)

    def test_credentials_resolve_from_env_vars(self):
        os.chdir(REPO_ROOT)
        with patch.dict(
            os.environ,
            {'QA_USERNAME': 'qa-user@example.com', 'QA_PASSWORD': 'qa-secret'},
            clear=False,
        ):
            creds = load_environment_credentials('qa')
        self.assertEqual(creds['username'], 'qa-user@example.com')
        self.assertEqual(creds['password'], 'qa-secret')

    def test_var_map_registers_credential_aliases(self):
        os.chdir(REPO_ROOT)
        with patch.dict(
            os.environ,
            {'QA_USERNAME': 'qa-user@example.com', 'QA_PASSWORD': 'qa-secret'},
            clear=False,
        ):
            var_map, sensitive = build_environment_variable_map('qa')
        self.assertEqual(var_map['baseURL'], 'https://automationexercise.com')
        self.assertEqual(var_map['username'], 'qa-user@example.com')
        self.assertEqual(var_map['QA_USERNAME'], 'qa-user@example.com')
        self.assertIn('username', sensitive)
        self.assertIn('QA_USERNAME', sensitive)

    def test_prepare_step_resolves_qa_username_placeholder(self):
        os.chdir(REPO_ROOT)
        with patch.dict(
            os.environ,
            {'QA_USERNAME': 'qa-user@example.com', 'QA_PASSWORD': 'qa-secret'},
            clear=False,
        ):
            sanitized, sensitive = prepare_step('Login with ${QA_USERNAME} / ${QA_PASSWORD}', 'qa')
        self.assertIn('<secret>username</secret>', sanitized)
        self.assertIn('<secret>password</secret>', sanitized)
        self.assertEqual(sensitive['QA_USERNAME'], 'qa-user@example.com')


if __name__ == '__main__':
    unittest.main()
