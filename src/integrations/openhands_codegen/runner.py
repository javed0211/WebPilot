from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

from integrations.browser_use.paths import PROJECT_ROOT, TEST_FRAMEWORK_ROOT

from .llm_bridge import resolve_openhands_llm
from .prompt import build_codegen_prompt


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _collect_changed_files(paths: list[Path]) -> list[dict[str, str]]:
    changed: list[dict[str, str]] = []
    for file_path in paths:
        if not file_path.exists() or not file_path.is_file():
            continue
        changed.append(
            {
                "path": str(file_path.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                "content": file_path.read_text(encoding="utf-8"),
            }
        )
    return changed


def _slug_to_class_name(slug: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", slug)
    return "".join(word[:1].upper() + word[1:] for word in words) or "Generated"


def _mock_write_files(spec_path: Path, slug: str, history: dict[str, Any]) -> list[Path]:
    pages_dir = TEST_FRAMEWORK_ROOT / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    spec_path.parent.mkdir(parents=True, exist_ok=True)

    page_class = f"{_slug_to_class_name(slug)}Page"
    page_file = pages_dir / f"{slug}.page.ts"
    base_url = ""
    for raw in history.get("urlSequence") or []:
        if raw:
            base_url = raw
            break
    if not base_url:
        for step in (history.get("compactWorkflow") or {}).get("steps") or []:
            if step.get("url"):
                base_url = str(step["url"])
                break

    page_file.write_text(
        f"""import {{ Page, expect }} from '@playwright/test';
import {{ BasePage }} from '@core/BasePage';

export class {page_class} extends BasePage {{
  constructor(page: Page) {{
    super(page);
  }}

  async open(): Promise<void> {{
    await this.navigate('{base_url}');
  }}

  async expectReady(): Promise<void> {{
    await expect(this.getPage()).toHaveURL(/.*/);
  }}
}}
""",
        encoding="utf-8",
    )

    spec_path.write_text(
        f"""import {{ test, expect }} from '@playwright/test';
import {{ {page_class} }} from '@pages/{slug}.page';

test('{slug}', async ({{ page }}) => {{
  const view = new {page_class}(page);
  await view.open();
  await view.expectReady();
  await expect(page).toHaveURL(/.*/);
}});
""",
        encoding="utf-8",
    )
    return [page_file, spec_path]


def _run_openhands(prompt: str, workspace: Path) -> dict[str, Any]:
    llm_cfg = resolve_openhands_llm()
    try:
        from openhands import Agent, Conversation, LLM
        from openhands.tools import FileEditorTool, TaskTrackerTool, TerminalTool
    except Exception as exc:  # pragma: no cover - import error is surfaced cleanly
        raise RuntimeError(
            "OpenHands SDK is not installed. Run: pip install -U openhands-sdk openhands-tools"
        ) from exc

    llm = LLM(
        model=llm_cfg["model"],
        api_key=llm_cfg.get("api_key") or None,
        base_url=llm_cfg.get("base_url") or None,
        api_version=llm_cfg.get("api_version") or None,
    )
    conversation = Conversation()
    agent = Agent(
        llm=llm,
        conversation=conversation,
        tools=[
            TerminalTool(workspace=str(workspace)),
            FileEditorTool(workspace=str(workspace)),
            TaskTrackerTool(),
        ],
        max_iterations=int(os.environ.get("WEBPILOT_OPENHANDS_MAX_ITERATIONS", "40")),
    )
    result = agent.run(prompt)
    return {"raw": result, "model": llm_cfg["model"]}


def run_openhands_codegen(
    execution_history_path: str,
    slug: str,
    workspace: str | None = None,
    spec_path: str | None = None,
    test_file_path: str | None = None,
) -> dict[str, Any]:
    history_path = Path(execution_history_path).resolve()
    repo_root = Path(workspace).resolve() if workspace else PROJECT_ROOT
    spec_target = (repo_root / spec_path).resolve() if spec_path else (repo_root / "packages" / "test-framework" / "tests" / f"{slug}.spec.ts")
    history = _read_json(history_path)
    prompt = build_codegen_prompt(
        slug=slug,
        spec_path=str(spec_target.relative_to(repo_root)).replace("\\", "/"),
        history=history,
        test_file_path=test_file_path,
    )

    if os.environ.get("WEBPILOT_OPENHANDS_MOCK") == "1":
        changed = _mock_write_files(spec_target, slug, history)
        files_changed = _collect_changed_files(changed)
        return {
            "success": True,
            "filesChanged": files_changed,
            "summary": f"Codegen (openhands mock) wrote {len(files_changed)} file(s) for {slug}.",
        }

    _run_openhands(prompt, repo_root)

    candidates = [spec_target]
    pages_dir = TEST_FRAMEWORK_ROOT / "pages"
    if pages_dir.exists():
        candidates.extend(path for path in pages_dir.rglob("*.ts"))
    files_changed = _collect_changed_files(candidates)
    return {
        "success": True,
        "filesChanged": files_changed,
        "summary": f"Codegen (openhands) wrote {len(files_changed)} file(s) for {slug}.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run OpenHands-backed WebPilot codegen")
    parser.add_argument("execution_history_path")
    parser.add_argument("slug")
    parser.add_argument("--workspace", default=str(PROJECT_ROOT))
    parser.add_argument("--spec-path", default=None)
    parser.add_argument("--test-file-path", default=None)
    parser.add_argument("--validate", default="1")
    args = parser.parse_args(argv)

    try:
        result = run_openhands_codegen(
            execution_history_path=args.execution_history_path,
            slug=args.slug,
            workspace=args.workspace,
            spec_path=args.spec_path,
            test_file_path=args.test_file_path,
        )
    except Exception as exc:  # pragma: no cover - CLI guard
        result = {"success": False, "summary": str(exc), "error": str(exc), "filesChanged": []}

    print(json.dumps(result))
    return 0 if result.get("success") else 1
