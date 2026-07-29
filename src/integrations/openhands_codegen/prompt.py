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

    return f"""You are editing a local WebPilot repository to generate Playwright test code.

Goal:
- Generate TypeScript Playwright code from WebPilot execution evidence only.
- Keep discovery logic out of scope. Use only the compact workflow and execution history as truth.

Repository conventions:
- Use `@playwright/test`.
- Reuse `packages/test-framework/core/BasePage.ts`.
- Follow existing Playwright fixture/config patterns under `packages/test-framework/`.
- Write the spec to `{spec_path}`.
- Create page object files under `packages/test-framework/pages/` when needed.

Hard requirements:
- Do not invent steps, assertions, or navigation that do not exist in the evidence.
- Prefer verified role/label/text locators from `compactSteps`.
- Optional compact steps must be implemented defensively so the test does not fail when the element is absent.
- Keep the generated flow replayable by `webpilot replay`.
- Generate one main page object class named `{page_class}` unless the evidence clearly requires more than one.
- Match the site context `{site_hint}` when naming helpers/selectors, but do not add branding copy that is not already present in the evidence.
- Do not edit unrelated files.

Deliverables:
1. Create or update the necessary page object file(s) in `packages/test-framework/pages/`.
2. Create or update the spec at `{spec_path}`.
3. Ensure imports resolve inside this repo.

Execution evidence JSON:
```json
{json.dumps(evidence, indent=2)}
```
"""
