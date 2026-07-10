import os
import unittest
from unittest.mock import patch

from integrations.browser_use.credentials import (
    build_environment_variable_map,
    enrich_step_sensitive_data,
    extract_step_credentials,
    is_credential_step,
    prepare_step,
    redact_for_logs,
    resolve_sensitive_text,
    task_requires_environment_credentials,
)

QA_ENV = {
    'baseUrl': 'https://automationexercise.com',
    'credentials': {
        'username': '${QA_USERNAME}',
        'password': '${QA_PASSWORD}',
    },
    'variables': {},
}

ADMIN_ENV = {
    'credentials': {
        'adminUsername': '${ADMIN_USERNAME}',
        'adminPassword': '${ADMIN_PASSWORD}',
    },
    'variables': {},
}


class CredentialTests(unittest.TestCase):
    def test_extract_inline_login_credentials(self):
        step = (
            'login using "svc_auto15_nonprod@bhwuk.onmicrosoft.com" '
            'and password "kL=.wjJ~\'q7!yz6MLefvXTCg8cR(>"'
        )
        sanitized, sensitive = extract_step_credentials(step)
        self.assertEqual(sensitive['username'], 'svc_auto15_nonprod@bhwuk.onmicrosoft.com')
        self.assertIn('password', sensitive)
        self.assertNotIn('kL=.wjJ', sanitized)
        self.assertIn('<secret>username</secret>', sanitized)
        self.assertIn('<secret>password</secret>', sanitized)

    def test_redact_for_logs_masks_values(self):
        step = 'login using "user@example.com" and password "secret123"'
        _, sensitive = extract_step_credentials(step)
        redacted = redact_for_logs(step, sensitive)
        self.assertNotIn('secret123', redacted)
        self.assertNotIn('user@example.com', redacted)

    def test_is_credential_step(self):
        self.assertTrue(is_credential_step('login using <secret>username</secret> and password <secret>password</secret>'))
        self.assertFalse(is_credential_step('click on application link'))

    def test_resolve_sensitive_text_supports_secret_tags(self):
        sensitive = {'username': 'user@example.com', 'password': 'secret123'}
        resolved = resolve_sensitive_text('<secret>password</secret>', sensitive)
        self.assertEqual(resolved, 'secret123')

    def test_resolve_sensitive_text_supports_angle_placeholders(self):
        sensitive = {'password': 'secret123'}
        resolved = resolve_sensitive_text('<password>', sensitive)
        self.assertEqual(resolved, 'secret123')

    def test_resolve_sensitive_text_supports_literal_key(self):
        sensitive = {'password': 'secret123'}
        resolved = resolve_sensitive_text('password', sensitive)
        self.assertEqual(resolved, 'secret123')

    def test_task_requires_environment_credentials_for_sign_in_step(self):
        task = "Please execute the following test scenario step-by-step:\nSign in using the QA account"
        self.assertTrue(task_requires_environment_credentials(task))

    @patch('integrations.browser_use.credentials.load_environment_config')
    def test_prepare_step_resolves_base_url_placeholder(self, mock_load_config):
        mock_load_config.return_value = {
            'baseUrl': 'https://automationexercise.com',
            'credentials': {},
            'variables': {},
        }
        sanitized, sensitive = prepare_step('Navigate to ${baseURL}', 'qa')
        self.assertEqual(sanitized, 'Navigate to https://automationexercise.com')
        self.assertEqual(sensitive, {})

    @patch('integrations.browser_use.credentials.load_environment_config')
    def test_prepare_step_masks_credential_placeholders(self, mock_load_config):
        mock_load_config.return_value = QA_ENV
        with patch.dict(os.environ, {'QA_USERNAME': 'qa-user@example.com', 'QA_PASSWORD': 'qa-pass'}):
            sanitized, sensitive = prepare_step(
                'Login using credentials ${QA_USERNAME} and ${QA_PASSWORD}',
                'qa',
            )
        self.assertIn('<secret>username</secret>', sanitized)
        self.assertIn('<secret>password</secret>', sanitized)
        self.assertEqual(sensitive['username'], 'qa-user@example.com')
        self.assertEqual(sensitive['password'], 'qa-pass')
        self.assertEqual(sensitive['QA_USERNAME'], 'qa-user@example.com')
        self.assertEqual(sensitive['QA_PASSWORD'], 'qa-pass')

    @patch('integrations.browser_use.credentials.load_environment_config')
    def test_prepare_step_supports_multiple_credential_keys(self, mock_load_config):
        mock_load_config.return_value = ADMIN_ENV
        with patch.dict(os.environ, {'ADMIN_USERNAME': 'admin@example.com', 'ADMIN_PASSWORD': 'admin-pass'}):
            sanitized, sensitive = prepare_step(
                'Login as admin using ${adminUsername} and ${adminPassword}',
                'qa',
            )
        self.assertIn('<secret>adminUsername</secret>', sanitized)
        self.assertIn('<secret>adminPassword</secret>', sanitized)
        self.assertEqual(sensitive['adminUsername'], 'admin@example.com')
        self.assertEqual(sensitive['adminPassword'], 'admin-pass')

    @patch('integrations.browser_use.credentials.load_environment_config')
    def test_build_environment_variable_map_includes_aliases(self, mock_load_config):
        mock_load_config.return_value = {
            'baseUrl': 'https://automationexercise.com',
            'credentials': {},
            'variables': {},
        }
        var_map, _ = build_environment_variable_map('qa')
        self.assertEqual(var_map['baseURL'], 'https://automationexercise.com')
        self.assertEqual(var_map['baseUrl'], 'https://automationexercise.com')

    @patch('integrations.browser_use.credentials.load_environment_config')
    def test_prepare_step_masks_quoted_credential_placeholders(self, mock_load_config):
        mock_load_config.return_value = QA_ENV
        with patch.dict(os.environ, {'QA_USERNAME': 'qa-user@example.com', 'QA_PASSWORD': 'qa-pass'}):
            sanitized, sensitive = prepare_step(
                'login using "${QA_USERNAME}" and password "${QA_PASSWORD}"',
                'qa',
            )
        self.assertIn('<secret>username</secret>', sanitized)
        self.assertIn('<secret>password</secret>', sanitized)
        self.assertNotIn('${QA_USERNAME}', sanitized)
        self.assertEqual(sensitive['username'], 'qa-user@example.com')
        self.assertEqual(sensitive['password'], 'qa-pass')

    @patch('integrations.browser_use.credentials.load_environment_config')
    def test_enrich_step_sensitive_data_merges_env_credentials(self, mock_load_config):
        mock_load_config.return_value = QA_ENV
        with patch.dict(os.environ, {'QA_USERNAME': 'qa-user@example.com', 'QA_PASSWORD': 'qa-pass'}):
            merged = enrich_step_sensitive_data(
                'Sign in with valid credentials',
                'qa',
                {},
            )
        self.assertEqual(merged['username'], 'qa-user@example.com')
        self.assertEqual(merged['password'], 'qa-pass')


if __name__ == '__main__':
    unittest.main()
