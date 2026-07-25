"""Batch A3(E110-E117)— E108 的複製實驗。

A2 得到一個不自洽的點:E108 建立一個**被 gitignore、git status 逐位元組不變**的檔案,
卻仍然失效 14,830 tok,而且 prompt 反常地多了 537 tok(遠高於 round 1 的 6 tok 噪音底線)。

n=1 分不出「真效應」與「一次性雜訊」。這批把同一條件跑三次,中間夾對照,
並額外測「連續兩次無變更」是否穩定 —— 陽性對照決定結論能不能用(round 1 的教訓)。
"""

from __future__ import annotations

from r2 import REPO, measure, run, swapped

H25 = "H25 到底什麼會讓下一個 session 掉出 cache"
IGNORED = REPO / "backend" / "__pycache__" / "_probe.txt"


def probe(exp: str, cond: str, note: str = "") -> dict:
    return measure(exp, H25, cond, n=1, note=note)


def main() -> None:
    print("== Batch A3:E108 複製 ==\n")
    run()
    probe("E110", "對照:無變更 #1")
    probe("E111", "對照:無變更 #2")
    probe("E112", "對照:無變更 #3", "三次都該 w=0;有一次不是就代表基準不穩")

    for i, exp in enumerate(("E113", "E114", "E115"), 1):
        with swapped({IGNORED: f"probe {i}\n"}):
            probe(exp, f"建立 gitignore 檔 #{i}(重跑 E108)")
        run()  # 還原後重新熱身,讓每一輪起點相同

    # 對照:同一個路徑但內容不變(第二次建立同名同內容的檔)
    with swapped({IGNORED: "probe 1\n"}):
        probe("E116", "gitignore 檔:與 #1 相同內容")
        probe("E117", "gitignore 檔還在,不動再打一次")


if __name__ == "__main__":
    main()
