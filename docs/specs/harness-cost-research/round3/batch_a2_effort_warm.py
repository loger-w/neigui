"""Batch A2(E143-E146)— 修掉 A 批發現的 warm-up artifact 後重量 effort。

A 批的發現:每個條件的**前 1-2 次必定 cache miss**(write 22k-36k,成本 3x),
之後穩態命中(write 2.5k-6.7k)。因為 `--effort` 值本身進 prompt,換一個值就是換一條
cache prefix,第一次跑必然全額 write。

這解釋了 round 2 H21 的「low 比 medium 貴 18%」:那批 n=2,**兩次都落在 warm-up 上**,
比的是兩個隨機大小的 cache write,不是 effort 的效應。

A2 的修正:每個條件先跑 2 次**丟棄**的暖機,再量 n=5。只比穩態。
執行期間不得改動任何檔案 —— A 批 E127 第 4 次的落單 MISS 疑似來自並行編輯。
"""

from __future__ import annotations

import time

from r3 import measure, run

H25B = "H25b effort 成本差(排除 warm-up 後的穩態)"

TASK = (
    "In this repo, find where the harness decides which ref files a given phase loads. "
    "Reply with just the file path and the function name."
)
TOOLS = ["--allowedTools", "Read", "Grep", "Glob"]
WARMUP = 2


def main() -> None:
    print("== Batch A2:effort 穩態(每條件先暖機 2 次丟棄)==\n")
    for exp, eff in (("E143", "low"), ("E144", "medium"), ("E145", "high"), ("E146", "xhigh")):
        for _ in range(WARMUP):
            run(TASK, model="opus", extra=[*TOOLS, "--effort", eff])
            time.sleep(0.5)
        measure(
            exp, H25B, f"opus effort={eff} 穩態", prompt=TASK, model="opus", n=5,
            extra=[*TOOLS, "--effort", eff],
            note=f"前 {WARMUP} 次暖機已丟棄;對照 A 批 E127-E130 的分層值",
        )


if __name__ == "__main__":
    main()
