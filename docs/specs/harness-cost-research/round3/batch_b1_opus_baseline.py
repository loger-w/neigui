"""Batch B1(E147-E149)— Batch B 的 opus 半,先立基準。

Fable 5 額度在 batch A 跑到 E131 時撞 429,B 批的四個 fable 條件全部跑不了。
本檔只跑 opus 側,額度回來後再跑 fable 側。

**可比性處置**:fable 側恢復時,opus 基準會**連同 fable 一起重跑一次**(同一批、
同一 cache 狀態),本檔的數字只當先行參考,不直接跨批相減。理由見 A 批的 warm-up
教訓 —— 跨批比較會把 cache 狀態差異算進效應裡。

每個條件沿用 A2 的暖機設計(前 2 次丟棄)。
"""

from __future__ import annotations

import time

from r3 import measure, measure_full, run
from batch_b_spec import REVIEW_TASK, SPEC_TASK, TASK, TOOLS

H27 = "H27 寫 spec:fable vs opus"
H28 = "H28 跨 model 委派是否翻轉 2.16× 懲罰"
H30 = "H30 review 判斷力:fable vs opus"

EFFORT = ["--effort", "medium"]


def warm(prompt: str, extra: list[str]) -> None:
    for _ in range(2):
        run(prompt, model="opus", extra=extra)
        time.sleep(0.5)


def main() -> None:
    print("== Batch B1:opus 基準(fable 側等額度)==\n")

    print("H27 — opus 寫 change-spec(真實待辦:review-protocol 去重)")
    warm(SPEC_TASK, [*TOOLS, *EFFORT])
    measure_full("E147", H27, "opus 寫 change-spec 穩態", prompt=SPEC_TASK, model="opus", n=3,
                 extra=[*TOOLS, *EFFORT], note="產出存 outputs/;fable 側待額度")

    print("\nH28 — opus 自己做(委派對照組的分母)")
    warm(TASK, [*TOOLS, *EFFORT])
    measure("E148", H28, "opus 自己做 穩態", prompt=TASK, model="opus", n=3,
            extra=[*TOOLS, *EFFORT], note="fable coordinator 側待額度")

    print("\nH30 — opus review design.md(已過 12 輪審視)")
    warm(REVIEW_TASK, [*TOOLS, *EFFORT])
    measure_full("E149", H30, "opus review design.md 穩態", prompt=REVIEW_TASK, model="opus", n=3,
                 extra=[*TOOLS, *EFFORT], note="findings 存 outputs/ 供人比對")


if __name__ == "__main__":
    main()
