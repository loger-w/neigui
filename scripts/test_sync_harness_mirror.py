from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "sync_harness_mirror", Path(__file__).parent / "sync-harness-mirror.py"
)
assert _spec is not None and _spec.loader is not None
sync = importlib.util.module_from_spec(_spec)
sys.modules["sync_harness_mirror"] = sync
_spec.loader.exec_module(sync)


def make_home(tmp_path: Path) -> Path:
    home = tmp_path / "claude-home"
    (home / "commands").mkdir(parents=True)
    (home / "commands" / "feat.md").write_text(
        "feat v1\nsecond line\n", encoding="utf-8", newline="\n"
    )
    (home / "hooks" / "tests").mkdir(parents=True)
    (home / "hooks" / "safety-hooks.py").write_text("hook v1", encoding="utf-8")
    (home / "hooks" / "tests" / "test_safety_hooks.py").write_text(
        "test v1", encoding="utf-8"
    )
    (home / "agents").mkdir()
    (home / "agents" / "design-reviewer.md").write_text("agent v1", encoding="utf-8")
    (home / "skills" / "auto-verify").mkdir(parents=True)
    (home / "skills" / "auto-verify" / "SKILL.md").write_text("av v1", encoding="utf-8")
    (home / "skills" / "branch-lifecycle").mkdir(parents=True)
    (home / "skills" / "branch-lifecycle" / "SKILL.md").write_text(
        "bl v1", encoding="utf-8"
    )
    (home / "CLAUDE.md").write_text("rules v1", encoding="utf-8")
    return home


def run(mode: str, home: Path, mirror: Path) -> int:
    return sync.main([mode], claude_home=home, mirror=mirror)


def test_fix_then_check_green(tmp_path, capsys):
    home = make_home(tmp_path)
    mirror = tmp_path / "mirror"
    assert run("--fix", home, mirror) == 0
    capsys.readouterr()
    assert run("--check", home, mirror) == 0
    assert "全部一致" in capsys.readouterr().out


def test_check_detects_missing(tmp_path, capsys):
    home = make_home(tmp_path)
    mirror = tmp_path / "mirror"
    assert run("--check", home, mirror) == 1
    assert "MISSING" in capsys.readouterr().out


def test_check_detects_drift(tmp_path, capsys):
    home = make_home(tmp_path)
    mirror = tmp_path / "mirror"
    run("--fix", home, mirror)
    (home / "commands" / "feat.md").write_text("feat v2", encoding="utf-8")
    capsys.readouterr()
    assert run("--check", home, mirror) == 1
    assert "DRIFT    commands" in capsys.readouterr().out.replace("\\", "/")


def test_new_source_file_auto_enrolled(tmp_path, capsys):
    # 原檔側新增檔案不需要改清單 — glob 自動入列(消滅清單漏列雙源)
    home = make_home(tmp_path)
    mirror = tmp_path / "mirror"
    run("--fix", home, mirror)
    (home / "hooks" / "new-hook.py").write_text("new", encoding="utf-8")
    capsys.readouterr()
    assert run("--check", home, mirror) == 1
    assert "MISSING  hooks" in capsys.readouterr().out.replace("\\", "/")


def test_orphan_in_mirror_detected(tmp_path, capsys):
    home = make_home(tmp_path)
    mirror = tmp_path / "mirror"
    run("--fix", home, mirror)
    (mirror / "hooks" / "stale.py").write_text("stale", encoding="utf-8")
    capsys.readouterr()
    assert run("--check", home, mirror) == 1
    assert "ORPHAN" in capsys.readouterr().out


def test_crlf_only_difference_is_not_drift(tmp_path, capsys):
    # 鏡像經 git checkout 會轉 CRLF;行尾差異不是內容漂移,不可誤報
    home = make_home(tmp_path)
    mirror = tmp_path / "mirror"
    run("--fix", home, mirror)
    crlf = (
        (mirror / "commands" / "feat.md")
        .read_bytes()
        .replace(b"\n", b"\r\n")
        .replace(b"\r\r\n", b"\r\n")
    )
    (mirror / "commands" / "feat.md").write_bytes(crlf)
    capsys.readouterr()
    assert run("--check", home, mirror) == 0


def test_excluded_retired_hook_not_synced(tmp_path):
    home = make_home(tmp_path)
    (home / "hooks" / "harness-push-gate.py").write_text("retired", encoding="utf-8")
    mirror = tmp_path / "mirror"
    assert run("--fix", home, mirror) == 0
    assert not (mirror / "hooks" / "harness-push-gate.py").exists()
