from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from framework.config.config_manager import ROOT, config


class DataLoader:
    @staticmethod
    def load_json(filename: str) -> Any:
        environment = config["environment"]
        candidates = [
            ROOT / "data" / filename,
            ROOT / "framework" / "data" / filename,
            ROOT / "data" / environment / filename,
            ROOT / "framework" / "data" / environment / filename,
        ]
        for path in candidates:
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
        raise FileNotFoundError(f'Data file "{filename}" was not found')

    @staticmethod
    def load_csv(filename: str) -> list[dict[str, str]]:
        for path in (ROOT / "data" / filename, ROOT / "framework" / "data" / filename):
            if path.exists():
                with path.open(newline="", encoding="utf-8") as handle:
                    return list(csv.DictReader(handle))
        raise FileNotFoundError(f'CSV file "{filename}" was not found')
