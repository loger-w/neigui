"""Batch A2(E102-E109)— 追 E67/E69 的反常。

Batch A 的結果自相矛盾:
  E67 改一個**不進 prompt** 的 tracked 檔(backend/main.py) → 失效 18,709 tok
  E69 新增一個 untracked 檔                                → 完全沒失效

兩者都改變了 `git status` 的輸出,結果卻相反。照 round 1 的方法論,「反常是訊號」——
如果真正的失效源不是 git status,那 R1「集中改 harness 檔」的操作規則就抓錯對象了,
因為在 build loop 裡每天改幾十次的是 code,不是 harness 檔。

假說:
  H25a 失效源是 system prompt 的 gitStatus 段(改 tracked 檔會動它,加 untracked 不會)
  H25b 失效源是「檔案 mtime / 內容」被某個常駐機制讀進 prompt(與 git 無關)
  H25c 失效是隨機的(前面兩次剛好碰上)—— 陽性對照必須排除這條
"""

from __future__ import annotations

import subprocess

from r2 import REPO, measure, run, swapped

H25 = "H25 到底什麼會讓下一個 session 掉出 cache"

TRACKED = REPO / "backend" / "main.py"
TRACKED2 = REPO / "frontend" / "src" / "App.tsx"
UNTRACKED_ROOT = REPO / "_probe_untracked.txt"
IGNORED = REPO / "backend" / "__pycache__" / "_probe.txt"


def gitstatus() -> str:
    p = subprocess.run(
        ["git", "-C", str(REPO), "status", "--short"],
        capture_output=True, text=True, encoding="utf-8",
    )
    return p.stdout


def probe(exp: str, cond: str, note: str = "") -> dict:
    return measure(exp, H25, cond, n=1, note=note)


def main() -> None:
    print("== Batch A2:失效源歸因 ==\n")
    print(f"起始 git status --short:\n{gitstatus() or '(clean)'}")

    run()  # 熱身
    probe("E102", "對照 1:什麼都不改", "必須全命中,否則後面都不能解讀")
    probe("E103", "對照 2:什麼都不改(再一次)", "陽性對照 — 排除 H25c 隨機失效")

    # 重跑 E67 的條件,確認可重現
    orig = TRACKED.read_text(encoding="utf-8")
    with swapped({TRACKED: orig + "\n# probe\n"}):
        print(f"  [git status 現在:{gitstatus().strip().splitlines()[:3]}]")
        probe("E104", "改 tracked 檔 backend/main.py(重跑 E67)")
        probe("E105", "同一個改動不動,再打一次", "若第二次命中 → 失效只發生在變更後第一次")
    run()  # 還原後把 cache 重新熱起來

    # 換一個不同目錄的 tracked 檔 —— 若失效源是 gitStatus,結果該一樣
    orig2 = TRACKED2.read_text(encoding="utf-8") if TRACKED2.exists() else None
    if orig2 is not None:
        with swapped({TRACKED2: orig2 + "\n// probe\n"}):
            probe("E106", "改另一個 tracked 檔 frontend/src/App.tsx")
        run()

    # untracked 放 repo 根目錄(batch A 那次放在深層 docs/ 底下)
    with swapped({UNTRACKED_ROOT: "probe\n"}):
        print(f"  [git status 現在:{gitstatus().strip().splitlines()[:3]}]")
        probe("E107", "新增 untracked 檔在 repo 根目錄")
    run()

    # 被 .gitignore 忽略的檔案:完全不進 git status
    with swapped({IGNORED: "probe\n"}):
        probe("E108", "新增被 gitignore 的檔(git status 不變)", "預期:不失效")
    run()

    # 只改 mtime、內容不變 —— 分離「內容變」與「檔案被碰過」
    content = TRACKED.read_text(encoding="utf-8")
    with swapped({TRACKED: content}):  # 寫回一模一樣的內容 → mtime 變、內容不變、git status 不變
        probe("E109", "重寫 tracked 檔但內容逐位元組相同(只動 mtime)")

    print(f"\n收尾 git status --short:\n{gitstatus() or '(clean)'}")


if __name__ == "__main__":
    main()
