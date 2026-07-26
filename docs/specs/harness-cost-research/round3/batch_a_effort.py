"""Batch A(E127-E134)— effort 的兩個未結案問題。

背景:round 2 的 H21 用 n=2 量到 `xhigh` 是 `medium` 的 2.10×(方向明確),但也量到
`low` 比 `medium` **貴 18%**,非單調。後者 n=2 不敢當結論,而 user-global CLAUDE.md §G
現行寫的正是「Workflow agent() 預設 effort:'low' 省額度」—— 那條規則從沒被驗過,且
round 2 的訊號與它相反。

本批兩題:
  H25 low > medium 的非單調性,n=5 能不能複製(直接決定 §G 那條要不要改)
  H26 effort 曲線在不同 model 上是否同向(user 提「opus 用 xhigh、fable 用 medium」的前提)

TASK 沿用 E91-E94 的同一題,才能跟 round 2 的數字直接對照。
"""

from __future__ import annotations

from r3 import measure

H25 = "H25 effort 非單調(low > medium)能否以 n=5 複製"
H26 = "H26 effort 曲線是否跨 model 同向"

# 與 round 2 E91-E94 完全相同的題目,保證可對照
TASK = (
    "In this repo, find where the harness decides which ref files a given phase loads. "
    "Reply with just the file path and the function name."
)
TOOLS = ["--allowedTools", "Read", "Grep", "Glob"]


def main() -> None:
    print("== Batch A:effort ==\n")

    print("H25 — opus × 四個 effort,n=5(round 2 同題 n=2 的複製)")
    for exp, eff in (("E127", "low"), ("E128", "medium"), ("E129", "high"), ("E130", "xhigh")):
        measure(
            exp, H25, f"opus effort={eff} (n=5)", prompt=TASK, model="opus", n=5,
            extra=[*TOOLS, "--effort", eff],
            note="對照 round2 E91-E94(同題 n=2)",
        )

    print("\nH26 — fable × 四個 effort,n=2(看曲線形狀是否同向)")
    for exp, eff in (("E131", "low"), ("E132", "medium"), ("E133", "high"), ("E134", "xhigh")):
        measure(
            exp, H26, f"fable effort={eff}", prompt=TASK, model="fable", n=2,
            extra=[*TOOLS, "--effort", eff],
            note="與 E127-E130 同題,唯一變因是 model",
        )


if __name__ == "__main__":
    main()
