import unittest

from integrations.browser_use.credentials import (
    extract_step_credentials,
    is_credential_step,
    redact_for_logs,
)


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
        self.assertIn('<username>', sanitized)
        self.assertIn('<password>', sanitized)

    def test_redact_for_logs_masks_values(self):
        step = 'login using "user@example.com" and password "secret123"'
        _, sensitive = extract_step_credentials(step)
        redacted = redact_for_logs(step, sensitive)
        self.assertNotIn('secret123', redacted)
        self.assertNotIn('user@example.com', redacted)

    def test_is_credential_step(self):
        self.assertTrue(is_credential_step('login using <username> and password <password>'))
        self.assertFalse(is_credential_step('click on application link'))


if __name__ == '__main__':
    unittest.main()
