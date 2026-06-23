from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ApiStep:
    method: str
    url: str
    name: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    body: Any = None
    extracted_variables: dict[str, str] = field(default_factory=dict)
    expected_status: int | None = None
    contains_text: str | None = None


@dataclass
class ApiScenario:
    name: str
    steps: list[ApiStep]
    tags: list[str] = field(default_factory=list)


def parse_web_spec(path: str | Path) -> tuple[str, list[str]]:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    name = Path(path).stem.replace("_", " ").title()
    bdd: list[str] = []
    numbered: list[str] = []
    plain: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith(("@", "#")):
            continue
        if line.lower().startswith("test:"):
            name = line.split(":", 1)[1].strip()
        elif re.match(r"^(given|when|then|and|but)\b", line, re.I):
            bdd.append(line)
        elif re.match(r"^\d+\.\s+", line):
            numbered.append(re.sub(r"^\d+\.\s+", "", line))
        else:
            plain.append(line)
    return name, bdd or numbered or plain


def parse_api_spec(path: str | Path) -> ApiScenario:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    name = "API Test"
    tags: list[str] = []
    steps: list[ApiStep] = []
    current: ApiStep | None = None

    def flush() -> None:
        nonlocal current
        if current:
            current.name = current.name or f"{current.method} {current.url}"
            steps.append(current)
        current = None

    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if line.lower().startswith("test:"):
            name = line.split(":", 1)[1].strip()
            continue
        if line.startswith("@"):
            tags.extend(part for part in line.split() if part != "@api")
            continue
        match = re.match(r"^Send\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s+request\s+to\s+(.+)$", line, re.I)
        if match:
            flush()
            current = ApiStep(method=match.group(1).upper(), url=match.group(2).strip())
            continue
        if not current:
            continue
        match = re.match(r"^With\s+body\s+(?:payload\s+)?(.+)$", line, re.I)
        if match:
            import json

            try:
                current.body = json.loads(match.group(1))
            except json.JSONDecodeError:
                current.body = match.group(1)
            continue
        match = re.match(r"^With\s+Headers?\s+(.+)$", line, re.I)
        if match:
            import json

            try:
                current.headers = json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
            continue
        match = re.match(r"^Extract\s+response\s+(?:body\.)?([\w.]+)\s+into\s+(\w+)$", line, re.I)
        if match:
            current.extracted_variables[match.group(1)] = match.group(2)
            continue
        match = re.match(r"^Assert\s+status\s+is\s+(\d+)", line, re.I)
        if match:
            current.expected_status = int(match.group(1))
            flush()
            continue
        match = re.match(r"^Assert\s+(?:response\s+)?contains\s+[\"']?(.+?)[\"']?$", line, re.I)
        if match:
            current.contains_text = match.group(1)
    flush()
    return ApiScenario(name=name, steps=steps, tags=tags)
