from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pre_push


def write_config(root: Path, steps: list[dict], **extra) -> None:
    d = root / ".claude"
    d.mkdir(parents=True, exist_ok=True)
    (d / "harness.json").write_text(
        json.dumps({"verify": steps, **extra}), encoding="utf-8"
    )


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def test_missing_config_warns_and_passes(tmp_path, capsys):
    assert pre_push.main(root=tmp_path) == 0
    assert "跳過" in capsys.readouterr().err


def test_tracked_but_missing_config_fails_closed(tmp_path, capsys):
    # git 追蹤中的 harness.json 在 working tree 消失 = 防線被拔,不可靜默放行
    _git(tmp_path, "init")
    _git(
        tmp_path,
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "--allow-empty",
        "-m",
        "init",
    )
    write_config(tmp_path, [])
    _git(tmp_path, "add", ".claude/harness.json")
    (tmp_path / ".claude" / "harness.json").unlink()
    assert pre_push.main(root=tmp_path) == 1
    assert "fail-closed" in capsys.readouterr().err


def test_empty_verify_fails_closed(tmp_path, capsys):
    write_config(tmp_path, [])
    assert pre_push.main(root=tmp_path) == 1
    assert "fail-closed" in capsys.readouterr().err


def test_empty_verify_with_explicit_flag_passes(tmp_path):
    write_config(tmp_path, [], allow_empty_verify=True)
    assert pre_push.main(root=tmp_path) == 0


def test_all_green_passes(tmp_path):
    write_config(
        tmp_path,
        [
            {"name": "ok", "cwd": ".", "cmd": 'python -c "import sys; sys.exit(0)"'},
        ],
    )
    assert pre_push.main(root=tmp_path) == 0


def test_any_red_fails(tmp_path):
    write_config(
        tmp_path,
        [
            {"name": "ok", "cwd": ".", "cmd": 'python -c "import sys; sys.exit(0)"'},
            {"name": "boom", "cwd": ".", "cmd": 'python -c "import sys; sys.exit(3)"'},
        ],
    )
    assert pre_push.main(root=tmp_path) == 1


def test_broken_config_fails_closed(tmp_path):
    d = tmp_path / ".claude"
    d.mkdir(parents=True)
    (d / "harness.json").write_text("{not json", encoding="utf-8")
    assert pre_push.main(root=tmp_path) == 1
