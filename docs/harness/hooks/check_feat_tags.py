#!/usr/bin/env python3
"""/feat Phase 8 的 TDD commit tag 機械驗證(feat.md Phase 8 步驟 2 的 script 化)。

規則單一 source of truth 在此,feat.md 不重抄:
- 掃 start_sha..HEAD 的 [red] / [green] / [refactor] / [lock] 四類 tag(subject)
- 配對:每個 [green] 對應一個更早的、未被配對的 [red]
- 豁免:
  (a) [lock] commit 不參與配對,但 body 必含 `mutation-verified`
  (b) [green] 且 body 含 `Phase 6 real-env finding`(design-amend)不需配對
- [red] > 0 只在存在「需配對的 [green]」時要求(全豁免時可為 0)
- wave 模式(state.scope_overrides.goal_efficiency_mode = true):改驗 [waveN] 存在,
  輸出 wave → SC-N 對映;「全 SC 有 wave 歸屬」屬半語意判定,由呼叫方對照 brainstorm.md 核。

用法:python check_feat_tags.py --state <path/to/state.json> [--repo <path>]
Exit code:0 = PASS、1 = FAIL、2 = 用法 / 環境錯誤。
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

_SEP_COMMIT = "\x1e"
_SEP_FIELD = "\x1f"
_WAVE_RE = re.compile(r"\[wave\d+\]")
_SC_RE = re.compile(r"SC-\d+")

# 三類分離的 emoji(鐵則 B):🔴 行為改動 / 🟢 新功能 / 🔵 純重構
_THREE_EMOJI = ("🔴", "🟢", "🔵")
_LEADING_EMOJI_RE = re.compile(
    r"^\s*([\U0001F300-\U0001FAFF☀-➿⬀-⯿])"
)

_BRANCH_PREFIX_TO_FLOW = {
    "feat": "feat",
    "mod": "mod",
    "fix": "bug",
    "refactor": "refactor",
    "perf": "perf",
}


def flow_kind_for_branch(branch: str) -> str | None:
    """分支 prefix → 流程型別;不符對照表回 None。"""
    prefix = branch.split("/", 1)[0] if "/" in branch else ""
    return _BRANCH_PREFIX_TO_FLOW.get(prefix)


def check_emoji(commits: list[Commit]) -> list[str]:
    """三類 emoji 檢查。回傳警告行(空 = 通過)。

    判準經兩次修正後採用的版本:
      - range 內**至少一個** commit 帶三類 emoji 其一
      - 帶 emoji 的 commit,其 emoji 必須是三者之一
    **不驗 type ↔ emoji 對應** —— 實測 type 與 emoji 非一對一(同為 fix 型有的掛 🔴
    有的掛 🟢,取決於它是行為改還是新功能),驗對應會恆誤報。這裡驗的是「這輪流程有做
    三類分離」,逐 commit 的分類正確性是半語意判定,留給 main agent。
    """
    warnings: list[str] = []
    if not commits:
        return warnings

    has_any = any(e in c.subject for c in commits for e in _THREE_EMOJI)
    if not has_any:
        warnings.append("emoji:range 內沒有任何 commit 帶 🔴/🟢/🔵 — 這輪沒有做三類分離?")

    for c in commits:
        m = _LEADING_EMOJI_RE.match(c.subject)
        if m and m.group(1) not in _THREE_EMOJI:
            warnings.append(
                f"emoji:{c.sha[:8]} 開頭的 {m.group(1)} 不是三類之一「{c.subject}」"
            )
    return warnings


@dataclass
class Commit:
    sha: str
    subject: str
    body: str


def read_commits(repo: Path, start_sha: str) -> list[Commit]:
    """start_sha..HEAD 依時序(舊 → 新)。"""
    res = subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "log",
            "--reverse",
            f"--format=%H{_SEP_FIELD}%s{_SEP_FIELD}%b{_SEP_COMMIT}",
            f"{start_sha}..HEAD",
        ],
        capture_output=True,
        text=True,
        timeout=30,
        encoding="utf-8",
    )
    if res.returncode != 0:
        raise RuntimeError(f"git log failed: {res.stderr.strip()}")
    commits: list[Commit] = []
    for chunk in res.stdout.split(_SEP_COMMIT):
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        sha, subject, body = (chunk.split(_SEP_FIELD) + ["", ""])[:3]
        commits.append(Commit(sha=sha.strip(), subject=subject, body=body))
    return commits


def check_standard(commits: list[Commit]) -> tuple[bool, list[str]]:
    """四類 tag 掃描 + [green]→[red] 配對 + 豁免 (a)(b)。"""
    lines: list[str] = []
    ok = True
    reds = [c for c in commits if "[red]" in c.subject]
    greens = [c for c in commits if "[green]" in c.subject]
    refactors = [c for c in commits if "[refactor]" in c.subject]
    locks = [c for c in commits if "[lock]" in c.subject]
    lines.append(
        f"[red]={len(reds)} [green]={len(greens)} "
        f"[refactor]={len(refactors)} [lock]={len(locks)}"
    )

    if not (reds or greens or refactors or locks):
        return False, lines + ["FAIL: start_sha..HEAD 無任何 TDD tag commit"]

    # 豁免 (a):[lock] body 必含 mutation-verified
    for c in locks:
        if "mutation-verified" not in c.body:
            ok = False
            lines.append(
                f"FAIL: [lock] {c.sha[:8]} body 缺 mutation-verified(豁免 (a) 不成立)"
            )

    # 豁免 (b):design-amend green 不需配對
    need_pair = [c for c in greens if "Phase 6 real-env finding" not in c.body]
    exempt = len(greens) - len(need_pair)
    if exempt:
        lines.append(f"豁免 (b) design-amend [green] × {exempt}")

    # 配對:時序貪婪 — 每個需配對 green 取其前方最早的未配對 red
    order = {c.sha: i for i, c in enumerate(commits)}
    used: set[str] = set()
    for g in need_pair:
        candidate = next(
            (r for r in reds if r.sha not in used and order[r.sha] < order[g.sha]), None
        )
        if candidate is None:
            ok = False
            lines.append(
                f"FAIL: [green] {g.sha[:8]}「{g.subject}」無更早的未配對 [red]"
            )
        else:
            used.add(candidate.sha)

    if need_pair and not reds:
        ok = False
        lines.append("FAIL: 存在需配對 [green] 但 [red] = 0(標準 TDD 流須 > 0)")
    return ok, lines


def check_wave(commits: list[Commit]) -> tuple[bool, list[str]]:
    """wave 模式:[waveN] 存在 + 輸出 wave→SC 對映(全 SC 歸屬由呼叫方核)。"""
    lines: list[str] = []
    waves = [c for c in commits if _WAVE_RE.search(c.subject)]
    if not waves:
        return False, ["FAIL: goal_efficiency_mode 下無任何 [waveN] commit"]
    for c in waves:
        tag = _WAVE_RE.search(c.subject).group(0)  # type: ignore[union-attr]
        scs = sorted(set(_SC_RE.findall(c.subject + "\n" + c.body)))
        lines.append(
            f"{tag} {c.sha[:8]} → {', '.join(scs) if scs else '(body 未列 SC-N)'}"
        )
    lines.append(
        "注意:『全 SC 有 wave 歸屬』請對照 brainstorm.md 核(半語意判定,不在本 script)"
    )
    return True, lines


def _git_out(repo: Path, *args: str) -> str | None:
    try:
        res = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True, text=True, timeout=10, encoding="utf-8",
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return res.stdout.strip() if res.returncode == 0 else None


def resolve_start_sha(repo: Path) -> str | None:
    """--state / --since 皆缺時的 range 起點:merge-base 對主線。"""
    for base in ("origin/main", "main", "origin/master", "master"):
        sha = _git_out(repo, "merge-base", base, "HEAD")
        if sha:
            return sha
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", help=".claude/feat/<slug>/state.json 路徑(/feat 流程)")
    parser.add_argument("--since", help="range 起點 sha(非 /feat 流程用)")
    parser.add_argument("--repo", default=".", help="git repo 路徑(預設 cwd)")
    args = parser.parse_args(argv)

    repo = Path(args.repo)
    state: dict = {}
    # --state 存在 = /feat 流程(state.json 是 /feat 專屬產物);否則看分支 prefix
    flow = "feat" if args.state else flow_kind_for_branch(_git_out(repo, "branch", "--show-current") or "")

    if args.state:
        try:
            state = json.loads(Path(args.state).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            print(f"ERROR: 讀不到 state.json({exc})")
            return 2
        start_sha = state.get("start_sha")
        if not isinstance(start_sha, str) or not start_sha:
            print("ERROR: state.json 缺 start_sha")
            return 2
    else:
        start_sha = args.since or resolve_start_sha(repo)
        if not start_sha:
            print("ERROR: 給不出 range 起點(--state / --since 皆缺且 merge-base 解不出來)")
            return 2

    try:
        commits = read_commits(repo, start_sha)
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        print(f"ERROR: {exc}")
        return 2

    print(f"check_feat_tags flow={flow or '(unknown)'} commits={len(commits)}")

    ok = True
    if flow == "feat":
        wave_mode = bool((state.get("scope_overrides") or {}).get("goal_efficiency_mode"))
        ok, lines = check_wave(commits) if wave_mode else check_standard(commits)
        print(f"  mode={'wave' if wave_mode else 'standard'}")
        for ln in lines:
            print(f"  {ln}")

    # 三類 emoji:非 /feat 流程先以 warning 模式上線(exit 0 + 印警告)。
    # 升為 block 的觀察指標:連續 10 個非 /feat 流程收尾中 warning 誤報數 = 0。
    for w in check_emoji(commits):
        print(f"  WARN {w}")

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        from harness_lib import force_utf8_stdio

        force_utf8_stdio()
    except ImportError:
        pass
    sys.exit(main())
