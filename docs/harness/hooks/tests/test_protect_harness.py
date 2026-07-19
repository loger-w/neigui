from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).parent.parent / "protect-harness.py"


def run_hook(tool_name: str, tool_input: dict) -> subprocess.CompletedProcess:
    payload = {"tool_name": tool_name, "tool_input": tool_input}
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def asks(res: subprocess.CompletedProcess) -> bool:
    if res.returncode != 0 or not res.stdout.strip():
        return False
    out = json.loads(res.stdout)
    return out["hookSpecificOutput"]["permissionDecision"] == "ask"


def passes(res: subprocess.CompletedProcess) -> bool:
    return res.returncode == 0 and not res.stdout.strip()


# --- Write/Edit:守備範圍 → ask ---


def test_write_hook_file_asks():
    res = run_hook(
        "Write",
        {"file_path": "C:\\Users\\USER\\.claude\\hooks\\safety-hooks.py"},
    )
    assert asks(res)


def test_edit_settings_asks():
    res = run_hook("Edit", {"file_path": "C:/Users/USER/.claude/settings.json"})
    assert asks(res)


def test_edit_settings_local_asks():
    res = run_hook(
        "Edit",
        {"file_path": "C:/side-project/neigui/.claude/settings.local.json"},
    )
    assert asks(res)


def test_write_agent_asks():
    res = run_hook(
        "Write",
        {"file_path": "C:/Users/USER/.claude/agents/design-reviewer.md"},
    )
    assert asks(res)


def test_edit_project_harness_json_asks():
    res = run_hook("Edit", {"file_path": "C:/side-project/neigui/.claude/harness.json"})
    assert asks(res)


def test_write_git_hooks_asks():
    res = run_hook("Write", {"file_path": "C:/side-project/neigui/.git/hooks/pre-push"})
    assert asks(res)


def test_edit_scripts_git_hooks_asks():
    res = run_hook(
        "Edit",
        {"file_path": "C:/side-project/neigui/scripts/git-hooks/pre_push.py"},
    )
    assert asks(res)


def test_multiedit_hook_test_file_asks():
    res = run_hook(
        "MultiEdit",
        {"file_path": "C:/Users/USER/.claude/hooks/tests/test_safety_hooks.py"},
    )
    assert asks(res)


# --- Write/Edit:守備範圍外 → 放行 ---


def test_write_normal_source_passes():
    res = run_hook("Write", {"file_path": "C:/side-project/neigui/backend/main.py"})
    assert passes(res)


def test_edit_harness_mirror_passes():
    # docs/harness/ 是鏡像副本,同步是日常操作,不在守備範圍
    res = run_hook(
        "Edit",
        {"file_path": "C:/side-project/neigui/docs/harness/hooks/safety-hooks.py"},
    )
    assert passes(res)


def test_edit_project_claude_md_passes():
    res = run_hook("Edit", {"file_path": "C:/side-project/neigui/CLAUDE.md"})
    assert passes(res)


# --- shell 面:守備路徑 + 寫入動詞 → ask ---


def test_bash_redirect_into_hooks_asks():
    res = run_hook("Bash", {"command": "echo x > ~/.claude/hooks/evil.py"})
    assert asks(res)


def test_bash_rm_git_hooks_asks():
    res = run_hook("Bash", {"command": "rm scripts/git-hooks/pre_push.py"})
    assert asks(res)


def test_powershell_set_content_settings_asks():
    res = run_hook(
        "PowerShell",
        {"command": 'Set-Content C:\\Users\\USER\\.claude\\settings.json "{}"'},
    )
    assert asks(res)


def test_bash_cp_over_agent_asks():
    res = run_hook(
        "Bash",
        {"command": "cp /tmp/x.md ~/.claude/agents/design-reviewer.md"},
    )
    assert asks(res)


# --- shell 面:純讀 / 執行 → 放行 ---


def test_bash_run_hook_script_passes():
    res = run_hook(
        "Bash",
        {"command": "python C:/Users/USER/.claude/hooks/block-no-verify.py"},
    )
    assert passes(res)


def test_bash_pytest_hooks_tests_passes():
    res = run_hook("Bash", {"command": "python -m pytest ~/.claude/hooks/tests -q"})
    assert passes(res)


def test_bash_cat_harness_json_passes():
    res = run_hook("Bash", {"command": "cat .claude/harness.json"})
    assert passes(res)


def test_bash_write_unrelated_passes():
    res = run_hook("Bash", {"command": "echo hi > /tmp/out.txt"})
    assert passes(res)


# --- 防禦性:壞 payload 不擋 ---


def test_malformed_json_passes():
    res = subprocess.run(
        [sys.executable, str(HOOK)],
        input="{not json",
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert res.returncode == 0


def test_other_tool_passes():
    res = run_hook("Read", {"file_path": "C:/Users/USER/.claude/settings.json"})
    assert passes(res)
