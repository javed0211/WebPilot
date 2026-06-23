from __future__ import annotations

import os
import subprocess
from pathlib import Path

from webpilot.api import run_api
from webpilot.codegen import run_generated_test, validate_python, write_generated_files
from webpilot.config import ROOT, get_setting, python_executable
from webpilot.reports import generate_reports


def is_api_test(path: Path) -> bool:
    return "api" in path.parts or path.suffix.lower() in {".yaml", ".yml", ".json"}


def run_ui(path: Path, env_name: str, headed: bool = False) -> bool:
    slug = path.stem
    existing = ROOT / "framework" / "tests" / f"test_{slug}.py"
    if existing.exists():
        print(f"  ○ Running existing Python test: {existing.relative_to(ROOT)}")
        passed, output = run_generated_test(slug)
        print(output)
        if passed:
            return True
        print("  ! Existing test failed; falling back to browser-use healing")

    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [str(ROOT), str(ROOT / "core"), env.get("PYTHONPATH", "")]
    )
    if headed:
        env["WEBPILOT_HEADED"] = "1"
    result = subprocess.run(
        [
            python_executable(),
            str(ROOT / "core" / "browser_use_runner.py"),
            str(path),
            env_name,
        ],
        cwd=ROOT,
        env=env,
    )
    if result.returncode != 0:
        return False
    payload = ROOT / "framework" / "temp_codegen.json"
    if not payload.exists():
        print("  ✗ browser-use completed but no generated-code payload was produced")
        return False
    written = write_generated_files(payload, slug)
    valid, errors = validate_python(written)
    if not valid:
        print(errors)
        return False
    passed, output = run_generated_test(slug)
    print(output)
    return passed


def run_paths(paths: list[str], env_name: str, headed: bool = False, report: bool = False) -> bool:
    files: list[Path] = []
    for value in paths:
        path = Path(value)
        if path.is_dir():
            files.extend(
                candidate
                for candidate in path.rglob("*")
                if candidate.suffix.lower() in {".txt", ".yaml", ".yml", ".json"}
            )
        elif path.exists():
            files.append(path)
    if not files:
        raise FileNotFoundError("No test scripts found")
    passed = 0
    for path in files:
        print(f"\nWebPilot · {path}")
        success = run_api(path, env_name) if is_api_test(path) else run_ui(path, env_name, headed)
        print(f"  {'✓ PASSED' if success else '✗ FAILED'}")
        passed += int(success)
    if report or get_setting("framework.htmlReport", True):
        print(f"  Report: {generate_reports()}")
    print(f"\nSuite: {passed} passed, {len(files) - passed} failed")
    return passed == len(files)
