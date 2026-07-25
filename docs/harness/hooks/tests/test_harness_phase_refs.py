from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))
import harness_lib  # noqa: E402
from test_harness_lib import make_state, write_state  # noqa: E402

HOOK = Path(__file__).parent.parent / "harness-context.py"


def write_manifest(tmp_path: Path, files: list[dict]) -> Path:
    claude = tmp_path / "dot-claude"
    (claude / "harness").mkdir(parents=True)
    (claude / "harness" / "load-manifest.json").write_text(
        json.dumps({"profiles": {"feat-L": {"project_root": "C:/x", "files": files}}}),
        encoding="utf-8",
    )
    return claude


# ---------------------------------------------------------------------------
# PHASE_GATES 不得被動到(v3 的 ValueError 陷阱)
# ---------------------------------------------------------------------------


def test_phase_gates_entries_stay_two_tuples():
    """加第三欄會讓 `for p, gate in PHASE_GATES` ValueError,而該例外被兩層 except 吞掉
    → 整段 phase 注入靜默消失。這條測試就是那個陷阱的護欄。"""
    for entry in harness_lib.PHASE_GATES:
        assert len(entry) == 2, f"PHASE_GATES 條目必須是 2 元素:{entry}"
    for p, gate in harness_lib.PHASE_GATES:  # 必須解得開
        assert isinstance(p, float) and isinstance(gate, str)


def test_gate_for_phase_still_works():
    assert "auto-verify" in harness_lib.gate_for_phase(5.0)
    assert "未知 phase" in harness_lib.gate_for_phase(-999.0)


# ---------------------------------------------------------------------------
# refs_for_phase
# ---------------------------------------------------------------------------


def test_refs_for_phase_returns_manifest_refs(tmp_path):
    claude = write_manifest(
        tmp_path,
        [
            {"path": "harness/refs/feat-phase3.md", "scope": "main", "phase": 3},
            {"path": "harness/refs/review-protocol.md", "scope": "main", "phase": 4},
        ],
    )
    assert harness_lib.refs_for_phase(3.0, claude_dir=claude) == [
        "harness/refs/feat-phase3.md"
    ]


def test_refs_for_phase_lists_all_refs_of_that_phase(tmp_path):
    claude = write_manifest(
        tmp_path,
        [
            {"path": "harness/refs/scope-tiers.md", "scope": "main", "phase": 0},
            {"path": "harness/refs/feat-phase0-2.md", "scope": "main", "phase": 0},
        ],
    )
    got = harness_lib.refs_for_phase(0.0, claude_dir=claude)
    assert set(got) == {"harness/refs/scope-tiers.md", "harness/refs/feat-phase0-2.md"}


def test_refs_for_phase_excludes_conditional(tmp_path):
    """條件式 ref 每回合提醒是噪音 — 觸發條件寫在 command 核心。"""
    claude = write_manifest(
        tmp_path,
        [
            {"path": "harness/refs/review-protocol.md", "scope": "main", "phase": 4},
            {
                "path": "harness/refs/feat-phase4-fix.md",
                "scope": "main",
                "phase": 4,
                "condition": "收到 test-gap finding",
            },
        ],
    )
    assert harness_lib.refs_for_phase(4.0, claude_dir=claude) == [
        "harness/refs/review-protocol.md"
    ]


def test_refs_for_phase_excludes_non_ref_and_subagent_paths(tmp_path):
    claude = write_manifest(
        tmp_path,
        [
            {"path": "skills/auto-verify/SKILL.md", "scope": "main", "phase": 5},
            {
                "path": "harness/refs/reviewer-preamble.md",
                "scope": "subagent",
                "phase": 1,
            },
            {"path": "harness/refs/review-protocol.md", "scope": "main", "phase": 1},
        ],
    )
    assert harness_lib.refs_for_phase(5.0, claude_dir=claude) == []
    assert harness_lib.refs_for_phase(1.0, claude_dir=claude) == [
        "harness/refs/review-protocol.md"
    ]


def test_refs_for_phase_dedups_same_path(tmp_path):
    claude = write_manifest(
        tmp_path,
        [
            {"path": "harness/refs/review-protocol.md", "scope": "main", "phase": 1},
            {"path": "harness/refs/review-protocol.md", "scope": "main", "phase": 1},
        ],
    )
    assert harness_lib.refs_for_phase(1.0, claude_dir=claude) == [
        "harness/refs/review-protocol.md"
    ]


def test_refs_for_phase_unknown_phase_is_empty(tmp_path):
    claude = write_manifest(
        tmp_path, [{"path": "harness/refs/feat-phase3.md", "scope": "main", "phase": 3}]
    )
    assert harness_lib.refs_for_phase(99.0, claude_dir=claude) == []


def test_refs_for_phase_missing_manifest_fails_open(tmp_path):
    """hook 是 fail-open 的 — manifest 不見不能讓注入整段炸掉。"""
    assert harness_lib.refs_for_phase(3.0, claude_dir=tmp_path / "nope") == []


def test_refs_for_phase_corrupt_manifest_fails_open(tmp_path):
    claude = tmp_path / "dot-claude"
    (claude / "harness").mkdir(parents=True)
    (claude / "harness" / "load-manifest.json").write_text(
        "{not json", encoding="utf-8"
    )
    assert harness_lib.refs_for_phase(3.0, claude_dir=claude) == []


def test_real_manifest_drives_phase_refs():
    """PHASE_REFS 不手抄:真的從在役 manifest 產生。"""
    got = harness_lib.refs_for_phase(3.0)
    assert "harness/refs/feat-phase3.md" in got


# ---------------------------------------------------------------------------
# harness-context.py 追加第四行(不取代既有三行)
# ---------------------------------------------------------------------------


def run_hook(payload: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def test_hook_appends_refs_line_keeping_existing_three(tmp_path):
    write_state(tmp_path, "demo-feature", make_state(current_phase=3))
    res = run_hook({"hook_event_name": "SessionStart", "cwd": str(tmp_path)})
    assert res.returncode == 0
    lines = res.stdout.strip().splitlines()
    assert "demo-feature" in lines[0]
    assert "phase:3" in lines[1].replace(" ", "")
    assert "state.json" in lines[2]  # state_is_lagging 警告的錨,不得被取代
    assert any("feat-phase3.md" in ln for ln in lines[3:]), res.stdout


def test_hook_omits_refs_line_when_phase_has_no_refs(tmp_path):
    write_state(tmp_path, "demo-feature", make_state(current_phase=5))
    res = run_hook({"hook_event_name": "SessionStart", "cwd": str(tmp_path)})
    assert res.returncode == 0
    assert "harness/refs/" not in res.stdout
