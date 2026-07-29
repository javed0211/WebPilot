from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from integrations.browser_use.paths import PROJECT_ROOT
from integrations.openhands_codegen.runner import run_openhands_codegen


def test_openhands_codegen_mock_writes_spec_and_page(tmp_path, monkeypatch):
    slug = "tmp_openhands_codegen_mock"
    history_path = tmp_path / f"{slug}.json"
    history_path.write_text(
        json.dumps(
            {
                "testName": "Mock OpenHands",
                "isSuccessful": True,
                "nlSteps": ["Navigate to https://example.com/"],
                "urlSequence": ["https://example.com/"],
                "compactWorkflow": {
                    "steps": [
                        {
                            "index": 1,
                            "action": "navigate",
                            "url": "https://example.com/",
                            "nlStep": "Navigate to https://example.com/",
                        }
                    ],
                    "dropped": [],
                    "coverage": {"nlTotal": 1, "mapped": 1, "unmapped": []},
                },
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("WEBPILOT_OPENHANDS_MOCK", "1")

    spec_path = f"packages/test-framework/tests/{slug}.spec.ts"
    page_path = PROJECT_ROOT / "packages" / "test-framework" / "pages" / f"{slug}.page.ts"
    spec_abs = PROJECT_ROOT / spec_path
    for target in (spec_abs, page_path):
        if target.exists():
            target.unlink()

    result = run_openhands_codegen(
        execution_history_path=str(history_path),
        slug=slug,
        workspace=str(PROJECT_ROOT),
        spec_path=spec_path,
    )

    assert result["success"] is True
    assert spec_abs.exists()
    assert page_path.exists()
    changed = {item["path"] for item in result["filesChanged"]}
    assert spec_path in changed
    assert f"packages/test-framework/pages/{slug}.page.ts" in changed

    spec_abs.unlink(missing_ok=True)
    page_path.unlink(missing_ok=True)
