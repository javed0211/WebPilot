from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

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

    workspace = tmp_path / "codegen-workspace"
    (workspace / "pages").mkdir(parents=True)
    (workspace / "tests").mkdir(parents=True)
    project_root = tmp_path / "project"
    project_root.mkdir()

    result = run_openhands_codegen(
        execution_history_path=str(history_path),
        slug=slug,
        workspace=str(workspace),
        project_root=str(project_root),
        spec_path=f"tests/{slug}.spec.ts",
    )

    assert result["success"] is True
    assert result["workspace"] == str(workspace.resolve())
    spec_abs = workspace / "tests" / f"{slug}.spec.ts"
    page_abs = workspace / "pages" / f"{slug}.page.ts"
    assert spec_abs.exists()
    assert page_abs.exists()
    changed = {item["path"] for item in result["filesChanged"]}
    # Outside project_root → absolute paths are acceptable; prefer relative when under project.
    assert any(slug in path for path in changed)
    assert len(changed) >= 2
