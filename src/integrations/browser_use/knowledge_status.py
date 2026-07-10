"""Inspect learned capabilities for a scenario file."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from .capability_contract import infer_intent, is_replay_allowed, migrate_legacy_capability
from .intent_resolver import resolve_step_intent
from .knowledge import (
    KnowledgeRepository,
    PAGES_DIR,
    SCENARIOS_DIR,
    _capability_stale,
    load_knowledge_config,
    step_signature,
)


def _slugify(value: str) -> str:
    key = re.sub(r"[^a-z0-9._-]+", "_", (value or "").strip().lower())
    return key.strip("_")[:120] or "unknown"


def parse_txt_steps(path: str) -> list[str]:
    steps: list[str] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            match = re.match(r"^\d+\.\s+(.*)$", stripped)
            steps.append(match.group(1).strip() if match else stripped)
    return steps


def _status_label(capability: dict[str, Any] | None) -> str:
    if capability is None:
        return "missing"
    capability = migrate_legacy_capability(capability)
    if _capability_stale(capability):
        return "stale"
    status = capability.get("status") or "candidate"
    if status == "quarantined":
        return "quarantined"
    if not is_replay_allowed(capability):
        return "unsafe-no-replay"
    return status


def inspect_test_knowledge(test_file: str) -> dict[str, Any]:
    steps = parse_txt_steps(test_file)
    slug = _slugify(Path(test_file).stem)
    repo = KnowledgeRepository(load_knowledge_config(), slug)
    rows: list[dict[str, Any]] = []
    blocking: list[int] = []
    trusted = 0
    for index, step in enumerate(steps, start=1):
        capability = repo.find_capability(step, "https://placeholder.invalid/")
        # Placeholder URL is too weak — scan all stores for signature match.
        capability = _find_by_signature(repo, step) or capability
        label = _status_label(capability)
        if label in ("missing", "quarantined", "stale"):
            blocking.append(index)
        if label == "trusted":
            trusted += 1
        quality = (capability or {}).get("quality") or {}
        resolved = resolve_step_intent(step)
        cap = migrate_legacy_capability(capability) if capability else {}
        rows.append({
            "step": index,
            "text": step,
            "intent": infer_intent(step),
            "action": resolved.get("action"),
            "pageType": cap.get("pageType") or resolved.get("pageTypeHint") or "",
            "status": label,
            "successCount": int((capability or {}).get("successCount", 0)),
            "failureCount": int((capability or {}).get("failureCount", 0)),
            "confidence": quality.get("confidence"),
            "freshContextSuccesses": quality.get("freshContextSuccesses"),
            "failureClass": quality.get("failureClass"),
            "safeToReplay": is_replay_allowed(capability) if capability else None,
            "lastValidatedAt": cap.get("lastValidatedAt"),
        })
    total = len(steps)
    coverage = round((total - len(blocking)) / total * 100, 1) if total else 0.0
    return {
        "testFile": test_file,
        "testSlug": slug,
        "totalSteps": total,
        "trustedSteps": trusted,
        "blockingSteps": blocking,
        "knowledgeCoverage": f"{coverage}%",
        "fullReplayEligible": len(blocking) == 0 and total > 0,
        "steps": rows,
    }


def _find_by_signature(repo: KnowledgeRepository, step: str) -> dict[str, Any] | None:
    signature = step_signature(step)
    best: dict[str, Any] | None = None
    paths: list[Path] = []
    if repo.storage == "partitioned":
        if repo.scope == "test":
            paths.append(repo._scenario_path())
        elif PAGES_DIR.exists():
            paths.extend(sorted(PAGES_DIR.glob("*.json")))
    for path in paths:
        store_kind = "scenario" if "scenarios" in str(path) else "page"
        data = repo._load_partitioned_store(path, store_kind)
        for item in data.get("capabilities") or []:
            if item.get("stepSignature") == signature and item.get("status") != "quarantined":
                if not best or item.get("successCount", 0) > best.get("successCount", 0):
                    best = item
    return best


def format_report(payload: dict[str, Any]) -> str:
    lines = [
        f"Test: {payload['testFile']}",
        f"Steps: {payload['totalSteps']} | Trusted: {payload['trustedSteps']} | "
        f"Coverage: {payload['knowledgeCoverage']} | "
        f"Full replay eligible: {payload['fullReplayEligible']}",
    ]
    if payload["blockingSteps"]:
        lines.append(f"Blocking steps: {', '.join(str(n) for n in payload['blockingSteps'])}")
    lines.append("")
    for row in payload["steps"]:
        conf = row.get("confidence")
        conf_text = f" conf={conf}" if conf is not None else ""
        safe = "" if row.get("safeToReplay") is not False else " [unsafe]"
        lines.append(
            f"  {row['step']:>2}. [{row['status']:<16}] intent={row['intent']:<14} "
            f"action={str(row.get('action') or ''):<18} page={str(row.get('pageType') or ''):<16}"
            f" ok={row['successCount']} fail={row['failureCount']}{conf_text}{safe}  {row['text'][:60]}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) < 2 or args[0] != "status":
        print("Usage: python -m integrations.browser_use.knowledge_status status <test.txt> [--json]")
        return 1
    test_file = args[1]
    payload = inspect_test_knowledge(test_file)
    if "--json" in args:
        print(json.dumps(payload, indent=2))
    else:
        print(format_report(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
