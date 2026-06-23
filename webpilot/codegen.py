from __future__ import annotations

import ast
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from webpilot.config import ROOT, python_executable


def snake_case(value: str) -> str:
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    return re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()


def normalize_generated_file(item: dict[str, str], test_slug: str) -> dict[str, str]:
    path = item["path"].replace("\\", "/")
    content = item["content"]
    content = content.replace(
        "from framework.pages.base_page import BasePage",
        "from framework.core.base_page import BasePage",
    )
    content = re.sub(r"self\.([A-Z][A-Z0-9_]*)\(self\)", r"self.\1()", content)
    if path.startswith("framework/tests/") and path.endswith(".py"):
        path = f"framework/tests/test_{test_slug}.py"
    return {"path": path, "content": content}


def _class_members(source: str) -> tuple[str | None, dict[str, str], dict[str, str]]:
    tree = ast.parse(source)
    lines = source.splitlines()
    class_node = next((node for node in tree.body if isinstance(node, ast.ClassDef)), None)
    if not class_node:
        return None, {}, {}
    assignments: dict[str, str] = {}
    methods: dict[str, str] = {}
    for node in class_node.body:
        names: list[str] = []
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names = [target.id for target in targets if isinstance(target, ast.Name)]
            for name in names:
                if name.isupper():
                    assignments[name] = "\n".join(lines[node.lineno - 1 : node.end_lineno])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            methods[node.name] = "\n".join(lines[node.lineno - 1 : node.end_lineno])
    return class_node.name, assignments, methods


def merge_page_object(existing: str, generated: str) -> str:
    existing_class, existing_assignments, existing_methods = _class_members(existing)
    generated_class, generated_assignments, generated_methods = _class_members(generated)
    if not existing_class or existing_class != generated_class:
        return generated
    additions = [
        *(
            block
            for name, block in generated_assignments.items()
            if name not in existing_assignments
        ),
        *(
            block
            for name, block in generated_methods.items()
            if name not in existing_methods
        ),
    ]
    if not additions:
        return existing
    return existing.rstrip() + "\n\n" + "\n\n".join(additions) + "\n"


def write_generated_files(payload_path: Path, test_slug: str) -> list[Path]:
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    files = [normalize_generated_file(item, test_slug) for item in payload.get("files", [])]
    written: list[Path] = []
    for item in files:
        destination = ROOT / item["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        content = item["content"].rstrip() + "\n"
        if destination.exists() and "framework/pages/" in item["path"]:
            content = merge_page_object(
                destination.read_text(encoding="utf-8"),
                content,
            )
        destination.write_text(content, encoding="utf-8")
        written.append(destination)
    payload_path.unlink(missing_ok=True)
    return written


def validate_python(paths: list[Path]) -> tuple[bool, str]:
    errors: list[str] = []
    for path in paths:
        try:
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as error:
            errors.append(f"{path}:{error.lineno}: {error.msg}")
    return not errors, "\n".join(errors)


def run_generated_test(test_slug: str, timeout: int = 180) -> tuple[bool, str]:
    test_path = ROOT / "framework" / "tests" / f"test_{test_slug}.py"
    if not test_path.exists():
        return False, f"Generated test was not found: {test_path}"
    result = subprocess.run(
        [python_executable(), "-m", "pytest", str(test_path), "-q"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return result.returncode == 0, (result.stdout + result.stderr).strip()


def render_api_files(scenario: Any, test_slug: str) -> list[Path]:
    class_name = "".join(part.title() for part in test_slug.split("_")) + "Api"
    module = f"{test_slug}_api"
    methods: list[str] = []
    calls: list[str] = []
    for index, step in enumerate(scenario.steps):
        generated_url = (
            step.url.replace("{{apiBaseUrl}}", "").replace("{{baseUrl}}", "")
        )
        if not generated_url.startswith(("http://", "https://", "/")):
            generated_url = f"/{generated_url}"
        method_name = f"{step.method.lower()}_{snake_case(generated_url)}_{index}"
        method_name = re.sub(r"_+", "_", method_name).strip("_")
        body_arg = ", body: object" if step.body is not None else ""
        request_body = ", body" if step.body is not None else ""
        headers_arg = ", headers=headers" if step.headers else ""
        status = (
            f"\n        self.client.assert_status(response, {step.expected_status})"
            if step.expected_status is not None
            else ""
        )
        methods.append(
            f"""    def {method_name}(self{body_arg}, headers: dict[str, str] | None = None) -> APIResponse:
        response = self.client.{step.method.lower()}({generated_url!r}{request_body}, headers=headers){status}
        return response"""
        )
        body = f", {step.body!r}" if step.body is not None else ""
        headers = ""
        if step.headers:
            headers = f", headers=interpolate({step.headers!r}, variables)"
        calls.append(
            f"    response = api.{method_name}({body.lstrip(', ')}{headers})"
            if body
            else f"    response = api.{method_name}({headers.lstrip(', ')})"
        )
        if step.extracted_variables:
            calls.append("    payload = response.json()")
            for json_path, variable in step.extracted_variables.items():
                calls.append(f"    variables[{variable!r}] = nested(payload, {json_path!r})")

    client_content = f"""from playwright.sync_api import APIResponse

from framework.core.base_api import BaseAPI


class {class_name}:
    def __init__(self, client: BaseAPI) -> None:
        self.client = client

{chr(10).join(methods)}
"""
    test_content = f"""import re

import pytest

from framework.apis.{module} import {class_name}
from framework.core.base_api import BaseAPI


def nested(value, path):
    for part in path.split("."):
        value = value.get(part) if isinstance(value, dict) else None
    return value


def interpolate(value, variables):
    if isinstance(value, str):
        return re.sub(r"{{{{(\\w+)}}}}", lambda m: str(variables.get(m.group(1), m.group(0))), value)
    if isinstance(value, dict):
        return {{key: interpolate(item, variables) for key, item in value.items()}}
    return value


@pytest.mark.api
def test_{test_slug}(api_client: BaseAPI) -> None:
    api = {class_name}(api_client)
    variables = {{}}
{chr(10).join(calls)}
"""
    outputs = [
        ROOT / "framework" / "apis" / f"{module}.py",
        ROOT / "framework" / "tests" / "api" / f"test_{test_slug}.py",
    ]
    outputs[0].parent.mkdir(parents=True, exist_ok=True)
    outputs[1].parent.mkdir(parents=True, exist_ok=True)
    outputs[0].write_text(client_content, encoding="utf-8")
    outputs[1].write_text(test_content, encoding="utf-8")
    return outputs
