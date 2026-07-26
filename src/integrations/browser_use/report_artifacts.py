"""Report media helpers: screenshots + video/trace finalization."""

from __future__ import annotations

import glob
import json
import os
import shutil
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

from .paths import REPORTS_SCREENSHOTS_DIR, REPORTS_TRACES_DIR, REPORTS_VIDEOS_DIR


def latest_files(search_roots: Sequence[Optional[str]], patterns: Iterable[str]) -> List[str]:
    """Collect files matching patterns under each root (newest mtime wins)."""
    found: List[str] = []
    for root in search_roots:
        if not root or not os.path.isdir(root):
            continue
        for pattern in patterns:
            found.extend(glob.glob(os.path.join(root, "**", pattern), recursive=True))
    found.sort(key=os.path.getmtime)
    return found


def history_item_failed(item: dict) -> bool:
    """True when a browser-use history item recorded an action error."""
    results = item.get("result") or []
    if not isinstance(results, list):
        results = [results]
    for result in results:
        if isinstance(result, dict) and result.get("error"):
            return True
    return False


def is_usable_video(path: str, min_bytes: int = 2_000) -> bool:
    """Reject empty/stub recordings scavenged from /tmp or aborted writers."""
    try:
        return os.path.isfile(path) and os.path.getsize(path) >= min_bytes
    except OSError:
        return False


def persist_screenshots(
    test_slug: str,
    history_path: Optional[str],
    mode: str = "only-on-failure",
    screenshots_dir: Optional[Path] = None,
) -> List[str]:
    """Copy browser-use step screenshots into reports/ before temp dirs are removed.

    Respects browser.screenshots: off | on | only-on-failure.
    """
    mode = str(mode or "only-on-failure").strip().lower()
    base = Path(screenshots_dir) if screenshots_dir is not None else REPORTS_SCREENSHOTS_DIR
    dest_dir = str(base / test_slug)

    if mode in ("off", "false", "0", "no"):
        if os.path.isdir(dest_dir):
            shutil.rmtree(dest_dir, ignore_errors=True)
        return []

    if not history_path or not os.path.isfile(history_path):
        return []
    try:
        with open(history_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []

    run_ok = bool(
        data.get("isSuccessful")
        if data.get("isSuccessful") is not None
        else (data.get("runLog") or {}).get("isSuccessful")
    )
    if mode == "only-on-failure" and run_ok:
        if os.path.isdir(dest_dir):
            shutil.rmtree(dest_dir, ignore_errors=True)
        return []

    os.makedirs(dest_dir, exist_ok=True)
    saved: List[str] = []
    seen = set()
    fallback_last = None

    dump = data.get("fullHistoryDump") or {}
    for item in dump.get("history") or []:
        if not isinstance(item, dict):
            continue
        state = item.get("state") or {}
        if not isinstance(state, dict):
            continue
        sp = state.get("screenshot_path")
        if not sp or not os.path.isfile(sp) or sp in seen:
            continue
        seen.add(sp)
        fallback_last = sp
        if mode == "only-on-failure" and not history_item_failed(item):
            continue
        dest = os.path.join(dest_dir, os.path.basename(sp))
        try:
            shutil.copy2(sp, dest)
            saved.append(dest.replace("\\", "/"))
        except Exception as e:
            print(f"Warning: could not copy screenshot {sp}: {e}")

    # Failed runs sometimes lack per-step error flags — keep the last frame as evidence.
    if mode == "only-on-failure" and not saved and not run_ok and fallback_last:
        dest = os.path.join(dest_dir, os.path.basename(fallback_last))
        try:
            shutil.copy2(fallback_last, dest)
            saved.append(dest.replace("\\", "/"))
        except Exception as e:
            print(f"Warning: could not copy failure screenshot {fallback_last}: {e}")

    if saved:
        print(f"Saved {len(saved)} screenshot(s) under {dest_dir} (mode={mode})")
    return saved


def finalize_artifacts(
    test_slug: str,
    video_dir: Optional[str],
    traces_dir: Optional[str],
    videos_out: Optional[Path] = None,
    traces_out: Optional[Path] = None,
) -> dict:
    """Copy session recordings into reports/ with stable names.

    Only attaches video when recording was enabled for this run (video_dir set)
    and the file is large enough to be a real recording — never scavenge /tmp.
    """
    artifacts: dict = {}
    videos_root = Path(videos_out) if videos_out is not None else REPORTS_VIDEOS_DIR
    traces_root = Path(traces_out) if traces_out is not None else REPORTS_TRACES_DIR

    if video_dir:
        videos = [
            path
            for path in latest_files([os.path.abspath(video_dir)], ("*.webm", "*.mp4"))
            if is_usable_video(path)
        ]
        if videos:
            src = videos[-1]
            ext = os.path.splitext(src)[1] or ".webm"
            dest = str(videos_root / f"{test_slug}{ext}")
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.abspath(src) != os.path.abspath(dest):
                shutil.copy2(src, dest)
            if is_usable_video(dest):
                artifacts["video"] = dest
                # A previous run may have left {slug} under the other extension; leaving it
                # behind makes report tooling pick evidence from a run that never happened.
                for stale_ext in (".webm", ".mp4"):
                    stale = videos_root / f"{test_slug}{stale_ext}"
                    if stale_ext != ext and stale.exists():
                        try:
                            stale.unlink()
                        except OSError:
                            pass
                print(f"Saved execution video: {dest}")
            else:
                print(f"Warning: skipped unusable video artifact ({dest})")

    if traces_dir:
        traces = latest_files([os.path.abspath(traces_dir)], ("*.zip",))
        if traces:
            src = traces[-1]
            try:
                usable = os.path.getsize(src) >= 1_000
            except OSError:
                usable = False
            if usable:
                dest = str(traces_root / f"{test_slug}_trace.zip")
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                if os.path.abspath(src) != os.path.abspath(dest):
                    shutil.copy2(src, dest)
                artifacts["trace"] = dest
                print(f"Saved execution trace: {dest}")

    return artifacts
