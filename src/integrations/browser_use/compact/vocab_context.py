"""Thread SiteVocab through compact build without plumbing every helper."""
from __future__ import annotations

import os
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

from ..rulebooks import SiteVocab, load_site_vocab

_current_vocab: ContextVar[SiteVocab | None] = ContextVar("webpilot_compact_vocab", default=None)


def heuristics_enabled() -> bool:
    """Legacy site-regex fallback. Default OFF — vocab is the primary path."""
    return os.environ.get("WEBPILOT_COMPACT_HEURISTICS", "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def llm_align_enabled() -> bool:
    return os.environ.get("WEBPILOT_COMPACT_LLM_ALIGN", "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def current_vocab() -> SiteVocab:
    vocab = _current_vocab.get()
    if vocab is not None:
        return vocab
    return load_site_vocab()


@contextmanager
def use_vocab(
    *,
    url: str | None = None,
    site_pack: str | None = None,
    vocab: SiteVocab | None = None,
) -> Iterator[SiteVocab]:
    resolved = vocab or load_site_vocab(url=url, site_pack=site_pack)
    token = _current_vocab.set(resolved)
    try:
        yield resolved
    finally:
        _current_vocab.reset(token)
