from __future__ import annotations

import json
from pathlib import Path

import pre_push


def write_config(root: Path, steps: list[dict]) -> None:
    d = root / ".claude"
    d.mkdir(parents=True, exist_ok=True)
    (d / "harness.json").write_text(json.dumps({"verify": steps}), encoding="utf-8")


def test_missing_config_warns_and_passes(tmp_path, capsys):
    assert pre_push.main(root=tmp_path) == 0
    assert "跳過" in capsys.readouterr().err


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
