from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

from integrations.browser_use.paths import PROJECT_ROOT

from .llm_bridge import resolve_openhands_llm
from .prompt import build_codegen_prompt


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _rel_to_project(path: Path, project_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(project_root.resolve())).replace("\\", "/")
    except ValueError:
        return str(path.resolve()).replace("\\", "/")


def _collect_changed_files(paths: list[Path], project_root: Path) -> list[dict[str, str]]:
    changed: list[dict[str, str]] = []
    for file_path in paths:
        if not file_path.exists() or not file_path.is_file():
            continue
        changed.append(
            {
                "path": _rel_to_project(file_path, project_root),
                "content": file_path.read_text(encoding="utf-8"),
            }
        )
    return changed


def _slug_to_class_name(slug: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", slug)
    return "".join(word[:1].upper() + word[1:] for word in words) or "Generated"


def _mock_write_files(workspace: Path, spec_path: Path, slug: str, history: dict[str, Any]) -> list[Path]:
    pages_dir = workspace / "pages"
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
        from openhands.sdk import Agent, Conversation, LLM, Tool
        from openhands.tools.file_editor import FileEditorTool
        from openhands.tools.task_tracker import TaskTrackerTool
        from openhands.tools.terminal import TerminalTool
    except Exception as exc:  # pragma: no cover - import error is surfaced cleanly
        raise RuntimeError(
            "OpenHands SDK is not installed. Run: "
            "pip install -U openhands-sdk openhands-tools && "
            "pip install -e './packages/browser-use[video]' "
            "(reinstall vendored browser-use after OpenHands)."
        ) from exc

    llm_kwargs: dict[str, Any] = {
        "model": llm_cfg["model"],
        "api_key": llm_cfg.get("api_key") or None,
    }
    if llm_cfg.get("base_url"):
        llm_kwargs["base_url"] = llm_cfg["base_url"]
    if llm_cfg.get("api_version"):
        llm_kwargs["api_version"] = llm_cfg["api_version"]

    yaml_iters = os.environ.get("WEBPILOT_OPENHANDS_MAX_ITERATIONS")
    max_iterations = int(yaml_iters or "40")
    llm = LLM(**llm_kwargs)
    agent = Agent(
        llm=llm,
        tools=[
            Tool(name=TerminalTool.name),
            Tool(name=FileEditorTool.name),
            Tool(name=TaskTrackerTool.name),
        ],
    )
    conversation = Conversation(
        agent=agent,
        workspace=str(workspace),
        max_iteration_per_run=max_iterations,
    )
    conversation.send_message(prompt)
    conversation.run()
    return {"model": llm_cfg["model"], "maxIterations": max_iterations, "workspace": str(workspace)}


def run_openhands_codegen(
    execution_history_path: str,
    slug: str,
    workspace: str | None = None,
    project_root: str | None = None,
    spec_path: str | None = None,
    test_file_path: str | None = None,
) -> dict[str, Any]:
    history_path = Path(execution_history_path).resolve()
    project = Path(project_root).resolve() if project_root else PROJECT_ROOT
    workspace_root = Path(workspace).resolve() if workspace else (project / "packages" / "test-framework")
    workspace_root.mkdir(parents=True, exist_ok=True)

    if spec_path:
        spec_candidate = Path(spec_path)
        spec_target = (
            spec_candidate.resolve()
            if spec_candidate.is_absolute()
            else (workspace_root / spec_path).resolve()
        )
    else:
        spec_target = (workspace_root / "tests" / f"{slug}.spec.ts").resolve()

    try:
        workspace_spec_rel = str(spec_target.relative_to(workspace_root)).replace("\\", "/")
    except ValueError as exc:
        raise ValueError(
            f"Spec path {spec_target} is outside OpenHands workspace {workspace_root}"
        ) from exc

    history = _read_json(history_path)
    prompt = build_codegen_prompt(
        slug=slug,
        spec_path=workspace_spec_rel,
        history=history,
        test_file_path=test_file_path,
        workspace_label=str(workspace_root),
    )

    if os.environ.get("WEBPILOT_OPENHANDS_MOCK") == "1":
        changed = _mock_write_files(workspace_root, spec_target, slug, history)
        files_changed = _collect_changed_files(changed, project)
        return {
            "success": True,
            "filesChanged": files_changed,
            "workspace": str(workspace_root),
            "summary": (
                f"Codegen (openhands mock) wrote {len(files_changed)} file(s) for {slug} "
                f"in workspace {workspace_root}."
            ),
        }

    pages_dir = workspace_root / "pages"
    before_mtimes: dict[Path, float] = {}
    if pages_dir.exists():
        for path in pages_dir.rglob("*.ts"):
            try:
                before_mtimes[path] = path.stat().st_mtime
            except OSError:
                continue
    before_spec_mtime = spec_target.stat().st_mtime if spec_target.exists() else None

    _run_openhands(prompt, workspace_root)

    changed_paths: list[Path] = []
    if spec_target.exists():
        try:
            after = spec_target.stat().st_mtime
            if before_spec_mtime is None or after > before_spec_mtime:
                changed_paths.append(spec_target)
        except OSError:
            pass
    if pages_dir.exists():
        for path in pages_dir.rglob("*.ts"):
            try:
                after = path.stat().st_mtime
            except OSError:
                continue
            before = before_mtimes.get(path)
            if before is None or after > before:
                changed_paths.append(path)

    slug_token = slug.replace("_", "").lower()
    preferred = [
        path
        for path in changed_paths
        if path == spec_target or slug_token in path.stem.replace("_", "").lower()
    ]
    files_changed = _collect_changed_files(preferred or changed_paths, project)
    return {
        "success": True,
        "filesChanged": files_changed,
        "workspace": str(workspace_root),
        "summary": (
            f"Codegen (openhands) wrote {len(files_changed)} file(s) for {slug} "
            f"in workspace {workspace_root}."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run OpenHands-backed WebPilot codegen")
    parser.add_argument("execution_history_path")
    parser.add_argument("slug")
    parser.add_argument("--workspace", default=None)
    parser.add_argument("--project-root", default=str(PROJECT_ROOT))
    parser.add_argument("--spec-path", default=None)
    parser.add_argument("--test-file-path", default=None)
    parser.add_argument("--validate", default="1")
    args = parser.parse_args(argv)

    try:
        result = run_openhands_codegen(
            execution_history_path=args.execution_history_path,
            slug=args.slug,
            workspace=args.workspace,
            project_root=args.project_root,
            spec_path=args.spec_path,
            test_file_path=args.test_file_path,
        )
    except Exception as exc:  # pragma: no cover - CLI guard
        result = {"success": False, "summary": str(exc), "error": str(exc), "filesChanged": []}

    print(json.dumps(result))
    return 0 if result.get("success") else 1
