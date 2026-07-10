import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from integrations.browser_use.prompt_loader import load_prompt


class PromptLoaderTests(unittest.TestCase):
    def test_load_prompt_falls_back_to_install_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_root = Path(tmp) / 'project'
            install_root = Path(tmp) / 'install'
            prompt_rel = Path('browser-use/discovery-step.md')
            install_prompt = install_root / 'resources' / 'prompts' / prompt_rel
            install_prompt.parent.mkdir(parents=True)
            install_prompt.write_text('# Discovery rules\n', encoding='utf-8')
            project_root.mkdir()

            with patch('integrations.browser_use.paths.PROJECT_ROOT', project_root), patch(
                'integrations.browser_use.paths.INSTALL_ROOT', install_root
            ), patch('integrations.browser_use.paths.PROMPTS_ROOT', project_root / 'resources' / 'prompts'), patch(
                'integrations.browser_use.paths.INSTALL_PROMPTS_ROOT', install_root / 'resources' / 'prompts'
            ):
                text = load_prompt(str(prompt_rel).replace('\\', '/'))
            self.assertIn('Discovery rules', text)


if __name__ == '__main__':
    unittest.main()
