from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse


def _slug_to_class_name(slug: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", slug)
    return "".join(word[:1].upper() + word[1:] for word in words) or "Generated"


def _site_hint(urls: list[str]) -> str:
    for raw in urls:
        if not raw:
            continue
        host = urlparse(raw).netloc.lower()
        if host:
            return host.replace("www.", "")
    return "site"


def build_codegen_prompt(
    *,
    slug: str,
    spec_path: str,
    history: dict[str, Any],
    test_file_path: str | None = None,
    workspace_label: str = "codegen workspace",
) -> str:
    nl_steps = history.get("nlSteps") or []
    compact = history.get("compactWorkflow") or {}
    compact_steps = compact.get("steps") or []
    urls = history.get("urlSequence") or [step.get("url") for step in compact_steps if step.get("url")]
    page_class = f"{_slug_to_class_name(slug)}Page"
    site_hint = _site_hint(urls)

    evidence = {
        "slug": slug,
        "testFilePath": test_file_path,
        "testName": history.get("testName") or slug,
        "urls": urls,
        "nlSteps": nl_steps,
        "compactCoverage": compact.get("coverage") or {},
        "compactSteps": compact_steps,
    }

    return f"""You are editing a scoped automation workspace to generate Playwright test code.

Workspace root (ONLY folder you may edit): {workspace_label}

Goal:
- Generate TypeScript Playwright code from WebPilot discovery evidence only.
- Discovery already happened outside this workspace. Do not rediscover the site.
- Use only the compact workflow / NL evidence below as truth.

Workspace conventions:
- Use `@playwright/test`.
- Reuse `core/BasePage.ts` (or existing BasePage in this workspace).
- Follow fixtures/config already present in this workspace.
- Write the spec to `{spec_path}` (path relative to this workspace).
- Create/update page objects under `pages/` when needed.

Hard requirements:
- Stay inside this workspace. Do not edit parent WebPilot engine/src, docs, or unrelated packages.
- Do not invent steps, assertions, or navigation beyond the evidence.
- Prefer verified role/label/text locators from `compactSteps`. When a verified CSS candidate exists (e.g. autocomplete result id), prefer it over fragile exact option names scoped to `main`.
- Optional compact steps must be implemented defensively.
- Prefer relative/dynamic dates over hard-coded calendar day labels when the NL says "at least N days from today".
- Generate one main page object class named `{page_class}` unless evidence clearly requires more.
- Match site context `{site_hint}` for naming helpers only.
- Do not edit unrelated existing specs/pages.

Deliverables:
1. Create or update page object file(s) under `pages/`.
2. Create or update the spec at `{spec_path}`.
3. Ensure imports resolve inside this workspace.

Execution evidence JSON:
```json
{json.dumps(evidence, indent=2)}
```
"""
