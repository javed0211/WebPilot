from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

from webpilot import __version__
from webpilot.config import ROOT, environment, get_setting, python_executable
from webpilot.reports import generate_markdown, generate_reports
from webpilot.runner import run_paths


def doctor() -> int:
    print("WebPilot Doctor")
    ok = True
    for directory in ("config", "tests", "core", "framework", "webpilot"):
        exists = (ROOT / directory).exists()
        print(f"  {'✓' if exists else '✗'} {directory}")
        ok &= exists
    try:
        subprocess.run(
            [python_executable(), "-c", "import browser_use, playwright, pytest"],
            check=True,
            capture_output=True,
        )
        print(f"  ✓ Python runtime: {python_executable()}")
    except subprocess.CalledProcessError:
        print("  ✗ Python dependencies; run: pip install -e .")
        ok = False
    try:
        sys.path.insert(0, str(ROOT / "core"))
        from llm_config import resolve_provider_config, validate_provider_config

        provider, config = resolve_provider_config()
        validate_provider_config(provider, config)
        print(f"  ✓ LLM provider: {provider}")
    except Exception as error:
        print(f"  ✗ LLM provider: {error}")
        ok = False
    return 0 if ok else 1


def create_asset(kind: str, name: str) -> int:
    slug = name.replace(" ", "_").lower()
    if kind == "test":
        destination = ROOT / "tests" / "web" / f"{slug}.txt"
        content = f"""@smoke
Test: {name}

1. Navigate to https://example.com/
2. Verify the page is displayed
"""
    elif kind == "api":
        destination = ROOT / "tests" / "api" / f"{slug}.txt"
        content = """@api
Test: API User validation

Send POST request to {{apiBaseUrl}}/auth/login
With body payload {"username": "emilys", "password": "emilyspass"}
Extract response body.accessToken into token
Send GET request to {{apiBaseUrl}}/auth/me
With Headers {"Authorization": "Bearer {{token}}"}
Assert status is 200
"""
    else:
        raise ValueError('Type must be "test" or "api"')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")
    print(f"Created: {destination}")
    return 0


def self_heal(clean: bool) -> int:
    cache = ROOT / "healing-cache" / "cache.json"
    if clean:
        cache.unlink(missing_ok=True)
        print("Healing cache cleared")
    elif cache.exists():
        print(cache.read_text(encoding="utf-8"))
    else:
        print("Healing cache is empty")
    return 0


def init_project() -> int:
    for directory in (
        "config/environments",
        "tests/web",
        "tests/api",
        "framework/pages",
        "framework/tests",
        "framework/apis",
        "reports",
        "artifacts",
        "healing-cache",
    ):
        (ROOT / directory).mkdir(parents=True, exist_ok=True)
    print("WebPilot Python project initialized")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="webpilot")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor")
    commands.add_parser("init")
    create = commands.add_parser("create")
    create.add_argument("type", choices=["test", "api"])
    create.add_argument("name")
    run = commands.add_parser("run")
    run.add_argument("paths", nargs="+")
    run.add_argument("--env", "-e", default="qa")
    run.add_argument("--headed", action="store_true")
    run.add_argument("--report", action="store_true")
    interactive = commands.add_parser("interactive")
    interactive.add_argument("path")
    interactive.add_argument("--env", "-e", default="qa")
    report = commands.add_parser("report")
    report.add_argument("--test")
    report.add_argument("--env", default="qa")
    commands.add_parser("analyze")
    heal = commands.add_parser("self-heal")
    heal.add_argument("--clean", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "doctor":
        return doctor()
    if args.command == "init":
        return init_project()
    if args.command == "create":
        return create_asset(args.type, args.name)
    if args.command == "run":
        return 0 if run_paths(args.paths, args.env, args.headed, args.report) else 1
    if args.command == "interactive":
        return 0 if run_paths([args.path], args.env, headed=True) else 1
    if args.command == "report":
        print(generate_reports(args.test))
        return 0
    if args.command == "analyze":
        print(generate_markdown())
        return 0
    if args.command == "self-heal":
        return self_heal(args.clean)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
