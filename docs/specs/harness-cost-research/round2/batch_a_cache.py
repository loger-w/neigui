"""Batch A(E61-E72)— cache 是這個 harness 最大的成本項,先把它的行為釘死。

Round 1 H9 只證明「命中與否差 9.5x」。觀測批顯示真實命中率已經 95.3%,所以剩下的問題
不是「有沒有命中」,而是:
  H16 headless session 的 cache 活多久?(TTL 決定「集中改動」的時間窗有多寬)
  H17 到底什麼動作會讓下一個 session 掉出 cache?(R1 的操作規則只驗證了「改 harness 檔」)

量測用 write / read 分項,不是總和 —— 總和在命中與否之間是守恆的,看不出差別。
"""

from __future__ import annotations

import time
from pathlib import Path

from r2 import REPO, measure, run, swapped

CLAUDE_MD = REPO / "CLAUDE.md"
BACKEND_FILE = REPO / "backend" / "main.py"
SCRATCH = REPO / "docs" / "specs" / "harness-cost-research" / "round2" / "_tmp_untracked.txt"

H16 = "H16 headless session 的 prompt cache TTL"
H17 = "H17 什麼動作會讓下一個 session 掉出 cache"


def warm() -> None:
    """先打一次把 cache 寫進去,讓後續量測有基準。"""
    run()


def cache_probe(exp: str, hypothesis: str, cond: str, note: str = "") -> dict:
    # n=1:這批的變數是「這一次是 write 還是 read」,重複跑會自己把 cache 弄熱,反而糊掉訊號
    return measure(exp, hypothesis, cond, n=1, note=note)


def main() -> None:
    print("== Batch A:cache 行為 ==\n")

    print("H16 — TTL:寫入後隔多久再打還能 read")
    warm()
    cache_probe("E61", H16, "間隔 ~1s 再打", "同一 prefix 連打第二次")
    time.sleep(90)
    cache_probe("E62", H16, "間隔 90s 再打")
    print("  (等 400s 跨過 5 分鐘 TTL 邊界…)", flush=True)
    time.sleep(400)
    cache_probe("E63", H16, "間隔 400s 再打(>5min)", "5m TTL 的話這裡該 miss")

    print("\nH17 — 失效邊界(每條都:熱身 → 驗證熱 → 施加變更 → 量 → 還原 → 再量)")

    warm()
    cache_probe("E64", H17, "對照:什麼都不改", "確認基準是熱的")

    original = CLAUDE_MD.read_text(encoding="utf-8")
    with swapped({CLAUDE_MD: original + "\n<!-- cache probe -->\n"}):
        cache_probe("E65", H17, "改 CLAUDE.md 內容(進 prompt 的檔)")
    cache_probe("E66", H17, "把 CLAUDE.md 改回來", "還原後舊 cache entry 是否還在")

    backend_orig = BACKEND_FILE.read_text(encoding="utf-8") if BACKEND_FILE.exists() else None
    if backend_orig is not None:
        with swapped({BACKEND_FILE: backend_orig + "\n# cache probe\n"}):
            cache_probe("E67", H17, "改 backend code(不進 prompt,但動到 git status)")
        cache_probe("E68", H17, "把 backend code 改回來")

    with swapped({SCRATCH: "cache probe\n"}):
        cache_probe("E69", H17, "新增一個 untracked 檔(只動 git status)")
    cache_probe("E70", H17, "刪掉 untracked 檔")

    print("\nH17 補 — 官方旗標:把 per-machine 段(cwd/git status)移出 system prompt")
    for exp, cond in (
        ("E71", "--exclude-dynamic-system-prompt-sections 第一次"),
        ("E72", "--exclude-dynamic-system-prompt-sections 第二次"),
    ):
        measure(
            exp, H17, cond, n=1,
            extra=["--exclude-dynamic-system-prompt-sections"],
            note="旗標宣稱可改善 cross-user cache 重用",
        )


if __name__ == "__main__":
    main()
