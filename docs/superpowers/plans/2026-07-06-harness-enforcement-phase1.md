# Harness 強制層補強 v3 — 第一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 harness 的流程合規從「模型自律」搬到機械層 — 注入(SessionStart/UserPromptSubmit)+ 回合末審計(Stop)+ 雙層 push gate(PreToolUse ask + git pre-push 跑測試)。

**Architecture:** 三個新 Python hook(通用骨架,`~/.claude/hooks/`,共用 `harness_lib.py` 做 state.json 探索)+ 專案插槽 `.claude/harness.json`(驗證指令單一來源,pre-push 與 auto-verify 共用)。spec:`docs/specs/harness-enforcement/design.md`。

**Tech Stack:** Python 3.12 stdlib only(hooks 無第三方依賴)、pytest(hook 測試)、git hooks(sh shim + Python)。

**本計畫只含第一期。** 第二期(harness-check script 化 Phase 5/8 gate + feat.md 改版)依 design §7 rollout,要等第一期用 1-2 個真實 feature 觀察後另出 plan。

## Global Constraints

- 每個 `.py` 第一行(註解後)`from __future__ import annotations`;type hints 無例外(`dict | None` 風格)。
- Hooks 是 CLI script,`print` 到 stdout/stderr 是其輸出機制(沿用既有三個 hook 的慣例;CLAUDE.md「禁止 print」是 backend app code 規則,不適用 hooks)。
- 注入/審計 hook fail-open(內部錯誤 → stderr 警告 + exit 0);push-gate fail-closed(內部錯誤 → 仍回 `ask`)。此為 design §4 的顯式決策,是 catch-all `except Exception` 的合法場景(有具體處理:降級行為 + 印原因)。
- 無 state.json 的 session:注入/審計 hook 必須零輸出(exit 0)。
- 「進行中 feature」判定(design §2.1):`paused == null` **且** `final_merge_sha` 空 **且** `8.5 not in completed_phases`;多個取 `last_updated` 最新。
- Hook stdin JSON 兼容 `tool_name`/`toolName` 雙格式(照抄 safety-hooks.py 寫法)。
- 新 hook 的 matcher 覆蓋 `Bash|PowerShell`(本環境有 PowerShell 工具;舊 hooks 只管 Bash 的 gap 記入 next-time.md,不在本計畫修)。
- 鏡像紀律:`~/.claude/` 是 source of truth,改完 cp 到 `docs/harness/`(README 既有流程),repo commit 只 commit 鏡像與專案內檔案。
- Commit 格式:`<type>(<scope>): <subject>`,scope 用 `harness`。

## 前置檢查(Task 1 的 Step 0 執行)

```powershell
python -m pytest --version
```
若 pytest 不存在:`python -m pip install pytest`。

---

### Task 1: `harness_lib.py` — state.json 探索與 lagging 判定(共用庫)

**Files:**
- Create: `C:\Users\USER\.claude\hooks\harness_lib.py`
- Test: `C:\Users\USER\.claude\hooks\tests\test_harness_lib.py`

**Interfaces:**
- Produces(Task 2/3 依賴,精確簽名):
  - `PHASE_GATES: list[tuple[float, str]]`
  - `gate_for_phase(phase: float) -> str`
  - `load_state(path: Path) -> dict | None`
  - `is_active(state: dict) -> bool`
  - `find_active_feature(cwd: str) -> tuple[Path, dict] | None`(回傳 `(state.json 路徑, state dict)`)
  - `state_is_lagging(cwd: str, state_path: Path, state: dict) -> bool`

- [ ] **Step 1: 建測試目錄與失敗測試**

寫 `C:\Users\USER\.claude\hooks\tests\test_harness_lib.py`:

```python
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import harness_lib


def make_state(**overrides) -> dict:
    state = {
        "slug": "demo-feature",
        "branch": "feat/demo-feature",
        "current_phase": 3,
        "completed_phases": [-1, 0, 1, 2],
        "last_updated": "2026-07-06T10:00:00+08:00",
        "paused": None,
    }
    state.update(overrides)
    return state


def write_state(root: Path, slug: str, state: dict) -> Path:
    d = root / ".claude" / "feat" / slug
    d.mkdir(parents=True)
    p = d / "state.json"
    p.write_text(json.dumps(state), encoding="utf-8")
    return p


class TestIsActive:
    def test_active_state(self):
        assert harness_lib.is_active(make_state()) is True

    def test_paused_not_active(self):
        assert harness_lib.is_active(make_state(paused="user request")) is False

    def test_merged_not_active(self):
        assert harness_lib.is_active(make_state(final_merge_sha="abc123")) is False

    def test_completed_85_not_active(self):
        assert harness_lib.is_active(
            make_state(completed_phases=[-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8.5])
        ) is False


class TestFindActiveFeature:
    def test_no_feat_dir(self, tmp_path):
        assert harness_lib.find_active_feature(str(tmp_path)) is None

    def test_single_active(self, tmp_path):
        write_state(tmp_path, "demo-feature", make_state())
        found = harness_lib.find_active_feature(str(tmp_path))
        assert found is not None
        _, state = found
        assert state["slug"] == "demo-feature"

    def test_picks_latest_of_multiple(self, tmp_path):
        write_state(tmp_path, "older", make_state(slug="older", last_updated="2026-07-01T10:00:00+08:00"))
        write_state(tmp_path, "newer", make_state(slug="newer", last_updated="2026-07-05T10:00:00+08:00"))
        _, state = harness_lib.find_active_feature(str(tmp_path))
        assert state["slug"] == "newer"

    def test_skips_completed(self, tmp_path):
        write_state(tmp_path, "done", make_state(slug="done", final_merge_sha="abc"))
        assert harness_lib.find_active_feature(str(tmp_path)) is None

    def test_malformed_json_skipped(self, tmp_path):
        d = tmp_path / ".claude" / "feat" / "broken"
        d.mkdir(parents=True)
        (d / "state.json").write_text("{not json", encoding="utf-8")
        assert harness_lib.find_active_feature(str(tmp_path)) is None


class TestGateForPhase:
    def test_known_phase(self):
        assert "TDD" in harness_lib.gate_for_phase(3.0)

    def test_unknown_phase(self):
        assert "未知" in harness_lib.gate_for_phase(99.0)


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def make_repo(tmp_path: Path) -> Path:
    git(tmp_path, "init")
    git(tmp_path, "config", "user.email", "t@t.t")
    git(tmp_path, "config", "user.name", "t")
    return tmp_path


class TestStateIsLagging:
    def test_head_newer_and_state_untouched_is_lagging(self, tmp_path):
        repo = make_repo(tmp_path)
        state_path = write_state(repo, "demo-feature", make_state(last_updated="2020-01-01T00:00:00+08:00"))
        (repo / "code.py").write_text("x = 1")
        git(repo, "add", "code.py")
        git(repo, "commit", "-m", "feat: code only")
        state = harness_lib.load_state(state_path)
        assert harness_lib.state_is_lagging(str(repo), state_path, state) is True

    def test_head_commit_touching_state_not_lagging(self, tmp_path):
        repo = make_repo(tmp_path)
        state_path = write_state(repo, "demo-feature", make_state(last_updated="2020-01-01T00:00:00+08:00"))
        git(repo, "add", ".claude/feat/demo-feature/state.json")
        git(repo, "commit", "-m", "chore: sync state")
        state = harness_lib.load_state(state_path)
        assert harness_lib.state_is_lagging(str(repo), state_path, state) is False

    def test_state_fresher_than_head_not_lagging(self, tmp_path):
        repo = make_repo(tmp_path)
        (repo / "code.py").write_text("x = 1")
        git(repo, "add", "code.py")
        git(repo, "commit", "-m", "feat: code")
        state_path = write_state(repo, "demo-feature", make_state(last_updated="2099-01-01T00:00:00+08:00"))
        state = harness_lib.load_state(state_path)
        assert harness_lib.state_is_lagging(str(repo), state_path, state) is False

    def test_not_a_repo_not_lagging(self, tmp_path):
        state_path = write_state(tmp_path, "demo-feature", make_state())
        state = harness_lib.load_state(state_path)
        assert harness_lib.state_is_lagging(str(tmp_path), state_path, state) is False
```

注意:`test_not_a_repo_not_lagging` 在 tmp_path 位於某個上層 git repo 內時,`rev-parse` 會找到上層 root、`relative_to` 失敗 → 回 False,測試仍成立(實作已處理)。

- [ ] **Step 2: 跑測試確認失敗**

```powershell
python -m pytest C:\Users\USER\.claude\hooks\tests\test_harness_lib.py -q
```
Expected: FAIL(`ModuleNotFoundError: No module named 'harness_lib'`)

- [ ] **Step 3: 實作 `harness_lib.py`**

```python
#!/usr/bin/env python3
"""Shared helpers for harness enforcement hooks (context / stop-audit).

Implements the "active feature" semantics of
docs/specs/harness-enforcement/design.md (neigui repo) §2.1:
- active = paused is null AND final_merge_sha absent AND 8.5 not in completed_phases
- multiple actives -> latest last_updated
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

PHASE_GATES: list[tuple[float, str]] = [
    (-1.0, "工作區隔離(branch + artifact 目錄 + state.json 初始化)"),
    (0.0, "Brainstorm:SC 可驗證性 gate(SC-N 編號 + 驗證方式 + 單位/量法)"),
    (1.0, "設計 spec review:無 P0 且 P1≤2(max 3 輪)"),
    (2.0, "逐檔實作 spec(>15 檔切 condensed)"),
    (3.0, "TDD:[red] 先於 [green],commit 帶 tag"),
    (4.0, "自評 code-review:雙焦點 + 單輪退場條件"),
    (5.0, "自動化驗證:auto-verify 全綠"),
    (6.0, "真實環境驗證:依 feature shape 分流"),
    (7.0, "回頭核 goal:SC 證據表逐條對,無 N/A"),
    (8.0, "收尾:TDD 序列 git log 機驗 + artifact commit"),
    (8.5, "沉澱:知識分流 + GC + 收件匣回報"),
]


def gate_for_phase(phase: float) -> str:
    for p, gate in PHASE_GATES:
        if p == phase:
            return gate
    return "(未知 phase,查 ~/.claude/commands/feat.md)"


def _parse_ts(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _aware(ts: datetime) -> datetime:
    return ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)


def load_state(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def is_active(state: dict) -> bool:
    if state.get("paused") is not None:
        return False
    if state.get("final_merge_sha"):
        return False
    completed = state.get("completed_phases") or []
    return 8.5 not in completed


def find_active_feature(cwd: str) -> tuple[Path, dict] | None:
    feat_dir = Path(cwd) / ".claude" / "feat"
    if not feat_dir.is_dir():
        return None
    candidates: list[tuple[datetime, Path, dict]] = []
    for state_path in feat_dir.glob("*/state.json"):
        state = load_state(state_path)
        if state is None or not is_active(state):
            continue
        ts = _parse_ts(state.get("last_updated")) or datetime.min
        candidates.append((_aware(ts), state_path, state))
    if not candidates:
        return None
    candidates.sort(key=lambda c: c[0])
    _, state_path, state = candidates[-1]
    return state_path, state


def _git(repo: Path, *args: str) -> str | None:
    try:
        res = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True, text=True, timeout=10, encoding="utf-8",
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    return res.stdout.strip()


def _repo_root(cwd: str) -> Path | None:
    out = _git(Path(cwd), "rev-parse", "--show-toplevel")
    return Path(out) if out else None


def _head_commit_time(repo: Path) -> datetime | None:
    return _parse_ts(_git(repo, "log", "-1", "--format=%cI"))


def _head_touched(repo: Path, rel_posix: str) -> bool:
    out = _git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
    if out is None:
        return False
    return rel_posix in out.splitlines()


def state_is_lagging(cwd: str, state_path: Path, state: dict) -> bool:
    """HEAD 晚於 last_updated 且最近 commit 未含此 state.json(design §2.2)。"""
    root = _repo_root(cwd)
    if root is None:
        return False
    head_ts = _head_commit_time(root)
    last = _parse_ts(state.get("last_updated"))
    if head_ts is None or last is None:
        return False
    if _aware(head_ts) <= _aware(last):
        return False
    try:
        rel = state_path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return False
    return not _head_touched(root, rel)
```

- [ ] **Step 4: 跑測試確認全綠**

```powershell
python -m pytest C:\Users\USER\.claude\hooks\tests\test_harness_lib.py -q
```
Expected: 15 passed

- [ ] **Step 5: ruff**

```powershell
ruff check C:\Users\USER\.claude\hooks\harness_lib.py C:\Users\USER\.claude\hooks\tests\test_harness_lib.py
```
Expected: 0 issues(repo commit 在 Task 8 鏡像後統一做)

---

### Task 2: `harness-context.py` — 狀態注入 hook

**Files:**
- Create: `C:\Users\USER\.claude\hooks\harness-context.py`
- Test: `C:\Users\USER\.claude\hooks\tests\test_harness_context.py`

**Interfaces:**
- Consumes: `harness_lib.find_active_feature` / `gate_for_phase` / `state_is_lagging`(Task 1 簽名)
- Produces: SessionStart + UserPromptSubmit 共用同一 script;stdout 純文字 = additionalContext;無 active feature 時零輸出 exit 0。

- [ ] **Step 1: 失敗測試**

寫 `test_harness_context.py`(測試以 subprocess 餵 stdin JSON,模擬 harness 呼叫):

```python
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).parent.parent / "harness-context.py"

sys.path.insert(0, str(Path(__file__).parent))
from test_harness_lib import make_state, write_state  # noqa: E402


def run_hook(payload: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload), capture_output=True, text=True, encoding="utf-8",
    )


def test_no_active_feature_silent(tmp_path):
    res = run_hook({"hook_event_name": "UserPromptSubmit", "cwd": str(tmp_path)})
    assert res.returncode == 0
    assert res.stdout.strip() == ""


def test_active_feature_injects_slug_phase_gate(tmp_path):
    write_state(tmp_path, "demo-feature", make_state(current_phase=5))
    res = run_hook({"hook_event_name": "SessionStart", "cwd": str(tmp_path)})
    assert res.returncode == 0
    assert "demo-feature" in res.stdout
    assert "phase:5" in res.stdout.replace(" ", "")
    assert "auto-verify" in res.stdout  # phase 5 的 gate 描述


def test_malformed_stdin_fail_open(tmp_path):
    res = subprocess.run(
        [sys.executable, str(HOOK)], input="{not json",
        capture_output=True, text=True, encoding="utf-8",
    )
    assert res.returncode == 0
    assert res.stdout.strip() == ""
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
python -m pytest C:\Users\USER\.claude\hooks\tests\test_harness_context.py -q
```
Expected: FAIL(hook 檔不存在)

- [ ] **Step 3: 實作 `harness-context.py`**

```python
#!/usr/bin/env python3
"""SessionStart + UserPromptSubmit hook: inject active /feat state into context.

弱模型長對話後會遺忘流程位置 — 每回合重新錨定(protocol-model-dependency 的
soft reminder 機制)。無進行中 feature 時零輸出,不污染一般 session。
stdout(exit 0)在兩種 event 都會被加進 context。
Fail-open(design §4):內部錯誤 → stderr 警告 + exit 0。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import harness_lib  # noqa: E402


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    if not isinstance(payload, dict):
        return 0
    cwd = payload.get("cwd") or ""
    if not isinstance(cwd, str) or not cwd:
        return 0
    try:
        found = harness_lib.find_active_feature(cwd)
        if found is None:
            return 0
        state_path, state = found
        phase = state.get("current_phase")
        try:
            gate = harness_lib.gate_for_phase(float(phase))
        except (TypeError, ValueError):
            gate = harness_lib.gate_for_phase(-999.0)
        lines = [
            f"[harness] 進行中 /feat:{state.get('slug')}(branch {state.get('branch')})",
            f"目前 phase:{phase} — 此 phase 的 gate:{gate}",
            f"state.json 上次回寫:{state.get('last_updated')}",
        ]
        if harness_lib.state_is_lagging(cwd, state_path, state):
            lines.append("⚠ state.json 已落後最新 commit — 先回寫再繼續其他工作。")
        print("\n".join(lines))
        return 0
    except Exception as e:  # fail-open(design §4 顯式決策):降級 + 印原因
        print(f"harness-context: internal error (fail-open): {e}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 跑測試確認全綠**

```powershell
python -m pytest C:\Users\USER\.claude\hooks\tests\test_harness_context.py -q
```
Expected: 3 passed

---

### Task 3: `harness-stop-audit.py` — 回合末審計 hook

**Files:**
- Create: `C:\Users\USER\.claude\hooks\harness-stop-audit.py`
- Test: `C:\Users\USER\.claude\hooks\tests\test_harness_stop_audit.py`

**Interfaces:**
- Consumes: `harness_lib`(Task 1)
- Produces: Stop hook。block 用 stdout JSON `{"decision": "block", "reason": "..."}` + exit 0;非阻斷提醒用 `{"systemMessage": "..."}`;`stop_hook_active` 為 true 時直接放行(防無限迴圈)。收件匣路徑可用環境變數 `HARNESS_INBOX` 覆寫(測試用)。

- [ ] **Step 1: 失敗測試**

```python
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).parent.parent / "harness-stop-audit.py"

sys.path.insert(0, str(Path(__file__).parent))
from test_harness_lib import git, make_repo, make_state, write_state  # noqa: E402


def run_hook(payload: dict, inbox: Path | None = None) -> subprocess.CompletedProcess:
    import os
    env = dict(os.environ)
    if inbox is not None:
        env["HARNESS_INBOX"] = str(inbox)
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload), capture_output=True, text=True,
        encoding="utf-8", env=env,
    )


def test_stop_hook_active_passes_through(tmp_path):
    res = run_hook({"stop_hook_active": True, "cwd": str(tmp_path)})
    assert res.returncode == 0
    assert res.stdout.strip() == ""


def test_no_active_feature_silent(tmp_path):
    res = run_hook({"stop_hook_active": False, "cwd": str(tmp_path)})
    assert res.returncode == 0
    assert res.stdout.strip() == ""


def test_lagging_state_blocks(tmp_path):
    repo = make_repo(tmp_path)
    write_state(repo, "demo-feature", make_state(last_updated="2020-01-01T00:00:00+08:00"))
    (repo / "code.py").write_text("x = 1")
    git(repo, "add", "code.py")
    git(repo, "commit", "-m", "feat: code only")
    res = run_hook({"stop_hook_active": False, "cwd": str(repo)})
    out = json.loads(res.stdout)
    assert out["decision"] == "block"
    assert "state.json" in out["reason"]


def test_phase85_without_inbox_entry_system_message(tmp_path):
    inbox = tmp_path / "inbox.md"
    inbox.write_text("# empty\n", encoding="utf-8")
    write_state(
        tmp_path, "demo-feature",
        make_state(current_phase=8.5,
                   completed_phases=[-1, 0, 1, 2, 3, 4, 5, 6, 7, 8],
                   last_updated="2099-01-01T00:00:00+08:00"),
    )
    res = run_hook({"stop_hook_active": False, "cwd": str(tmp_path)}, inbox=inbox)
    out = json.loads(res.stdout)
    assert "systemMessage" in out
    assert "demo-feature" in out["systemMessage"]


def test_phase85_with_inbox_entry_silent(tmp_path):
    inbox = tmp_path / "inbox.md"
    inbox.write_text("### 2026-07-06 (feature: demo-feature)\n- 無瑕疵\n", encoding="utf-8")
    write_state(
        tmp_path, "demo-feature",
        make_state(current_phase=8.5,
                   completed_phases=[-1, 0, 1, 2, 3, 4, 5, 6, 7, 8],
                   last_updated="2099-01-01T00:00:00+08:00"),
    )
    res = run_hook({"stop_hook_active": False, "cwd": str(tmp_path)}, inbox=inbox)
    assert res.stdout.strip() == ""
```

(`last_updated=2099` 讓 lagging 檢查必不觸發,單獨測收件匣分支。)

- [ ] **Step 2: 跑測試確認失敗**

```powershell
python -m pytest C:\Users\USER\.claude\hooks\tests\test_harness_stop_audit.py -q
```
Expected: FAIL(hook 檔不存在)

- [ ] **Step 3: 實作 `harness-stop-audit.py`**

```python
#!/usr/bin/env python3
"""Stop hook: 回合末審計進行中 /feat 的機械義務(design §2.2)。

- state.json 落後最新 commit(且該 commit 未含 state.json)→ block 一次令回寫。
- Phase 8.5 進行中且收件匣無本 slug entry → systemMessage 提醒(不 block,
  「無瑕疵」是合法結果,真偽不可機驗)。
- stop_hook_active 防無限迴圈;fail-open(design §4)。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import harness_lib  # noqa: E402


def _inbox_path() -> Path:
    override = os.environ.get("HARNESS_INBOX")
    if override:
        return Path(override)
    return Path.home() / ".claude" / "feat-improvements.md"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    if not isinstance(payload, dict) or payload.get("stop_hook_active"):
        return 0
    cwd = payload.get("cwd") or ""
    if not isinstance(cwd, str) or not cwd:
        return 0
    try:
        found = harness_lib.find_active_feature(cwd)
        if found is None:
            return 0
        state_path, state = found

        if harness_lib.state_is_lagging(cwd, state_path, state):
            print(json.dumps({
                "decision": "block",
                "reason": (
                    f"[harness-stop-audit] {state_path} 落後最新 commit。"
                    "結束回合前先回寫 current_phase / completed_phases / last_updated。"
                ),
            }, ensure_ascii=False))
            return 0

        phase = state.get("current_phase")
        completed = state.get("completed_phases") or []
        slug = state.get("slug") or ""
        if phase == 8.5 and 8.5 not in completed and slug:
            try:
                inbox_text = _inbox_path().read_text(encoding="utf-8")
            except OSError:
                inbox_text = ""
            if slug not in inbox_text:
                print(json.dumps({
                    "systemMessage": (
                        f"[harness-stop-audit] {slug} 在 Phase 8.5 但"
                        "feat-improvements.md 無本輪 entry — 有瑕疵補 entry,"
                        "確實無瑕疵補「(feature: " + slug + ")無瑕疵」標記。"
                    ),
                }, ensure_ascii=False))
        return 0
    except Exception as e:  # fail-open(design §4 顯式決策)
        print(f"harness-stop-audit: internal error (fail-open): {e}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 跑測試確認全綠**

```powershell
python -m pytest C:\Users\USER\.claude\hooks\tests\test_harness_stop_audit.py -q
```
Expected: 5 passed

---

### Task 4: `harness-push-gate.py` — push 強制確認 hook

**Files:**
- Create: `C:\Users\USER\.claude\hooks\harness-push-gate.py`
- Test: `C:\Users\USER\.claude\hooks\tests\test_harness_push_gate.py`

**Interfaces:**
- Produces: PreToolUse hook,matcher `Bash|PowerShell`(Task 5 註冊)。偵測到 push → stdout JSON `permissionDecision: "ask"` + exit 0;非 push → 零輸出 exit 0。**Fail-closed**:內部錯誤仍輸出 `ask`。

- [ ] **Step 1: 失敗測試**

```python
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).parent.parent / "harness-push-gate.py"


def run_hook(command: str, tool_name: str = "Bash") -> subprocess.CompletedProcess:
    payload = {"tool_name": tool_name, "tool_input": {"command": command}}
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload), capture_output=True, text=True, encoding="utf-8",
    )


def ask_decision(res: subprocess.CompletedProcess) -> str | None:
    if not res.stdout.strip():
        return None
    return json.loads(res.stdout)["hookSpecificOutput"]["permissionDecision"]


def test_git_push_asks():
    assert ask_decision(run_hook("git push origin main")) == "ask"


def test_git_push_force_asks():
    assert ask_decision(run_hook("git push --force-with-lease origin feat/x")) == "ask"


def test_git_c_flag_push_asks():
    assert ask_decision(run_hook("git -C C:/side-project/neigui push")) == "ask"


def test_gh_pr_merge_asks():
    assert ask_decision(run_hook("gh pr merge 12 --squash")) == "ask"


def test_powershell_tool_covered():
    assert ask_decision(run_hook("git push origin main", tool_name="PowerShell")) == "ask"


def test_git_status_silent():
    assert ask_decision(run_hook("git status")) is None


def test_compound_command_with_push_asks():
    assert ask_decision(run_hook("git add a.py; git commit -m x; git push")) == "ask"


def test_non_shell_tool_silent():
    assert ask_decision(run_hook("git push", tool_name="Read")) is None


def test_malformed_stdin_fail_closed_asks():
    res = subprocess.run(
        [sys.executable, str(HOOK)], input="{not json",
        capture_output=True, text=True, encoding="utf-8",
    )
    assert json.loads(res.stdout)["hookSpecificOutput"]["permissionDecision"] == "ask"
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
python -m pytest C:\Users\USER\.claude\hooks\tests\test_harness_push_gate.py -q
```
Expected: FAIL(hook 檔不存在)

- [ ] **Step 3: 實作 `harness-push-gate.py`**

```python
#!/usr/bin/env python3
"""PreToolUse(Bash|PowerShell) hook: git push / gh pr merge 強制 user 確認。

鐵則 H(push 前列 commit 清單給 user 確認)的機械後盾:permissionDecision
"ask" 無視 session permission mode 強制跳 prompt — 模型忘了列清單,user 也
必然看到 push 指令本身。Fail-closed(design §4):內部錯誤仍回 ask。
"""

from __future__ import annotations

import json
import re
import sys

SHELL_TOOLS = {"Bash", "PowerShell"}

PUSH_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bgit\b[^|;&]*\bpush\b"),
    re.compile(r"\bgh\s+pr\s+merge\b"),
]

ASK_REASON = (
    "鐵則 H:push / merge 需 user 本人確認。"
    "若尚未列出 origin/<branch>..HEAD commit 清單與目標 branch,先列給 user。"
)


def is_push(command: str) -> bool:
    return any(p.search(command) for p in PUSH_PATTERNS)


def emit_ask(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            return 0
        tool_name = payload.get("tool_name") or payload.get("toolName") or ""
        if tool_name not in SHELL_TOOLS:
            return 0
        tool_input = payload.get("tool_input") or payload.get("toolInput") or {}
        command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""
        if not isinstance(command, str) or not command:
            return 0
        if is_push(command):
            emit_ask(ASK_REASON)
        return 0
    except Exception:  # fail-closed(design §4 顯式決策):錯誤時仍要求確認
        emit_ask("harness-push-gate 內部錯誤(fail-closed)— 仍需 user 確認。")
        return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 跑測試確認全綠**

```powershell
python -m pytest C:\Users\USER\.claude\hooks\tests\ -q
```
Expected: 全部 passed(Task 1-4 累計 32 個:lib 15 + context 3 + stop-audit 5 + push-gate 9)

---

### Task 5: settings.json 註冊 + PowerShell gap 記錄

**Files:**
- Modify: `C:\Users\USER\.claude\settings.json`(hooks 區塊)
- Modify: `C:\side-project\neigui\docs\next-time.md`(追加一條)

- [ ] **Step 1: settings.json 的 hooks 區塊改成**

(保留既有 PreToolUse Bash 兩條與 PostToolUse;新增三個 event + push-gate)

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        { "type": "command", "command": "python C:/Users/USER/.claude/hooks/block-no-verify.py" },
        { "type": "command", "command": "python C:/Users/USER/.claude/hooks/safety-hooks.py" }
      ]
    },
    {
      "matcher": "Bash|PowerShell",
      "hooks": [
        { "type": "command", "command": "python C:/Users/USER/.claude/hooks/harness-push-gate.py" }
      ]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "Write|Edit|MultiEdit",
      "hooks": [
        { "type": "command", "command": "python C:/Users/USER/.claude/hooks/format-on-edit.py" }
      ]
    }
  ],
  "SessionStart": [
    {
      "hooks": [
        { "type": "command", "command": "python C:/Users/USER/.claude/hooks/harness-context.py" }
      ]
    }
  ],
  "UserPromptSubmit": [
    {
      "hooks": [
        { "type": "command", "command": "python C:/Users/USER/.claude/hooks/harness-context.py" }
      ]
    }
  ],
  "Stop": [
    {
      "hooks": [
        { "type": "command", "command": "python C:/Users/USER/.claude/hooks/harness-stop-audit.py" }
      ]
    }
  ]
}
```

- [ ] **Step 2: 驗 settings.json 仍是合法 JSON**

```powershell
python -c "import json; json.load(open(r'C:\Users\USER\.claude\settings.json', encoding='utf-8')); print('OK')"
```
Expected: `OK`

- [ ] **Step 3: next-time.md 追加**

```markdown
- [harness] block-no-verify.py / safety-hooks.py 的 matcher 只有 Bash,PowerShell 工具是繞過面(push-gate 已覆蓋 Bash|PowerShell,舊兩個 hook 待補 matcher + tool_name 支援)
```

- [ ] **Step 4: 註記**:hooks 設定在 session 啟動時載入 — 新 hook 生效需重啟 session,實際生效驗證統一在 Task 9。

---

### Task 6: 專案插槽 `.claude/harness.json` + git pre-push hook

**Files:**
- Create: `C:\side-project\neigui\.claude\harness.json`
- Create: `C:\side-project\neigui\scripts\git-hooks\pre-push`(sh shim)
- Create: `C:\side-project\neigui\scripts\git-hooks\pre_push.py`
- Test: `C:\side-project\neigui\scripts\git-hooks\test_pre_push.py`

**Interfaces:**
- Produces: `pre_push.main(root: Path | None = None) -> int`(root 可注入,測試用);`.claude/harness.json` schema `{"verify": [{"name", "cwd", "cmd"}]}`(Task 7 的 auto-verify 引用、第二期 harness-check 共用)。

- [ ] **Step 1: 失敗測試**

寫 `scripts/git-hooks/test_pre_push.py`:

```python
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
    write_config(tmp_path, [
        {"name": "ok", "cwd": ".", "cmd": "python -c \"import sys; sys.exit(0)\""},
    ])
    assert pre_push.main(root=tmp_path) == 0


def test_any_red_fails(tmp_path):
    write_config(tmp_path, [
        {"name": "ok", "cwd": ".", "cmd": "python -c \"import sys; sys.exit(0)\""},
        {"name": "boom", "cwd": ".", "cmd": "python -c \"import sys; sys.exit(3)\""},
    ])
    assert pre_push.main(root=tmp_path) == 1


def test_broken_config_fails_closed(tmp_path):
    d = tmp_path / ".claude"
    d.mkdir(parents=True)
    (d / "harness.json").write_text("{not json", encoding="utf-8")
    assert pre_push.main(root=tmp_path) == 1
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
cd C:\side-project\neigui\scripts\git-hooks; python -m pytest test_pre_push.py -q
```
Expected: FAIL(`ModuleNotFoundError: No module named 'pre_push'`)

- [ ] **Step 3: 實作**

`scripts/git-hooks/pre_push.py`:

```python
#!/usr/bin/env python3
"""git pre-push hook 本體:跑 .claude/harness.json 的 verify 指令組。

design §2.4:任一紅 → push 拒絕。無 config → 警告放行(通用骨架的優雅降級);
config 壞掉 → fail-closed(exit 1),壞掉的防線不該靜默放行。
e2e 不在此跑(太慢,留流程 gate)。user 緊急繞過:git push --no-verify
(block-no-verify.py 保證 Claude 用不了這條路)。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def _find_root() -> Path:
    res = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, encoding="utf-8",
    )
    if res.returncode != 0:
        print("pre-push: git rev-parse 失敗,無法定位 repo root", file=sys.stderr)
        sys.exit(1)
    return Path(res.stdout.strip())


def main(root: Path | None = None) -> int:
    root = root or _find_root()
    config_path = root / ".claude" / "harness.json"
    if not config_path.is_file():
        print(f"pre-push: {config_path} 不存在,跳過驗證(警告)", file=sys.stderr)
        return 0
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        steps = config["verify"]
    except (json.JSONDecodeError, KeyError, UnicodeDecodeError) as e:
        print(f"pre-push: harness.json 解析失敗(fail-closed):{e}", file=sys.stderr)
        return 1
    for step in steps:
        name = step["name"]
        cwd = root / step.get("cwd", ".")
        cmd = step["cmd"]
        print(f"pre-push: [{name}] {cmd}(cwd={cwd})", file=sys.stderr)
        res = subprocess.run(cmd, shell=True, cwd=str(cwd))
        if res.returncode != 0:
            print(f"pre-push: [{name}] 失敗(exit {res.returncode})— push 已拒絕", file=sys.stderr)
            return 1
    print("pre-push: 全部驗證通過", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

`scripts/git-hooks/pre-push`(sh shim,無副檔名;git 在 Windows 用 Git Bash 執行):

```sh
#!/bin/sh
# 委派給 pre_push.py — 邏輯與測試都在 Python 側
exec python "$(git rev-parse --show-toplevel)/scripts/git-hooks/pre_push.py"
```

`.claude/harness.json`(design §2.5 原樣):

```json
{
  "verify": [
    { "name": "backend",        "cwd": "backend",  "cmd": "python -m pytest -q" },
    { "name": "frontend-test",  "cwd": "frontend", "cmd": "npm test" },
    { "name": "frontend-build", "cwd": "frontend", "cmd": "npm run build" }
  ]
}
```

- [ ] **Step 4: 跑測試確認全綠**

```powershell
cd C:\side-project\neigui\scripts\git-hooks; python -m pytest test_pre_push.py -q
```
Expected: 4 passed

- [ ] **Step 5: Commit(repo 內檔案)**

```powershell
git add .claude/harness.json scripts/git-hooks/pre-push scripts/git-hooks/pre_push.py scripts/git-hooks/test_pre_push.py docs/next-time.md
git commit -m "feat(harness): 專案驗證插槽 harness.json + git pre-push 測試防線"
```

- [ ] **Step 6: [USER ACTION] 啟用 hooksPath**

Claude 被 block-no-verify.py 擋著不能自己執行(這正是防線設計)。請 user 在 repo 根目錄手動跑一次:

```
git config core.hooksPath scripts/git-hooks
```

執行前確認 `.git/hooks/` 下沒有已啟用的自訂 hook(只有 `.sample` 檔即可切換)。

---

### Task 7: auto-verify skill 加 harness.json 優先條款

**Files:**
- Modify: `C:\Users\USER\.claude\skills\auto-verify\SKILL.md`(「自動化驗證五步驟」表格後)

- [ ] **Step 1: 在五步驟表格與「任一步紅 →」之間插入**

```markdown
**指令組來源優先序**:專案有 `.claude/harness.json` → 自動化驗證以其 `verify` 陣列為準(與 git pre-push hook 共用,單一 source of truth);沒有 → 用本 skill 的形狀對應表。
```

- [ ] **Step 2: 版本欄 `version: "2.0.0"` → `"2.1.0"`**

---

### Task 8: 鏡像同步 + docs/harness/README 更新 + commit

**Files:**
- Create: `docs/harness/hooks/harness_lib.py`、`harness-context.py`、`harness-stop-audit.py`、`harness-push-gate.py`、`tests/`(cp 鏡像)
- Modify: `docs/harness/README.md`(強制層清單 + 同步指令)
- Modify: `docs/harness/skills/auto-verify.md`(cp 鏡像)

- [ ] **Step 1: 鏡像複製**

```bash
cp ~/.claude/hooks/{harness_lib,harness-context,harness-stop-audit,harness-push-gate}.py docs/harness/hooks/
mkdir -p docs/harness/hooks/tests
cp ~/.claude/hooks/tests/test_*.py docs/harness/hooks/tests/
cp ~/.claude/skills/auto-verify/SKILL.md docs/harness/skills/auto-verify.md
```

- [ ] **Step 2: README.md 強制層段落(架構圖內)追加三行**

```
│   harness-context.py — SessionStart/UserPromptSubmit 注入進行中
│                        /feat 的 phase 與 gate(soft reminder)
│   harness-stop-audit.py — Stop 審計 state.json 回寫與收件匣義務
│   harness-push-gate.py — git push / gh pr merge 強制 user 確認(鐵則 H 硬化)
```

同段落下(專案知識層)追加:

```
│   .claude/harness.json — 驗證指令插槽(pre-push 與 auto-verify 共用)
│   scripts/git-hooks/  — git pre-push 測試防線(user 手動 core.hooksPath 啟用)
```

- [ ] **Step 3: README.md「檔案同步說明」的 cp 指令更新為**

```bash
cp ~/.claude/commands/{feat,bug,mod,perf,refactor,goal}.md docs/harness/commands/
cp ~/.claude/hooks/{block-no-verify,safety-hooks,format-on-edit,harness_lib,harness-context,harness-stop-audit,harness-push-gate}.py docs/harness/hooks/
cp ~/.claude/hooks/tests/test_*.py docs/harness/hooks/tests/
cp ~/.claude/skills/auto-verify/SKILL.md docs/harness/skills/auto-verify.md
cp ~/.claude/CLAUDE.md docs/harness/global-rules.md
```

- [ ] **Step 4: Commit**

```powershell
git add docs/harness/
git commit -m "chore(harness): 強制層 v3 第一期 hooks 鏡像 + README 更新"
```

---

### Task 9: 真實環境驗證(SC 對證)

前置:**[USER ACTION] 重啟 Claude Code session**(hooks 設定啟動時載入)。以下在新 session 執行。

- [ ] **Step 1(SC-7): 無 active feature 的注入靜默**

新 session 開在 neigui(目前無進行中 feature)→ context 無 `[harness]` 開頭注入。證據:session 開頭無該字串。

- [ ] **Step 2(SC-1): 注入生效**

建臨時 fixture:

```powershell
New-Item -ItemType Directory -Force C:\side-project\neigui\.claude\feat\_hooktest
Set-Content -Encoding utf8 C:\side-project\neigui\.claude\feat\_hooktest\state.json '{"slug": "_hooktest", "branch": "feat/_hooktest", "current_phase": 5, "completed_phases": [-1, 0, 1, 2, 3, 4], "last_updated": "2099-01-01T00:00:00+08:00", "paused": null}'
```

下一個 user prompt 的 context 應出現 `[harness] 進行中 /feat:_hooktest` + `phase:5` + auto-verify gate 描述。驗完刪除:

```powershell
Remove-Item -Recurse -Force C:\side-project\neigui\.claude\feat\_hooktest -Confirm:$false
```

- [ ] **Step 3(SC-3): push 強制 prompt**

Claude 執行 `git push --dry-run origin main` → permission prompt 必須跳出(user 可 deny,dry-run 即使 approve 也不會真 push)。證據:prompt 出現本身。

- [ ] **Step 4(SC-4 綠側): pre-push 真跑**

```powershell
cd C:\side-project\neigui; python scripts\git-hooks\pre_push.py
```
Expected: 依序跑 backend pytest / frontend vitest / build,全綠 exit 0(紅側已由 `test_any_red_fails` 單元覆蓋)。

- [ ] **Step 5(SC-2 / SC-5 / SC-6 對照): 單元測試總跑**

```powershell
python -m pytest C:\Users\USER\.claude\hooks\tests\ C:\side-project\neigui\scripts\git-hooks\test_pre_push.py -q
```
Expected: 36 passed(32 hook 測試 + 4 pre-push 測試;SC-2 = lagging block 測試;SC-5/SC-6 屬第二期,不在本計畫)

- [ ] **Step 6: 驗證截圖 / 輸出存證**

`docs/specs/harness-enforcement/evidence/` 放:Step 2 注入內容(文字)、Step 3 prompt 截圖、Step 4 輸出尾段。Commit:

```powershell
git add docs/specs/harness-enforcement/evidence/
git commit -m "chore(harness): 第一期真實環境驗證證據"
```

---

## 完成定義(對 design §6)

| SC | 覆蓋位置 |
|---|---|
| SC-1 注入 | Task 2 單元 + Task 9 Step 2 真實 |
| SC-2 Stop 審計 | Task 3 單元(lagging block / 8.5 收件匣兩向) |
| SC-3 push prompt | Task 9 Step 3 真實 |
| SC-4 pre-push | Task 6 單元(紅/綠/無 config/壞 config)+ Task 9 Step 4 真實綠側 |
| SC-5 / SC-6 | 第二期(本計畫不含) |
| SC-7 靜默 | Task 2/3 單元 + Task 9 Step 1 真實 |

第一期收尾後:依 design §7,用 1-2 個真實 /feat 觀察(收件匣照常回報摩擦點),再出第二期 plan(harness-check + feat.md Phase 5/8 改版)。
