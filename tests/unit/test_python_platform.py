from pathlib import Path

from webpilot.codegen import merge_page_object, normalize_generated_file
from webpilot.specs import parse_api_spec


def test_codegen_normalizes_python_locator_lambda_calls() -> None:
    item = normalize_generated_file(
        {
            "path": "framework/tests/test_generated_name.py",
            "content": "locator = self.SEARCH_FIELD(self)\n",
        },
        "scenario_slug",
    )
    assert item["path"] == "framework/tests/test_scenario_slug.py"
    assert "self.SEARCH_FIELD()" in item["content"]


def test_page_merge_preserves_existing_and_adds_new_methods() -> None:
    existing = """class ExamplePage:
    def existing(self):
        return True
"""
    generated = """class ExamplePage:
    SEARCH = lambda self: self.page.locator("#search")

    def generated(self):
        return self.SEARCH()
"""
    merged = merge_page_object(existing, generated)
    assert "def existing" in merged
    assert "SEARCH = lambda" in merged
    assert "def generated" in merged


def test_api_parser_keeps_token_chaining(tmp_path: Path) -> None:
    spec = tmp_path / "login.txt"
    spec.write_text(
        """Test: Login
Send POST request to {{apiBaseUrl}}/auth/login
With body payload {"username": "u"}
Extract response body.accessToken into token
Send GET request to {{apiBaseUrl}}/auth/me
With Headers {"Authorization": "Bearer {{token}}"}
Assert status is 200
""",
        encoding="utf-8",
    )
    scenario = parse_api_spec(spec)
    assert scenario.steps[0].extracted_variables == {"accessToken": "token"}
    assert scenario.steps[1].headers["Authorization"] == "Bearer {{token}}"
    assert scenario.steps[1].expected_status == 200
