from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Iterator


class Logger:
    @staticmethod
    def _write(level: str, message: str) -> None:
        print(f"[{level}] {datetime.now().strftime('%H:%M:%S')} {message}")

    info = staticmethod(lambda message: Logger._write("INFO", message))
    success = staticmethod(lambda message: Logger._write("PASS", message))
    warn = staticmethod(lambda message: Logger._write("WARN", message))
    error = staticmethod(lambda message: Logger._write("FAIL", message))

    @staticmethod
    @contextmanager
    def step(name: str) -> Iterator[None]:
        Logger._write("STEP", name)
        yield
