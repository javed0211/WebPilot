from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from pathlib import Path

from webpilot.config import ROOT


def _summaries() -> list[dict]:
    reports = ROOT / "reports"
    values = []
    for path in reports.glob("*_summary.json"):
        try:
            values.append(json.loads(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    return sorted(values, key=lambda item: item.get("timestamp", ""), reverse=True)


def generate_reports(test_slug: str | None = None) -> Path:
    reports = ROOT / "reports"
    reports.mkdir(exist_ok=True)
    summaries = _summaries()
    if test_slug:
        summaries = [item for item in summaries if item.get("test") == test_slug]
    rows = "\n".join(
        f"<tr><td>{html.escape(str(item.get('testName') or item.get('test')))}</td>"
        f"<td>{html.escape(str(item.get('status', 'UNKNOWN')))}</td>"
        f"<td>{item.get('stepsExecuted', 0)}</td>"
        f"<td>{item.get('tokens', 0)}</td>"
        f"<td>${float(item.get('estimatedCostUsd', 0)):.4f}</td></tr>"
        for item in summaries
    )
    document = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>WebPilot Report</title>
<style>body{{font-family:system-ui;margin:40px;background:#0b1020;color:#e5e7eb}}
table{{border-collapse:collapse;width:100%;background:#111827}}th,td{{padding:12px;border:1px solid #374151;text-align:left}}
th{{background:#1f2937}}.pass{{color:#34d399}}</style></head>
<body><h1>WebPilot Execution Report</h1><p>Generated {datetime.now(timezone.utc).isoformat()}</p>
<table><thead><tr><th>Test</th><th>Status</th><th>Steps</th><th>Tokens</th><th>Cost</th></tr></thead>
<tbody>{rows}</tbody></table></body></html>"""
    destination = reports / "index.html"
    destination.write_text(document, encoding="utf-8")
    return destination


def generate_markdown() -> Path:
    summaries = _summaries()
    lines = [
        "# WebPilot Execution Analysis Report",
        "",
        "| Test | Status | Steps | Tokens | Cost |",
        "|---|---:|---:|---:|---:|",
    ]
    for item in summaries:
        lines.append(
            f"| {item.get('testName') or item.get('test')} | {item.get('status', 'UNKNOWN')} | "
            f"{item.get('stepsExecuted', 0)} | {item.get('tokens', 0)} | "
            f"${float(item.get('estimatedCostUsd', 0)):.4f} |"
        )
    destination = ROOT / "reports" / "execution_analysis_report.md"
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return destination
