"""Tests for report screenshot/video artifact gating."""

from __future__ import annotations

import json
from pathlib import Path

from integrations.browser_use.report_artifacts import finalize_artifacts, persist_screenshots


def _write_history(path: Path, *, successful: bool, with_error: bool, screenshots: list[Path]):
    history = []
    for i, sp in enumerate(screenshots, start=1):
        result = [{"is_done": False}]
        if with_error and i == len(screenshots):
            result = [{"error": "click failed", "is_done": False}]
        history.append(
            {
                "result": result,
                "state": {"screenshot_path": str(sp)},
            }
        )
    data = {
        "isSuccessful": successful,
        "runLog": {"isSuccessful": successful},
        "fullHistoryDump": {"history": history},
    }
    path.write_text(json.dumps(data), encoding="utf-8")


def test_persist_screenshots_skips_on_passed_only_on_failure(tmp_path):
    ss = [tmp_path / f"step_{i}.png" for i in range(1, 4)]
    for p in ss:
        p.write_bytes(b"png")
    hist = tmp_path / "hist.json"
    _write_history(hist, successful=True, with_error=False, screenshots=ss)

    saved = persist_screenshots(
        "demo", str(hist), mode="only-on-failure", screenshots_dir=tmp_path / "screenshots"
    )
    assert saved == []


def test_persist_screenshots_keeps_failed_step_only(tmp_path):
    ss = [tmp_path / f"step_{i}.png" for i in range(1, 4)]
    for p in ss:
        p.write_bytes(b"png")
    hist = tmp_path / "hist.json"
    _write_history(hist, successful=False, with_error=True, screenshots=ss)

    saved = persist_screenshots(
        "demo", str(hist), mode="only-on-failure", screenshots_dir=tmp_path / "screenshots"
    )
    assert len(saved) == 1
    assert saved[0].endswith("step_3.png")


def test_finalize_artifacts_ignores_tmp_and_tiny_videos(tmp_path):
    videos_out = tmp_path / "videos"
    traces_out = tmp_path / "traces"
    videos_out.mkdir()
    traces_out.mkdir()
    junk = videos_out / "junk.mp4"
    junk.write_bytes(b"x" * 100)

    arts = finalize_artifacts(
        "demo", video_dir=None, traces_dir=None, videos_out=videos_out, traces_out=traces_out
    )
    assert "video" not in arts

    session = tmp_path / "session_videos"
    session.mkdir()
    good = session / "rec.webm"
    good.write_bytes(b"v" * 20_000)
    arts = finalize_artifacts(
        "demo",
        video_dir=str(session),
        traces_dir=None,
        videos_out=videos_out,
        traces_out=traces_out,
    )
    assert "video" in arts
    assert Path(arts["video"]).stat().st_size >= 10_000


def test_finalize_artifacts_does_not_scavenge_stable_slug_video(tmp_path):
    """When discovery records into reports/videos/, never promote a prior Digital.webm."""
    videos = tmp_path / "videos"
    videos.mkdir()
    stale = videos / "Digital.webm"
    stale.write_bytes(b"old" * 10_000)
    # Tiny/broken session mp4 (ffmpeg WinError-style failure)
    broken = videos / "06a68870-6b33-7abe-8000-4b36a9eae818.mp4"
    broken.write_bytes(b"x" * 100)

    arts = finalize_artifacts(
        "Digital",
        video_dir=str(videos),
        traces_dir=None,
        videos_out=videos,
        traces_out=tmp_path / "traces",
    )
    assert "video" not in arts
    # Stale report file must remain untouched as a source — do not claim it as this run
    assert stale.exists()


def test_finalize_artifacts_prefers_explicit_session_recording(tmp_path):
    videos = tmp_path / "videos"
    videos.mkdir()
    stale = videos / "Digital.webm"
    stale.write_bytes(b"old" * 10_000)
    session = videos / "aabbccdd-1111-2222-3333-444444444444.mp4"
    session.write_bytes(b"new" * 10_000)

    arts = finalize_artifacts(
        "Digital",
        video_dir=str(videos),
        traces_dir=None,
        videos_out=videos,
        traces_out=tmp_path / "traces",
        preferred_video=str(session),
    )
    assert arts.get("video", "").endswith("Digital.mp4")
    assert Path(arts["video"]).stat().st_size >= 10_000
    assert not stale.exists()  # other-extension cleanup
