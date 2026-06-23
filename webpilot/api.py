from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import APIRequestContext, APIResponse, sync_playwright

from webpilot.codegen import render_api_files
from webpilot.config import ROOT, environment
from webpilot.specs import ApiScenario, ApiStep, parse_api_spec


def interpolate(value: Any, variables: dict[str, Any]) -> Any:
    if isinstance(value, str):
        return re.sub(r"\{\{(\w+)\}\}", lambda match: str(variables.get(match.group(1), match.group(0))), value)
    if isinstance(value, list):
        return [interpolate(item, variables) for item in value]
    if isinstance(value, dict):
        return {key: interpolate(item, variables) for key, item in value.items()}
    return value


def nested(payload: Any, path: str) -> Any:
    current = payload
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def execute_step(context: APIRequestContext, step: ApiStep, variables: dict[str, Any]) -> APIResponse:
    url = interpolate(step.url, variables)
    headers = interpolate(step.headers, variables) if step.headers else None
    body = interpolate(step.body, variables)
    method = step.method.lower()
    kwargs: dict[str, Any] = {}
    if headers:
        kwargs["headers"] = headers
    if body is not None and method in {"post", "put", "patch"}:
        kwargs["data"] = body
    response = getattr(context, method)(url, **kwargs)
    if step.expected_status is not None and response.status != step.expected_status:
        raise AssertionError(f"Expected status {step.expected_status}, received {response.status}")
    if step.contains_text and step.contains_text not in response.text():
        raise AssertionError(f"Response does not contain {step.contains_text!r}")
    if step.extracted_variables:
        payload = response.json()
        for path, variable in step.extracted_variables.items():
            variables[variable] = nested(payload, path)
    return response


def run_api(path: str | Path, env_name: str, codegen: bool = True) -> bool:
    scenario: ApiScenario = parse_api_spec(path)
    if not scenario.steps:
        raise ValueError(f"No API steps parsed from {path}")
    env = environment(env_name)
    variables: dict[str, Any] = {
        "baseUrl": env.get("baseUrl"),
        "apiBaseUrl": env.get("apiBaseUrl"),
        **env.get("variables", {}),
        **env.get("credentials", {}),
    }
    records: list[dict[str, Any]] = []
    success = True
    with sync_playwright() as playwright:
        context = playwright.request.new_context(
            base_url=env.get("apiBaseUrl") or env.get("baseUrl"),
            extra_http_headers={"Accept": "application/json", "Content-Type": "application/json"},
            ignore_https_errors=True,
        )
        try:
            for index, step in enumerate(scenario.steps, 1):
                started = time.monotonic()
                print(f"  Step {index}/{len(scenario.steps)} — {step.method} {interpolate(step.url, variables)}")
                try:
                    response = execute_step(context, step, variables)
                    records.append(
                        {
                            "step": index,
                            "name": step.name,
                            "status": response.status,
                            "durationMs": round((time.monotonic() - started) * 1000),
                            "success": True,
                        }
                    )
                    print(f"  ✓ Response {response.status}")
                except Exception as error:
                    records.append({"step": index, "name": step.name, "success": False, "error": str(error)})
                    print(f"  ✗ {error}")
                    success = False
                    break
        finally:
            context.dispose()
    reports = ROOT / "reports"
    reports.mkdir(exist_ok=True)
    slug = Path(path).stem
    (reports / f"api-{slug}-{int(time.time() * 1000)}.json").write_text(
        json.dumps({"scenario": scenario.name, "success": success, "steps": records}, indent=2),
        encoding="utf-8",
    )
    if success and codegen:
        render_api_files(scenario, slug)
    return success
