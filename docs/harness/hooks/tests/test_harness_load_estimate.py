from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "harness_load_estimate.py"


# --------------------------------------------------------------------------
# fixtures / helpers
# --------------------------------------------------------------------------


def write(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def make_claude_dir(
    tmp_path: Path,
    profiles: dict,
    *,
    sp_user_version: str = "6.2.0",
    sp_project_path: str | None = None,
    files: dict[str, int] | None = None,
    sp_files: dict[str, int] | None = None,
) -> Path:
    """Build a fake ~/.claude tree.

    files:    {relative path under claude dir: byte size}
    sp_files: {relative path under the resolved superpowers dir: byte size}
    """
    claude = tmp_path / "dot-claude"
    write(claude / "harness" / "load-manifest.json", json.dumps({"profiles": profiles}))

    entries = []
    if sp_project_path is not None:
        entries.append(
            {
                "scope": "project",
                "projectPath": sp_project_path,
                "installPath": str(claude / "plugins" / "cache" / "sp" / "5.0.6"),
                "version": "5.0.6",
            }
        )
    entries.append(
        {
            "scope": "user",
            "installPath": str(claude / "plugins" / "cache" / "sp" / sp_user_version),
            "version": sp_user_version,
        }
    )
    write(
        claude / "plugins" / "installed_plugins.json",
        json.dumps({"version": 2, "plugins": {"superpowers@claude-plugins-official": entries}}),
    )

    for rel, size in (files or {}).items():
        write(claude / rel, "x" * size)
    for rel, size in (sp_files or {}).items():
        for ver in {sp_user_version, "5.0.6"}:
            write(claude / "plugins" / "cache" / "sp" / ver / rel, "x" * size)
    return claude


def run(claude: Path, *args: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--claude-dir", str(claude), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(cwd) if cwd else None,
    )


def profile(files: list[dict], project_root: str = "C:/proj/alpha") -> dict:
    return {"project_root": project_root, "files": files}


# --------------------------------------------------------------------------
# scope / condition / dedup summation
# --------------------------------------------------------------------------


def test_scope_main_excludes_subagent_files(tmp_path):
    claude = make_claude_dir(
        tmp_path,
        {
            "p": profile(
                [
                    {"path": "commands/a.md", "scope": "main"},
                    {"path": "agents/b.md", "scope": "subagent"},
                ]
            )
        },
        files={"commands/a.md": 100, "agents/b.md": 700},
    )
    res = run(claude, "--profile", "p", "--scope", "main")
    assert res.returncode == 0, res.stderr
    assert "TOTAL bytes=100" in res.stdout


def test_scope_subagent_sums_only_subagent_files(tmp_path):
    claude = make_claude_dir(
        tmp_path,
        {
            "p": profile(
                [
                    {"path": "commands/a.md", "scope": "main"},
                    {"path": "agents/b.md", "scope": "subagent"},
                ]
            )
        },
        files={"commands/a.md": 100, "agents/b.md": 700},
    )
    res = run(claude, "--profile", "p", "--scope", "subagent")
    assert res.returncode == 0, res.stderr
    assert "TOTAL bytes=700" in res.stdout


def test_condition_files_excluded_without_worst(tmp_path):
    claude = make_claude_dir(
        tmp_path,
        {
            "p": profile(
                [
                    {"path": "commands/a.md", "scope": "main"},
                    {"path": "commands/c.md", "scope": "main", "condition": "只在 X 時"},
                ]
            )
        },
        files={"commands/a.md": 100, "commands/c.md": 50},
    )
    res = run(claude, "--profile", "p", "--scope", "main")
    assert res.returncode == 0, res.stderr
    assert "TOTAL bytes=100" in res.stdout


def test_worst_includes_condition_files(tmp_path):
    claude = make_claude_dir(
        tmp_path,
        {
            "p": profile(
                [
                    {"path": "commands/a.md", "scope": "main"},
                    {"path": "commands/c.md", "scope": "main", "condition": "只在 X 時"},
                ]
            )
        },
        files={"commands/a.md": 100, "commands/c.md": 50},
    )
    res = run(claude, "--profile", "p", "--scope", "main", "--worst")
    assert res.returncode == 0, res.stderr
    assert "TOTAL bytes=150" in res.stdout


def test_same_path_listed_twice_is_counted_twice(tmp_path):
    """一支 ref 對多個 phase → 同 path 多筆,求和不去重(每次 Read 都真的佔窗口)。"""
    claude = make_claude_dir(
        tmp_path,
        {
            "p": profile(
                [
                    {"path": "skills/s.md", "scope": "main", "phase": 5},
                    {"path": "skills/s.md", "scope": "main", "phase": 6},
                ]
            )
        },
        files={"skills/s.md": 40},
    )
    res = run(claude, "--profile", "p", "--scope", "main")
    assert res.returncode == 0, res.stderr
    assert "TOTAL bytes=80" in res.stdout


# --------------------------------------------------------------------------
# <superpowers> resolution
# --------------------------------------------------------------------------


def test_superpowers_resolves_user_scope_when_project_root_not_covered(tmp_path):
    claude = make_claude_dir(
        tmp_path,
        {"p": profile([{"path": "<superpowers>/sdd/SKILL.md", "scope": "main"}])},
        sp_project_path="C:/Users/USER",
        sp_files={"sdd/SKILL.md": 33},
    )
    res = run(claude, "--profile", "p", "--scope", "main")
    assert res.returncode == 0, res.stderr
    assert "TOTAL bytes=33" in res.stdout
    assert "SUPERPOWERS=" in res.stdout
    assert "6.2.0" in res.stdout
    assert "5.0.6" not in res.stdout


def test_superpowers_uses_project_scope_when_project_root_is_covered(tmp_path):
    claude = make_claude_dir(
        tmp_path,
        {
            "p": profile(
                [{"path": "<superpowers>/sdd/SKILL.md", "scope": "main"}],
                project_root="C:/Users/USER/work/thing",
            )
        },
        sp_project_path="C:/Users/USER",
        sp_files={"sdd/SKILL.md": 33},
    )
    res = run(claude, "--profile", "p", "--scope", "main")
    assert res.returncode == 0, res.stderr
    assert "5.0.6" in res.stdout


def test_superpowers_resolution_ignores_process_cwd(tmp_path):
    """腳本住在 ~/.claude/hooks,SC-4 量法本身就 cd 進去 —— 從那裡跑不得改變解析結果。"""
    covered_cwd = tmp_path / "Users" / "USER" / "dot-claude" / "hooks"
    covered_cwd.mkdir(parents=True)
    claude = make_claude_dir(
        tmp_path,
        {
            "p": profile(
                [{"path": "<superpowers>/sdd/SKILL.md", "scope": "main"}],
                project_root="C:/proj/alpha",
            )
        },
        sp_project_path=str(tmp_path / "Users" / "USER"),
        sp_files={"sdd/SKILL.md": 33},
    )
    res = run(claude, "--profile", "p", "--scope", "main", cwd=covered_cwd)
    assert res.returncode == 0, res.stderr
    assert "6.2.0" in res.stdout, "解析基準必須是 profile 的 project_root,不是 process cwd"


def test_unresolvable_superpowers_exits_nonzero(tmp_path):
    claude = make_claude_dir(
        tmp_path,
        {"p": profile([{"path": "<superpowers>/sdd/SKILL.md", "scope": "main"}])},
        sp_files={"sdd/SKILL.md": 33},
    )
    (claude / "plugins" / "installed_plugins.json").write_text(
        json.dumps({"version": 2, "plugins": {}}), encoding="utf-8"
    )
    res = run(claude, "--profile", "p", "--scope", "main")
    assert res.returncode != 0
    assert "SUPERPOWERS" in (res.stdout + res.stderr)


# --------------------------------------------------------------------------
# 完整性 gate
# --------------------------------------------------------------------------


def test_missing_manifest_path_exits_nonzero(tmp_path):
    """風險表:故意在 manifest 加一筆不存在的路徑,腳本必須 exit 非 0(不得靜默略過)。"""
    claude = make_claude_dir(
        tmp_path,
        {"p": profile([{"path": "commands/ghost.md", "scope": "main"}])},
        files={},
    )
    res = run(claude, "--profile", "p", "--scope", "main")
    assert res.returncode != 0
    assert "ghost.md" in (res.stdout + res.stderr)


def test_profile_without_project_root_exits_nonzero(tmp_path):
    claude = make_claude_dir(
        tmp_path,
        {"p": {"files": [{"path": "commands/a.md", "scope": "main"}]}},
        files={"commands/a.md": 10},
    )
    res = run(claude, "--profile", "p", "--scope", "main")
    assert res.returncode != 0
    assert "project_root" in (res.stdout + res.stderr)


def test_unknown_profile_exits_nonzero(tmp_path):
    claude = make_claude_dir(tmp_path, {"p": profile([])})
    res = run(claude, "--profile", "nope", "--scope", "main")
    assert res.returncode != 0


# --------------------------------------------------------------------------
# before / after 降幅
# --------------------------------------------------------------------------


def test_before_after_reports_reduction_pct(tmp_path):
    claude = make_claude_dir(
        tmp_path,
        {
            "p-before": profile([{"path": "commands/big.md", "scope": "main"}]),
            "p": profile([{"path": "commands/small.md", "scope": "main"}]),
        },
        files={"commands/big.md": 1000, "commands/small.md": 750},
    )
    res = run(claude, "--before", "p-before", "--after", "p", "--scope", "main")
    assert res.returncode == 0, res.stderr
    assert "BEFORE bytes=1000" in res.stdout
    assert "AFTER bytes=750" in res.stdout
    assert "REDUCTION pct=25.0" in res.stdout


def test_before_after_different_superpowers_version_exits_nonzero(tmp_path):
    """降幅制的前提是分子分母同基準 —— 兩側解到不同版本必須 exit 非 0。"""
    claude = make_claude_dir(
        tmp_path,
        {
            "p-before": profile(
                [{"path": "<superpowers>/sdd/SKILL.md", "scope": "main"}],
                project_root="C:/Users/USER/work",
            ),
            "p": profile(
                [{"path": "<superpowers>/sdd/SKILL.md", "scope": "main"}],
                project_root="C:/proj/alpha",
            ),
        },
        sp_project_path="C:/Users/USER",
        sp_files={"sdd/SKILL.md": 33},
    )
    res = run(claude, "--before", "p-before", "--after", "p", "--scope", "main")
    assert res.returncode != 0
    assert "SUPERPOWERS" in (res.stdout + res.stderr)


# --------------------------------------------------------------------------
# --verify-dispositions (SC-3)
# --------------------------------------------------------------------------


def make_dispositions(claude: Path, rows: list[dict]) -> None:
    write(claude / "harness" / "dispositions.json", json.dumps({"rows": rows}, ensure_ascii=False))


def test_verify_dispositions_all_pass_exits_zero(tmp_path):
    claude = make_claude_dir(tmp_path, {"p": profile([])})
    write(claude / "commands" / "a.md", "keep this line\n")
    make_dispositions(
        claude,
        [
            {
                "note": "row",
                "disposition": "核心",
                "checks": [{"kind": "present", "file": "commands/a.md", "string": "keep this"}],
            }
        ],
    )
    res = run(claude, "--verify-dispositions")
    assert res.returncode == 0, res.stdout + res.stderr
    assert "VIOLATIONS n=0" in res.stdout


def test_verify_dispositions_absent_string_still_present_is_violation(tmp_path):
    claude = make_claude_dir(tmp_path, {"p": profile([])})
    write(claude / "commands" / "a.md", "this should have been deleted\n")
    make_dispositions(
        claude,
        [
            {
                "note": "row",
                "disposition": "刪",
                "checks": [
                    {"kind": "absent", "file": "commands/a.md", "string": "should have been deleted"}
                ],
            }
        ],
    )
    res = run(claude, "--verify-dispositions")
    assert res.returncode != 0
    assert "VIOLATIONS n=1" in res.stdout
    assert "absent" in res.stdout


def test_verify_dispositions_present_string_missing_is_violation(tmp_path):
    claude = make_claude_dir(tmp_path, {"p": profile([])})
    write(claude / "harness" / "refs" / "r.md", "nothing relevant\n")
    make_dispositions(
        claude,
        [
            {
                "note": "row",
                "disposition": "ref",
                "checks": [
                    {"kind": "present", "file": "harness/refs/r.md", "string": "expected text"}
                ],
            }
        ],
    )
    res = run(claude, "--verify-dispositions")
    assert res.returncode != 0
    assert "VIOLATIONS n=1" in res.stdout
    assert "present" in res.stdout


def test_verify_dispositions_missing_file_is_violation_not_crash(tmp_path):
    claude = make_claude_dir(tmp_path, {"p": profile([])})
    make_dispositions(
        claude,
        [
            {
                "note": "row",
                "disposition": "ref",
                "checks": [{"kind": "present", "file": "harness/refs/gone.md", "string": "x"}],
            }
        ],
    )
    res = run(claude, "--verify-dispositions")
    assert res.returncode != 0
    assert "VIOLATIONS n=1" in res.stdout


def test_verify_dispositions_rejects_row_without_checks(tmp_path):
    """§5 填寫規則:每一列至少要有一個檢查。空 checks 的列是漏填,不是通過。"""
    claude = make_claude_dir(tmp_path, {"p": profile([])})
    make_dispositions(claude, [{"note": "row", "disposition": "核心", "checks": []}])
    res = run(claude, "--verify-dispositions")
    assert res.returncode != 0
    assert "checks" in (res.stdout + res.stderr)
