"""PreToolUse gate: 流程分支收尾前必須有驗證產物(2026-08-03 拍板).

觸發條件:Bash / PowerShell 執行 git push 或 gh pr merge,且當前分支為流程分支
(feat/ mod/ fix/ bug/ refactor/ perf/;fix/ 是 /bug 流程的分支 prefix,
對映 .claude/bug/ — 與 check_feat_tags.py 同一份對映)。

檢查:repo 根的 .claude/<flow>/<slug>/ 下存在任一驗證產物
(automated-verification*、phase7-verification.md、verification.md、
real-env-verification*)。沒有 → exit 2 擋下並說明補救路徑。

背景:2026-08-03 稽核發現 auto-verify / verification-before-completion 只在
3-4/11 輪被呼叫 — 開工節 11/11 是因為它是顯式步驟,收尾 gate 靠自覺會忘。
本 hook 把「有沒有驗證證據」變成機械檢查。

Escape hatch:指令字串含 VERIFY_GATE_SKIP 時放行(僅限 user 明示要跳過時使用)。
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

# 分支 prefix → artifact flow 目錄(check_feat_tags.py 對映的 superset:
# fix→bug 與該檔一致,另容手開的 bug/ 分支)
PREFIX_TO_FLOW = {
    "feat": "feat",
    "mod": "mod",
    "fix": "bug",
    "bug": "bug",
    "refactor": "refactor",
    "perf": "perf",
}
EVIDENCE_GLOBS = (
    "automated-verification*",
    "phase7-verification.md",
    "verification.md",
    "real-env-verification*",
)
# 容許 git.exe 與 -C/-c <值> 等前置參數;gh 容 --repo 等帶值選項。
# 已知限制:字串內含 "git push" 的 prose(commit message 等)會誤觸 — 方向是
# fail-closed 且有 SKIP escape,可接受;帶空白的引號路徑(-C "a b")不匹配。
TRIGGER_RE = re.compile(
    r"\bgit(?:\.exe)?\s+(?:-[Cc]\s+\S+\s+|-\S+\s+)*push\b"
    r"|\bgh(?:\.exe)?\s+(?:-\S+(?:\s+\S+)?\s+)*pr\s+merge\b"
)


def _git(args: list[str], cwd: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def main() -> int:
    getattr(sys.stderr, "reconfigure", lambda **_: None)(encoding="utf-8")
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not TRIGGER_RE.search(command):
        return 0
    if "VERIFY_GATE_SKIP" in command:
        return 0

    cwd = payload.get("cwd") or "."
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
    if not branch or "/" not in branch:
        return 0
    prefix, _, slug = branch.partition("/")
    flow = PREFIX_TO_FLOW.get(prefix)
    if not flow or not slug:
        return 0

    # worktree 輪的 artifact 依規定寫在主 tree(CLAUDE.md §8 教訓)——兩棵都查
    roots: list[Path] = []
    toplevel = _git(["rev-parse", "--show-toplevel"], cwd)
    if toplevel:
        roots.append(Path(toplevel))
    common_dir = _git(["rev-parse", "--git-common-dir"], cwd)
    if common_dir:
        common = Path(common_dir)
        if not common.is_absolute():
            # 相對形是相對 cwd(git 語意),不是相對 toplevel
            common = (Path(cwd) / common).resolve()
        if common.name == ".git":
            main_root = common.parent
            if main_root not in roots:
                roots.append(main_root)
    if not roots:
        return 0

    candidates = [root / ".claude" / flow / slug for root in roots]
    for artifact_dir in candidates:
        if artifact_dir.is_dir():
            for pattern in EVIDENCE_GLOBS:
                if any(artifact_dir.glob(pattern)):
                    return 0

    if not any(d.is_dir() for d in candidates):
        print(
            f"[verify-gate] 擋下:分支 {branch} 的 artifact 目錄不存在 "
            f"(查過:{'; '.join(str(d) for d in candidates)})。可能是 slug 與目錄名"
            "不一致(曾發生 round4-0731 撞名)或流程沒建 artifact。"
            "對齊目錄名或補建後再收尾;user 明示跳過時在指令附 VERIFY_GATE_SKIP。",
            file=sys.stderr,
        )
        return 2

    print(
        f"[verify-gate] 擋下:{'; '.join(str(d) for d in candidates if d.is_dir())} "
        f"沒有任何驗證產物(找過:{', '.join(EVIDENCE_GLOBS)})。收尾前先呼叫 "
        "auto-verify 跑完 gate 並把結果落檔(automated-verification*.json/md 或 "
        "verification.md),真實環境證據落 phase7-verification.md / "
        "real-env-verification*;user 明示跳過時在指令附 VERIFY_GATE_SKIP。",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
