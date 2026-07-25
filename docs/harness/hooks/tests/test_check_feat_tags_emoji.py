from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import check_feat_tags  # noqa: E402

SCRIPT = Path(__file__).parent.parent / "check_feat_tags.py"


# ---------------------------------------------------------------------------
# git fixture
# ---------------------------------------------------------------------------


def git(repo: Path, *args: str) -> str:
    res = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return res.stdout.strip()


def make_repo(tmp_path: Path, branch: str) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@example.com")
    git(repo, "config", "user.name", "t")
    (repo / "f.txt").write_text("base", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "base")
    git(repo, "switch", "-q", "-c", branch)
    return repo


def commit(repo: Path, subject: str, body: str = "") -> str:
    p = repo / "f.txt"
    p.write_text(p.read_text(encoding="utf-8") + subject + "\n", encoding="utf-8")
    git(repo, "add", ".")
    msg = subject if not body else f"{subject}\n\n{body}"
    git(repo, "commit", "-q", "-m", msg)
    return git(repo, "rev-parse", "HEAD")


def run(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--repo", str(repo), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# --since / --state 皆可省(§6.2 步驟 2)
# ---------------------------------------------------------------------------


def test_since_replaces_state(tmp_path):
    repo = make_repo(tmp_path, "mod/demo")
    base = git(repo, "rev-parse", "HEAD")
    commit(repo, "🔴 fix(x): behaviour change")
    res = run(repo, "--since", base)
    assert res.returncode == 0, res.stdout + res.stderr
    assert "commits=1" in res.stdout


def test_state_and_since_both_missing_falls_back_to_merge_base(tmp_path):
    repo = make_repo(tmp_path, "mod/demo")
    commit(repo, "🔵 refactor(x): tidy")
    res = run(repo)
    assert res.returncode == 0, res.stdout + res.stderr
    assert "commits=1" in res.stdout


# ---------------------------------------------------------------------------
# 三類 emoji checker(§6.2 步驟 1 的採用判準)
# ---------------------------------------------------------------------------


def test_emoji_ok_when_at_least_one_of_three_present(tmp_path):
    repo = make_repo(tmp_path, "mod/demo")
    base = git(repo, "rev-parse", "HEAD")
    commit(repo, "🔴 fix(x): behaviour change")
    commit(repo, "chore(mod/demo): Phase 7 驗證截圖")  # 合法無 emoji commit
    res = run(repo, "--since", base)
    assert res.returncode == 0, res.stdout
    assert "PASS" in res.stdout


def test_emoji_fails_when_no_commit_carries_any_of_three(tmp_path):
    """「這輪流程有沒有做三類分離」— 一個都沒有就是沒做。"""
    repo = make_repo(tmp_path, "mod/demo")
    base = git(repo, "rev-parse", "HEAD")
    commit(repo, "fix(x): behaviour change")
    commit(repo, "chore(x): notes")
    res = run(repo, "--since", base)
    assert "emoji" in res.stdout
    assert "FAIL" in res.stdout or "WARN" in res.stdout


def test_emoji_rejects_emoji_outside_the_three(tmp_path):
    """帶 emoji 的 commit 其 emoji 必須是 🔴/🟢/🔵 三者之一。"""
    repo = make_repo(tmp_path, "mod/demo")
    base = git(repo, "rev-parse", "HEAD")
    commit(repo, "🔴 fix(x): real change")
    commit(repo, "✨ feat(x): sparkle")
    res = run(repo, "--since", base)
    assert "✨" in res.stdout


def test_emoji_does_not_check_type_to_emoji_mapping(tmp_path):
    """實測 type 與 emoji 非一對一(同為 fix 型有的掛 🔴 有的掛 🟢)—— 不驗對應。"""
    repo = make_repo(tmp_path, "mod/demo")
    base = git(repo, "rev-parse", "HEAD")
    commit(repo, "🟢 fix(x): 新功能但用 fix 型")
    commit(repo, "🔴 feat(x): 行為改動但用 feat 型")
    res = run(repo, "--since", base)
    assert res.returncode == 0, res.stdout
    assert "PASS" in res.stdout


# ---------------------------------------------------------------------------
# 分支 prefix 決定套哪組判準(§6.2 步驟 3)+ warning 模式(步驟 5)
# ---------------------------------------------------------------------------


def test_flow_kind_from_branch_prefix():
    assert check_feat_tags.flow_kind_for_branch("feat/x") == "feat"
    assert check_feat_tags.flow_kind_for_branch("mod/x") == "mod"
    assert check_feat_tags.flow_kind_for_branch("fix/x") == "bug"
    assert check_feat_tags.flow_kind_for_branch("refactor/x") == "refactor"
    assert check_feat_tags.flow_kind_for_branch("perf/x") == "perf"
    assert check_feat_tags.flow_kind_for_branch("something-else") is None


def test_non_feat_flow_is_warning_only_exit_zero(tmp_path):
    """非 /feat 流程先以 warning 模式上線:印警告但 exit 0。"""
    repo = make_repo(tmp_path, "mod/demo")
    base = git(repo, "rev-parse", "HEAD")
    commit(repo, "fix(x): no emoji at all")
    res = run(repo, "--since", base)
    assert res.returncode == 0, res.stdout
    assert "WARN" in res.stdout


def test_feat_flow_still_requires_tdd_tags(tmp_path):
    """/feat 分支照舊跑 TDD tag 配對且為 block 模式。"""
    repo = make_repo(tmp_path, "feat/demo")
    base = git(repo, "rev-parse", "HEAD")
    commit(repo, "🟢 feat(x): implement SC-1 [green]")
    res = run(repo, "--since", base)
    assert res.returncode == 1, res.stdout
    assert "FAIL" in res.stdout
